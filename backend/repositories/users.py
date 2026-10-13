"""Identity repository: users, memberships, refresh tokens.

Password hashes use Argon2id (via passlib) when available. Falls back to a
PBKDF2 implementation from hashlib so the module has zero hard dependencies —
production installs passlib[argon2]; local dev without it still works.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID, uuid4

from core.db import is_database_configured, session_for

try:
    from passlib.hash import argon2                     # type: ignore
    _HAS_ARGON = True
except ImportError:  # pragma: no cover
    argon2 = None
    _HAS_ARGON = False


# --- password hashing ------------------------------------------------------

def hash_password(plain: str) -> str:
    if _HAS_ARGON:
        return argon2.hash(plain)
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt, 200_000)
    return f"pbkdf2$200000${salt.hex()}${dk.hex()}"


def verify_password(plain: str, stored: str) -> bool:
    if not stored:
        return False
    if stored.startswith("$argon2") and _HAS_ARGON:
        try:
            return argon2.verify(plain, stored)
        except Exception:
            return False
    if stored.startswith("pbkdf2$"):
        try:
            _, iters, salt_hex, dk_hex = stored.split("$")
            dk = hashlib.pbkdf2_hmac("sha256", plain.encode(),
                                     bytes.fromhex(salt_hex), int(iters))
            return hmac.compare_digest(dk.hex(), dk_hex)
        except Exception:
            return False
    return False


# --- in-memory fallback ----------------------------------------------------

_users: dict[str, dict] = {}          # user_id -> row
_users_by_email: dict[str, str] = {}  # email_lower -> user_id
_memberships: list[dict] = []
_refresh: dict[str, dict] = {}        # token_id -> row


def _seed() -> None:
    """Two demo users so /auth/login works out of the box.

    Password: 'demo1234' for both. Change or delete before shipping."""
    if _users:
        return
    _register(
        email="maya@floak.demo", display_name="Maya", password="demo1234",
        user_id=UUID("00000000-0000-4000-8000-000000000001"),
        org_id="org_demo", role="dispatcher",
    )
    _register(
        email="ops@floak.demo", display_name="Ops Owner", password="demo1234",
        user_id=UUID("00000000-0000-4000-8000-000000000002"),
        org_id="org_demo", role="owner",
    )


def _register(*, email: str, display_name: str, password: str,
              user_id: UUID, org_id: str, role: str) -> None:
    row = {
        "user_id": user_id,
        "email_lower": email.lower(),
        "display_name": display_name,
        "password_hash": hash_password(password),
        "status": "active",
        "created_at": datetime.now(timezone.utc),
        "failed_logins": 0,
    }
    _users[str(user_id)] = row
    _users_by_email[email.lower()] = str(user_id)
    _memberships.append({
        "org_id": org_id, "user_id": user_id, "role": role,
        "joined_at": datetime.now(timezone.utc), "revoked_at": None,
    })


_seed()


# --- public API ------------------------------------------------------------

class EmailTaken(Exception):
    """Raised by create_user when the email is already registered."""


async def create_user(
    *,
    email: str,
    password: str,
    display_name: str,
    org_id: str,
    org_name: str,
    role: str,
) -> dict:
    """Create the org (if new), the user, and their membership in one shot.

    Returns the same shape as find_by_email: {user_id, email_lower,
    display_name, org_id, role}. Raises EmailTaken if the email is already
    registered (checked at the DB level with a real UNIQUE constraint, not
    just a pre-check, to close the race between two concurrent signups).
    """
    lower = email.lower().strip()
    password_hash = hash_password(password)

    if is_database_configured():
        from sqlalchemy import text
        async with session_for("__super__") as session:
            if session is not None:
                await session.execute(text("""
                    INSERT INTO identity.orgs (org_id, name)
                    VALUES (:org_id, :name)
                    ON CONFLICT (org_id) DO NOTHING
                """), {"org_id": org_id, "name": org_name})

                user_id = uuid4()
                try:
                    await session.execute(text("""
                        INSERT INTO identity.users
                            (user_id, email_lower, display_name, password_hash)
                        VALUES (:uid, :email, :name, :hash)
                    """), {"uid": user_id, "email": lower,
                           "name": display_name, "hash": password_hash})
                except Exception as exc:
                    if "unique" in str(exc).lower() or "duplicate" in str(exc).lower():
                        raise EmailTaken() from exc
                    raise

                await session.execute(text("""
                    INSERT INTO identity.memberships (org_id, user_id, role)
                    VALUES (:org_id, :uid, :role)
                """), {"org_id": org_id, "uid": user_id, "role": role})

                return {
                    "user_id": user_id, "email_lower": lower,
                    "display_name": display_name, "status": "active",
                    "org_id": org_id, "role": role,
                }

    if lower in _users_by_email:
        raise EmailTaken()
    user_id = uuid4()
    _register(email=lower, display_name=display_name, password=password,
               user_id=user_id, org_id=org_id, role=role)
    return {
        "user_id": user_id, "email_lower": lower,
        "display_name": display_name, "status": "active",
        "org_id": org_id, "role": role,
    }


async def find_by_email(email: str) -> Optional[dict]:
    """Return {user_id, email, display_name, password_hash, org_id, role} or None."""
    lower = email.lower().strip()

    if is_database_configured():
        from sqlalchemy import text
        async with session_for(None) as session:      # unauth flow, no org yet
            if session is None:
                return _memory_lookup(lower)
            row = (await session.execute(text("""
                SELECT u.user_id, u.email_lower, u.display_name,
                       u.password_hash, u.status,
                       m.org_id, m.role
                  FROM identity.users u
                  JOIN identity.memberships m USING (user_id)
                 WHERE u.email_lower = :email
                   AND m.revoked_at IS NULL
                 LIMIT 1
            """), {"email": lower})).mappings().first()
            return dict(row) if row else None

    return _memory_lookup(lower)


def _memory_lookup(lower: str) -> Optional[dict]:
    uid = _users_by_email.get(lower)
    if not uid:
        return None
    u = _users[uid]
    m = next((m for m in _memberships
              if str(m["user_id"]) == uid and m["revoked_at"] is None), None)
    if not m:
        return None
    return {
        "user_id": u["user_id"],
        "email_lower": u["email_lower"],
        "display_name": u["display_name"],
        "password_hash": u["password_hash"],
        "status": u["status"],
        "org_id": m["org_id"],
        "role": m["role"],
    }


async def find_by_id(user_id: str, org_id: str) -> Optional[dict]:
    """Return {user_id, email_lower, display_name, org_id, role} for a known
    (user_id, org_id) pair, or None. Used by /refresh, where the caller
    already has both from the rotated token and just needs display data."""
    if is_database_configured():
        from sqlalchemy import text
        async with session_for(org_id) as session:
            if session is None:
                return _memory_lookup_by_id(str(user_id), org_id)
            row = (await session.execute(text("""
                SELECT u.user_id, u.email_lower, u.display_name,
                       m.org_id, m.role
                  FROM identity.users u
                  JOIN identity.memberships m USING (user_id)
                 WHERE u.user_id = :uid AND m.org_id = :org
                   AND m.revoked_at IS NULL
                 LIMIT 1
            """), {"uid": user_id, "org": org_id})).mappings().first()
            return dict(row) if row else None

    return _memory_lookup_by_id(str(user_id), org_id)


def _memory_lookup_by_id(uid: str, org_id: str) -> Optional[dict]:
    u = _users.get(uid)
    if not u:
        return None
    m = next((m for m in _memberships
              if str(m["user_id"]) == uid and m["org_id"] == org_id
              and m["revoked_at"] is None), None)
    if not m:
        return None
    return {
        "user_id": u["user_id"], "email_lower": u["email_lower"],
        "display_name": u["display_name"], "org_id": m["org_id"], "role": m["role"],
    }


async def record_login(user_id: str, success: bool) -> None:
    if is_database_configured():
        from sqlalchemy import text
        async with session_for(None) as session:
            if session is None:
                return
            if success:
                await session.execute(text("""
                    UPDATE identity.users
                       SET failed_logins = 0, last_login_at = NOW()
                     WHERE user_id = :uid
                """), {"uid": user_id})
            else:
                await session.execute(text("""
                    UPDATE identity.users
                       SET failed_logins = failed_logins + 1
                     WHERE user_id = :uid
                """), {"uid": user_id})
        return

    u = _users.get(str(user_id))
    if not u:
        return
    if success:
        u["failed_logins"] = 0
    else:
        u["failed_logins"] += 1


# --- refresh tokens --------------------------------------------------------

def _hash_token(raw: str) -> str:
    from core.config import get_settings
    return hmac.new(get_settings().jwt_secret.encode(),
                    raw.encode(), hashlib.sha256).hexdigest()


async def issue_refresh_token(
    user_id: str,
    org_id: str,
    *,
    user_agent: Optional[str] = None,
    ip_hash: Optional[str] = None,
) -> tuple[str, datetime]:
    """Returns (plaintext_token, expires_at). Store the hash, hand out the raw."""
    from core.config import get_settings
    raw = f"rt_{secrets.token_urlsafe(32)}"
    token_id = uuid4()
    expires = datetime.now(timezone.utc) + timedelta(
        days=get_settings().refresh_token_days
    )

    row = {
        "token_id": token_id,
        "user_id": UUID(str(user_id)) if not isinstance(user_id, UUID) else user_id,
        "org_id": org_id,
        "token_hash": _hash_token(raw),
        "issued_at": datetime.now(timezone.utc),
        "expires_at": expires,
        "revoked_at": None,
        "replaced_by": None,
        "user_agent": user_agent,
        "ip_hash": ip_hash,
    }

    if is_database_configured():
        from sqlalchemy import text
        async with session_for(org_id) as session:
            if session is not None:
                await session.execute(text("""
                    INSERT INTO identity.refresh_tokens
                        (token_id, user_id, org_id, token_hash, expires_at,
                         user_agent, ip_hash)
                    VALUES (:token_id, :user_id, :org_id, :token_hash,
                            :expires_at, :ua, :iph)
                """), {
                    "token_id": token_id, "user_id": row["user_id"],
                    "org_id": org_id, "token_hash": row["token_hash"],
                    "expires_at": expires, "ua": user_agent, "iph": ip_hash,
                })
                return raw, expires

    _refresh[str(token_id)] = row
    return raw, expires


async def rotate_refresh_token(raw: str) -> Optional[dict]:
    """Consume a refresh token and mint a new one. Returns None if the token
    is unknown, revoked, expired, or already used (reuse detection).

    Reuse of an old refresh token is treated as compromise: every token in
    the same lineage is revoked, forcing the real user to sign in again.
    """
    token_hash = _hash_token(raw)
    now = datetime.now(timezone.utc)

    if is_database_configured():
        from sqlalchemy import text
        async with session_for(None) as session:
            if session is None:
                return _rotate_memory(token_hash, now)
            row = (await session.execute(text("""
                SELECT token_id, user_id, org_id, revoked_at, expires_at, replaced_by
                  FROM identity.refresh_tokens
                 WHERE token_hash = :h
                 LIMIT 1
            """), {"h": token_hash})).mappings().first()
            if not row:
                return None
            if row["revoked_at"] or row["expires_at"] < now:
                # Reuse detection: kill everything for this user.
                await session.execute(text("""
                    UPDATE identity.refresh_tokens
                       SET revoked_at = NOW()
                     WHERE user_id = :uid AND revoked_at IS NULL
                """), {"uid": row["user_id"]})
                return None
            # Mint replacement then link.
            raw2, expires = await issue_refresh_token(
                str(row["user_id"]), row["org_id"],
            )
            new_hash = _hash_token(raw2)
            new_row = (await session.execute(text("""
                SELECT token_id FROM identity.refresh_tokens WHERE token_hash = :h
            """), {"h": new_hash})).mappings().first()
            await session.execute(text("""
                UPDATE identity.refresh_tokens
                   SET revoked_at = NOW(), replaced_by = :new
                 WHERE token_id = :old
            """), {"new": new_row["token_id"], "old": row["token_id"]})
            return {"raw": raw2, "expires_at": expires,
                    "user_id": str(row["user_id"]), "org_id": row["org_id"]}

    return _rotate_memory(token_hash, now)


def _rotate_memory(token_hash: str, now: datetime) -> Optional[dict]:
    match = next((r for r in _refresh.values() if r["token_hash"] == token_hash), None)
    if not match:
        return None
    if match["revoked_at"] or match["expires_at"] < now:
        for r in _refresh.values():
            if r["user_id"] == match["user_id"] and not r["revoked_at"]:
                r["revoked_at"] = now
        return None
    # Mint replacement.
    raw = f"rt_{secrets.token_urlsafe(32)}"
    new_id = uuid4()
    from core.config import get_settings
    exp = now + timedelta(days=get_settings().refresh_token_days)
    _refresh[str(new_id)] = {
        **match, "token_id": new_id,
        "token_hash": _hash_token(raw), "issued_at": now, "expires_at": exp,
        "revoked_at": None, "replaced_by": None,
    }
    match["revoked_at"] = now
    match["replaced_by"] = new_id
    return {"raw": raw, "expires_at": exp,
            "user_id": str(match["user_id"]), "org_id": match["org_id"]}


async def revoke_all_for_user(user_id: str) -> None:
    if is_database_configured():
        from sqlalchemy import text
        async with session_for(None) as session:
            if session is not None:
                await session.execute(text("""
                    UPDATE identity.refresh_tokens
                       SET revoked_at = NOW()
                     WHERE user_id = :uid AND revoked_at IS NULL
                """), {"uid": user_id})
                return
    for r in _refresh.values():
        if str(r["user_id"]) == str(user_id) and not r["revoked_at"]:
            r["revoked_at"] = datetime.now(timezone.utc)
