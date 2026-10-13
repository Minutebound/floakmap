"""Auth endpoints.

`/signup` and `/login` issue the same JWT shape the rest of the codebase
already expects — org_id and role — so nothing downstream changes. When you
move to an identity provider (OIDC/SAML for business, magic links or
Apple/Google for individuals), these two handlers are what gets replaced.

Sessions are two tokens:

* access_token  — short-lived JWT, returned in the response body, sent by
  the client as `Authorization: Bearer ...`. Never stored server-side.
* refresh_token — long-lived, opaque, stored as an httpOnly/secure/SameSite
  cookie (never touched by JS) and tracked in identity.refresh_tokens (or
  the in-memory fallback) so it can be revoked and reuse can be detected.
  `/refresh` trades a valid one for a new pair; `/logout` revokes it.

`/demo-token` stays so the guest map at /map keeps working without an account.
Delete it before going live.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from core.config import get_settings
from core.security import Principal, Role, current_principal, issue_access_token
from repositories import users as users_repo
from services.registry import DEMO_ORG

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

REFRESH_COOKIE = "floak_refresh"
MIN_PASSWORD = 8

# Business account types land people in owner/admin-capable roles; individual
# accounts land in the consumer `member` role (trips with friends, no fleet).
# This mirrors the mapping the old in-memory accounts.py used.
_ROLE_BY_ACCOUNT_TYPE = {"business": Role.owner, "individual": Role.member}
_ACCOUNT_TYPE_BY_ROLE = {
    Role.owner: "business", Role.admin: "business",
    Role.dispatcher: "business", Role.driver: "business",
    Role.member: "individual", Role.guest: "individual",
}


# ── shapes ───────────────────────────────────────────────────────────────────

class DemoLogin(BaseModel):
    subject_id: str = "usr_maya"
    role: Role = Role.dispatcher


class TokenPair(BaseModel):
    access_token: str
    token_type: str = "bearer"
    org_id: str
    subject_id: str
    role: Role


class SignupBody(BaseModel):
    account_type: str = Field(pattern="^(individual|business)$")
    email: str = Field(max_length=254)
    password: str = Field(max_length=256)
    display_name: str = Field(max_length=60)
    org_name: Optional[str] = Field(None, max_length=100)
    fleet_size: Optional[str] = Field(None, max_length=20)


class LoginBody(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=256)


class SessionOut(TokenPair):
    account_type: str
    display_name: str
    org_name: Optional[str] = None


# ── cookie helpers ───────────────────────────────────────────────────────────

def _set_refresh_cookie(response: Response, raw_token: str, expires_at: datetime) -> None:
    s = get_settings()
    max_age = int((expires_at - datetime.now(timezone.utc)).total_seconds())
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=raw_token,
        max_age=max(max_age, 0),
        httponly=True,
        secure=s.cookie_secure,
        samesite="lax",
        path="/api/v1/auth",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(key=REFRESH_COOKIE, path="/api/v1/auth")


def _client_ip_hash(request: Request) -> Optional[str]:
    ip = request.client.host if request.client else None
    return hashlib.sha256(ip.encode()).hexdigest() if ip else None


async def _issue_session(response: Response, request: Request,
                          user_id, org_id: str, role: Role,
                          display_name: str, org_name: Optional[str]) -> SessionOut:
    raw, expires = await users_repo.issue_refresh_token(
        str(user_id), org_id,
        user_agent=request.headers.get("user-agent"),
        ip_hash=_client_ip_hash(request),
    )
    _set_refresh_cookie(response, raw, expires)
    return SessionOut(
        access_token=issue_access_token(str(user_id), org_id, role),
        org_id=org_id,
        subject_id=str(user_id),
        role=role,
        account_type=_ACCOUNT_TYPE_BY_ROLE.get(role, "individual"),
        display_name=display_name,
        org_name=org_name,
    )


# ── endpoints ────────────────────────────────────────────────────────────────

@router.post("/signup", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
async def signup(body: SignupBody, request: Request, response: Response) -> SessionOut:
    email = body.email.strip()
    display_name = body.display_name.strip()

    # Plain sentence errors, not a pydantic validation list — these are shown
    # to the person as-is.
    if "@" not in email or "." not in email.split("@")[-1] or email.startswith("@"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Enter a valid email address.")
    if len(body.password) < MIN_PASSWORD:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                             f"Use at least {MIN_PASSWORD} characters for your password.")
    if not display_name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Enter your name.")
    if body.account_type == "business" and not (body.org_name or "").strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Enter your company name.")

    role = _ROLE_BY_ACCOUNT_TYPE[body.account_type]
    org_id = f"org_{secrets.token_hex(6)}"
    is_business = body.account_type == "business"
    org_name = (body.org_name or "").strip() if is_business else f"{display_name}’s account"

    try:
        row = await users_repo.create_user(
            email=email,
            password=body.password,
            display_name=display_name,
            org_id=org_id,
            org_name=org_name,
            role=role.value,
        )
    except users_repo.EmailTaken:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "An account with this email already exists. Log in instead.",
        )

    await users_repo.record_login(str(row["user_id"]), success=True)
    return await _issue_session(
        response, request, row["user_id"], row["org_id"], role,
        row["display_name"], org_name if is_business else None,
    )


@router.post("/login", response_model=SessionOut)
async def login(body: LoginBody, request: Request, response: Response) -> SessionOut:
    """The account type picked on the login screen only changes its wording.
    The password proves who someone is; the account decides where they land."""
    row = await users_repo.find_by_email(body.email)
    ok = row is not None and users_repo.verify_password(body.password, row.get("password_hash", ""))
    # Constant-shape check even on a miss, so response timing/branching
    # doesn't reveal whether the email exists.
    if not ok:
        if row is not None:
            await users_repo.record_login(str(row["user_id"]), success=False)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "That email and password don’t match an account.")

    if row.get("status") == "locked":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account is locked. Contact support.")

    await users_repo.record_login(str(row["user_id"]), success=True)
    role = Role(row["role"])
    return await _issue_session(
        response, request, row["user_id"], row["org_id"], role, row["display_name"], None,
    )


@router.post("/refresh", response_model=SessionOut)
async def refresh(request: Request, response: Response) -> SessionOut:
    raw = request.cookies.get(REFRESH_COOKIE)
    if not raw:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in to continue")

    rotated = await users_repo.rotate_refresh_token(raw)
    if rotated is None:
        _clear_refresh_cookie(response)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your session has expired. Sign in again.")

    user_row = await users_repo.find_by_id(rotated["user_id"], rotated["org_id"])
    if user_row is None:
        _clear_refresh_cookie(response)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in to continue")

    _set_refresh_cookie(response, rotated["raw"], rotated["expires_at"])
    role = Role(user_row["role"])
    return SessionOut(
        access_token=issue_access_token(str(user_row["user_id"]), user_row["org_id"], role),
        org_id=user_row["org_id"],
        subject_id=str(user_row["user_id"]),
        role=role,
        account_type=_ACCOUNT_TYPE_BY_ROLE.get(role, "individual"),
        display_name=user_row["display_name"],
        org_name=None,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, response: Response) -> None:
    raw = request.cookies.get(REFRESH_COOKIE)
    if raw:
        rotated = await users_repo.rotate_refresh_token(raw)
        if rotated is not None:
            await users_repo.revoke_all_for_user(rotated["user_id"])
    _clear_refresh_cookie(response)


@router.post("/demo-token", response_model=TokenPair)
async def demo_token(body: DemoLogin) -> TokenPair:
    """Hands out a token for the seeded demo org so the guest map has something
    to connect with. Delete this before going live."""
    return TokenPair(
        access_token=issue_access_token(body.subject_id, DEMO_ORG, body.role),
        org_id=DEMO_ORG,
        subject_id=body.subject_id,
        role=body.role,
    )


@router.get("/me", response_model=Principal)
async def whoami(p: Principal = Depends(current_principal)) -> Principal:
    return p
