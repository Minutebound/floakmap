"""Auth for three very different callers.

1. Humans   -> short-lived JWT access token, refresh token rotation.
2. Devices  -> API key (phone SDK, OBD dongle, tracker hardware). A key is
               scoped to one tracker, so a leaked key can only lie about one
               vehicle.
3. Guests   -> opaque share token from a trip link. Read-only, auto-expiring,
               no account required.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Optional

import jwt
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from core.config import get_settings

bearer = HTTPBearer(auto_error=False)


class Role(str, Enum):
    owner = "owner"            # billing, delete org
    admin = "admin"            # manage members, geofences, vehicles
    dispatcher = "dispatcher"  # see every asset, assign jobs
    driver = "driver"          # emit position, see own history only
    member = "member"          # consumer tier: trips with friends
    guest = "guest"            # share-link viewer, read-only


# Routers ask for a capability, not a role, so adding a role later does not
# mean auditing every endpoint.
CAPABILITIES: dict[Role, set[str]] = {
    Role.owner:      {"org:manage", "fleet:read", "fleet:write", "geofence:write",
                      "trip:write", "net:join", "history:read:all", "member:manage"},
    Role.admin:      {"fleet:read", "fleet:write", "geofence:write", "trip:write",
                      "net:join", "history:read:all", "member:manage"},
    Role.dispatcher: {"fleet:read", "geofence:write", "trip:write", "net:join",
                      "history:read:all"},
    Role.driver:     {"trip:write", "net:join", "history:read:own"},
    Role.member:     {"trip:write", "net:join", "history:read:own"},
    Role.guest:      set(),
}


class Principal(BaseModel):
    """Whoever is on the other end of the request."""
    subject_id: str
    org_id: str
    role: Role
    tracker_id: Optional[str] = None   # device keys
    trip_id: Optional[str] = None      # guest share tokens
    net_id: Optional[str] = None       # FloakNet membership tokens

    def can(self, capability: str) -> bool:
        return capability in CAPABILITIES.get(self.role, set())


# --- tokens ----------------------------------------------------------------

def issue_access_token(
    user_id: str,
    org_id: str,
    role: Role,
    net_id: Optional[str] = None,
) -> str:
    """A net token carries the net it was issued for, but membership is still
    re-checked on every call. A JWT cannot be withdrawn once handed out, so
    revoking someone has to be enforced at use time, not at issue time."""
    s = get_settings()
    now = datetime.now(timezone.utc)
    claims = {
        "sub": user_id,
        "org": org_id,
        "role": role.value,
        "iat": now,
        "exp": now + timedelta(minutes=s.access_token_minutes),
    }
    if net_id:
        claims["net"] = net_id
    return jwt.encode(claims, s.jwt_secret, algorithm=s.jwt_algorithm)


def issue_share_token(trip_id: str, org_id: str, hours: int) -> str:
    s = get_settings()
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {
            "sub": f"guest:{secrets.token_hex(6)}",
            "org": org_id,
            "role": Role.guest.value,
            "trip": trip_id,
            "iat": now,
            "exp": now + timedelta(hours=min(hours, s.max_trip_hours)),
        },
        s.jwt_secret,
        algorithm=s.jwt_algorithm,
    )


def decode_token(token: str) -> dict:
    s = get_settings()
    try:
        return jwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "This link has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")


# --- device API keys -------------------------------------------------------

def mint_device_key(tracker_id: str) -> tuple[str, str]:
    """Returns (plaintext, stored_hash). Show the plaintext exactly once."""
    raw = f"flk_{tracker_id[:8]}_{secrets.token_urlsafe(32)}"
    return raw, hash_device_key(raw)


def hash_device_key(raw: str) -> str:
    s = get_settings()
    return hmac.new(s.jwt_secret.encode(), raw.encode(), hashlib.sha256).hexdigest()


def verify_device_key(raw: str, stored_hash: str) -> bool:
    return hmac.compare_digest(hash_device_key(raw), stored_hash)


# --- dependencies ----------------------------------------------------------

async def current_principal(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
    x_device_key: Optional[str] = Header(default=None, alias="X-Device-Key"),
) -> Principal:
    if x_device_key:
        from services.registry import lookup_device_key
        record = await lookup_device_key(x_device_key)
        if not record:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unknown device key")
        return Principal(
            subject_id=record["tracker_id"],
            org_id=record["org_id"],
            role=Role.driver,
            tracker_id=record["tracker_id"],
        )

    if not creds:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in to continue")

    claims = decode_token(creds.credentials)
    return Principal(
        subject_id=claims["sub"],
        org_id=claims["org"],
        role=Role(claims["role"]),
        trip_id=claims.get("trip"),
        net_id=claims.get("net"),
    )


def requires(capability: str):
    async def _guard(p: Principal = Depends(current_principal)) -> Principal:
        if not p.can(capability):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Your role ({p.role.value}) cannot {capability.replace(':', ' ')}",
            )
        return p
    return _guard
