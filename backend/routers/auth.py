"""Demo auth endpoints.

Password handling is intentionally minimal here because production will use
your identity provider (SAML/OIDC for enterprise, magic links or Apple/Google
sign-in for consumers). What matters for the rest of the codebase is the
*shape* of what comes out: a token carrying org_id and role.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from core.security import Principal, Role, current_principal, issue_access_token
from services.registry import DEMO_ORG

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class DemoLogin(BaseModel):
    subject_id: str = "usr_maya"
    role: Role = Role.dispatcher


class TokenPair(BaseModel):
    access_token: str
    token_type: str = "bearer"
    org_id: str
    subject_id: str
    role: Role


@router.post("/demo-token", response_model=TokenPair)
async def demo_token(body: DemoLogin) -> TokenPair:
    """Hands out a token for the seeded demo org so the frontend has something
    to connect with. Delete this router before going live."""
    return TokenPair(
        access_token=issue_access_token(body.subject_id, DEMO_ORG, body.role),
        org_id=DEMO_ORG,
        subject_id=body.subject_id,
        role=body.role,
    )


@router.get("/me", response_model=Principal)
async def whoami(p: Principal = Depends(current_principal)) -> Principal:
    return p
