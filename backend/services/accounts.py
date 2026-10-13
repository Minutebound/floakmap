"""Accounts: people who sign in with an email and a password.

Same deal as registry.py: an in-memory store behind an async interface, so
moving to Postgres later touches this file only. Restarting the API forgets
every account, which is fine for development and wrong for anything else.

Two account types, and the difference is the org they land in:

* individual -> a personal org of one, role `member` (trips, nets).
* business   -> a new organisation, role `owner` (fleet, geofences, members).

Either way the person also becomes a `person` subject, so they show up on the
map for anyone they share with — exactly like the seeded demo people.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import re
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from core.security import Role
from models.live import ShareMode, Subject, SubjectKind
from services import registry

PBKDF2_ROUNDS = 390_000
MIN_PASSWORD = 8
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class AccountType(str, Enum):
    individual = "individual"
    business = "business"


class AccountError(Exception):
    """A problem the person can fix. The message is shown to them as-is."""


@dataclass
class Account:
    id: str
    email: str
    salt: bytes
    password_hash: str
    account_type: AccountType
    org_id: str
    subject_id: str
    role: Role
    display_name: str
    org_name: Optional[str] = None
    fleet_size: Optional[str] = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


_by_email: dict[str, Account] = {}


def _hash(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ROUNDS).hex()


# Checked against when the email is unknown, so a miss costs the same time as
# a hit and response timing cannot be used to find out who has an account.
_DUMMY_SALT = secrets.token_bytes(16)
_DUMMY_HASH = _hash("not-a-real-password", _DUMMY_SALT)


def normalise_email(email: str) -> str:
    return email.strip().lower()


async def create_account(
    *,
    account_type: AccountType,
    email: str,
    password: str,
    display_name: str,
    org_name: Optional[str] = None,
    fleet_size: Optional[str] = None,
) -> Account:
    email = normalise_email(email)
    display_name = display_name.strip()
    org_name = (org_name or "").strip() or None

    if not _EMAIL.match(email):
        raise AccountError("Enter a valid email address.")
    if len(password) < MIN_PASSWORD:
        raise AccountError(f"Use at least {MIN_PASSWORD} characters for your password.")
    if not display_name:
        raise AccountError("Enter your name.")
    if account_type is AccountType.business and not org_name:
        raise AccountError("Enter your company name.")
    if email in _by_email:
        raise AccountError("An account with this email already exists. Log in instead.")

    salt = secrets.token_bytes(16)
    # PBKDF2 is deliberately slow; keep it off the event loop.
    password_hash = await asyncio.to_thread(_hash, password, salt)

    org_id = f"org_{secrets.token_hex(6)}"
    subject_id = f"usr_{secrets.token_hex(6)}"
    role = Role.owner if account_type is AccountType.business else Role.member

    await registry.upsert_subject(Subject(
        id=subject_id,
        org_id=org_id,
        kind=SubjectKind.person,
        label=display_name,
        tracker_id=f"trk_{subject_id}",
        share_mode=ShareMode.precise,
        metadata={"type": account_type.value},
    ))

    account = Account(
        id=f"acc_{secrets.token_hex(6)}",
        email=email,
        salt=salt,
        password_hash=password_hash,
        account_type=account_type,
        org_id=org_id,
        subject_id=subject_id,
        role=role,
        display_name=display_name,
        org_name=org_name if account_type is AccountType.business else None,
        fleet_size=fleet_size if account_type is AccountType.business else None,
    )
    _by_email[email] = account
    return account


async def verify_login(email: str, password: str) -> Optional[Account]:
    """The account if the password matches, otherwise None. Never says which
    half was wrong."""
    account = _by_email.get(normalise_email(email))
    salt = account.salt if account else _DUMMY_SALT
    expected = account.password_hash if account else _DUMMY_HASH

    candidate = await asyncio.to_thread(_hash, password, salt)
    if not hmac.compare_digest(candidate, expected) or account is None:
        return None
    return account
