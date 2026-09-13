"""FloakNet endpoints.

Two audiences, and the split matters. Members and hosts are authenticated.
Whoever is asking to join is not — they have no account yet, so the join and
claim endpoints take no bearer token and lean on the claim secret instead.
That is the only unauthenticated surface here, and everything about it is
built to be boring to attack: uniform errors, constant-time comparison, rate
limits, short expiry.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from core.security import Principal, current_principal, requires
from models.floaknet import (
    ClaimResult, CreateNet, FloakNet, JoinNet, JoinSubmitted, NetCreated,
    NetMember, NetRole, PendingRequest,
)
from models.live import LiveState
from services import floaknet as svc
from services import tracking

router = APIRouter(prefix="/api/v1/nets", tags=["floaknet"])


def _fail(exc: svc.NetError, code: int = status.HTTP_400_BAD_REQUEST):
    return HTTPException(code, str(exc))


def _client_key(request: Request) -> str:
    """Best-effort caller identity for rate limiting.

    Behind a proxy this needs to read a trusted forwarded header instead —
    X-Forwarded-For is caller-controlled, so trusting it as-is lets an attacker
    reset their own limit by changing one string.
    """
    return request.client.host if request.client else "unknown"


# ── the unauthenticated half ─────────────────────────────────────────────────

@router.post("/join", response_model=JoinSubmitted)
async def ask_to_join(body: JoinNet, request: Request) -> JoinSubmitted:
    """Ask to join. Does not grant anything.

    A wrong code and a real code with a full queue return the same shape of
    error, so this cannot be used to find out which codes exist.
    """
    try:
        req, claim_secret = await svc.request_join(
            code=body.code,
            display_name=body.display_name,
            client_fingerprint=_client_key(request),
        )
    except svc.RateLimited as exc:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            str(exc),
            headers={"Retry-After": str(svc.JOIN_ATTEMPT_WINDOW_S)},
        )
    except svc.NetError as exc:
        raise _fail(exc, status.HTTP_404_NOT_FOUND)

    return JoinSubmitted(
        request_id=req.id,
        net_name=req.net_name,
        fingerprint=req.fingerprint,
        claim_secret=claim_secret,
        status=req.status,
        expires_at=req.expires_at,
    )


@router.get("/requests/{request_id}", response_model=ClaimResult)
async def check_request(
    request_id: str,
    claim: str = Query(min_length=16, description="The claim secret from /join"),
) -> ClaimResult:
    """Polled by the person waiting. Returns a token once the host approves."""
    try:
        return await svc.claim(request_id, claim)
    except svc.NetError as exc:
        raise _fail(exc, status.HTTP_404_NOT_FOUND)


@router.delete("/requests/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
async def withdraw_request(request_id: str, claim: str = Query(min_length=16)) -> None:
    try:
        await svc.withdraw(request_id, claim)
    except svc.NetError as exc:
        raise _fail(exc, status.HTTP_404_NOT_FOUND)


# ── hosts and members ────────────────────────────────────────────────────────

@router.post("", response_model=NetCreated, status_code=status.HTTP_201_CREATED)
async def create_net(
    body: CreateNet,
    p: Principal = Depends(requires("net:join")),
) -> NetCreated:
    """Creates a net and returns the join code once. It is stored hashed, so
    there is no endpoint that can show it again — rotate instead."""
    net, code = await svc.create_net(
        org_id=p.org_id,
        host_subject_id=p.subject_id,
        name=body.name,
        require_approval=body.require_approval,
        max_members=body.max_members,
        default_role=body.default_role,
    )
    return NetCreated(net=net, join_code=code)


@router.get("", response_model=list[FloakNet])
async def my_nets(p: Principal = Depends(current_principal)) -> list[FloakNet]:
    return await svc.nets_for(p.subject_id)


@router.get("/{net_id}", response_model=FloakNet)
async def net_detail(
    net_id: str,
    p: Principal = Depends(current_principal),
) -> FloakNet:
    net = await _readable(net_id, p)
    return net


@router.get("/{net_id}/members", response_model=list[NetMember])
async def members(
    net_id: str,
    p: Principal = Depends(current_principal),
) -> list[NetMember]:
    await _readable(net_id, p)
    return await svc.list_members(net_id)


@router.get("/{net_id}/live", response_model=list[LiveState])
async def net_live(
    net_id: str,
    p: Principal = Depends(current_principal),
) -> list[LiveState]:
    """Snapshot of everyone on the net. Members see members, nobody else."""
    net = await _readable(net_id, p)
    return await tracking.snapshot(net.org_id, await svc.member_subject_ids(net_id))


@router.get("/{net_id}/requests", response_model=list[PendingRequest])
async def queue(
    net_id: str,
    p: Principal = Depends(current_principal),
) -> list[PendingRequest]:
    """The host's pending queue. Compare the fingerprint against what the
    person reads out before approving — the display name is whatever they
    typed."""
    await _readable(net_id, p)          # 404 first: non-members learn nothing
    try:
        return await svc.pending_requests(net_id, p.subject_id)
    except svc.NetError as exc:
        raise _fail(exc, status.HTTP_403_FORBIDDEN)


class Decision(BaseModel):
    note: Optional[str] = Field(default=None, max_length=200)


@router.post("/{net_id}/requests/{request_id}/approve")
async def approve(
    net_id: str,
    request_id: str,
    p: Principal = Depends(current_principal),
) -> dict:
    try:
        req = await svc.decide(net_id, request_id, p.subject_id, approve=True)
    except svc.NetError as exc:
        raise _fail(exc)
    return {
        "status": req.status,
        "display_name": req.display_name,
        "subject_id": req.subject_id,
    }


@router.post("/{net_id}/requests/{request_id}/deny")
async def deny(
    net_id: str,
    request_id: str,
    body: Decision = Decision(),
    p: Principal = Depends(current_principal),
) -> dict:
    try:
        req = await svc.decide(net_id, request_id, p.subject_id, approve=False,
                               note=body.note)
    except svc.NetError as exc:
        raise _fail(exc)
    return {"status": req.status, "display_name": req.display_name}


@router.post("/{net_id}/rotate-code")
async def rotate_code(
    net_id: str,
    p: Principal = Depends(current_principal),
) -> dict:
    """Kills the old code immediately. Existing members keep their access,
    because that came from a membership rather than from the code."""
    await _readable(net_id, p)
    try:
        code = await svc.rotate_code(net_id, p.subject_id)
    except svc.NetError as exc:
        raise _fail(exc, status.HTTP_403_FORBIDDEN)
    return {"join_code": code, "note": "The previous code no longer works."}


@router.post("/{net_id}/members/{subject_id}/revoke", response_model=NetMember)
async def revoke_member(
    net_id: str,
    subject_id: str,
    p: Principal = Depends(current_principal),
) -> NetMember:
    """Takes effect on their next request, not when their token expires."""
    await _readable(net_id, p)
    try:
        return await svc.revoke(net_id, p.subject_id, subject_id)
    except svc.NetError as exc:
        raise _fail(exc, status.HTTP_403_FORBIDDEN)


@router.post("/{net_id}/archive", response_model=FloakNet)
async def archive(
    net_id: str,
    p: Principal = Depends(current_principal),
) -> FloakNet:
    await _readable(net_id, p)
    try:
        return await svc.archive_net(net_id, p.subject_id)
    except svc.NetError as exc:
        raise _fail(exc, status.HTTP_403_FORBIDDEN)


async def _readable(net_id: str, p: Principal) -> FloakNet:
    net = await svc.get_net(net_id)
    if not net or net.org_id != p.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such net")
    if not await svc.membership(net_id, p.subject_id):
        # Same 404 as a net that does not exist. Telling someone a net is real
        # but closed to them is itself information.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such net")
    return net
