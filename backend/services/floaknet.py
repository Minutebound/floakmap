"""FloakNet: create a net, ask to join, host approves, member joins.

Three rules hold the security together.

1. The join code only opens a request. It never grants access.
2. The thing that grants access is a membership the host created, and every
   request re-checks it, so revoking someone takes effect on their next call
   rather than whenever their token happens to expire.
3. The host approves a fingerprint, not a name. Anyone can type "Sam" into
   the display-name box.

Secrets are stored as HMACs. What is handed to a person is shown once and
never retrievable, because a system that can show you the code again can show
it to whoever reads the database.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from core.config import get_settings
from core.security import Role, issue_access_token
from models.floaknet import (
    ClaimResult, FloakNet, JoinRequest, NetMember, NetRole, PendingRequest,
    RequestStatus,
)
from models.live import ShareMode, Subject, SubjectKind
from services import registry

# Crockford-style: no I, L, O, U. Removes the "was that a 1 or an l" support
# ticket, and the missing U makes accidental words much less likely.
ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
CODE_LENGTH = 10                 # ~50 bits
REQUEST_TTL_MINUTES = 15
MAX_PENDING_PER_NET = 25

# Rate limiting. In-memory here; move to Redis when you run more than one pod,
# or an attacker just retries against a different one.
JOIN_ATTEMPT_WINDOW_S = 300
JOIN_ATTEMPTS_ALLOWED = 8

_nets: dict[str, FloakNet] = {}
_code_index: dict[str, str] = {}          # code_hash -> net_id
_members: dict[str, list[NetMember]] = {}  # net_id -> members
_requests: dict[str, JoinRequest] = {}
_attempts: dict[str, list[float]] = {}     # rate-limit key -> timestamps


class NetError(Exception):
    """Raised with a message safe to show the caller."""


class RateLimited(NetError):
    """Separate type so the router can answer 429 and set Retry-After. A
    client that cannot tell throttling from a wrong code will retry forever."""


# --- hashing ---------------------------------------------------------------

def _hmac(value: str) -> str:
    secret = get_settings().jwt_secret.encode()
    return hmac.new(secret, value.encode(), hashlib.sha256).hexdigest()


def _normalise(code: str) -> str:
    """Accept what people actually type: lowercase, spaces, dashes, and the
    characters the alphabet deliberately excludes."""
    cleaned = code.upper().strip().replace("-", "").replace(" ", "")
    return cleaned.translate(str.maketrans({"I": "1", "L": "1", "O": "0", "U": "V"}))


def _new_code() -> str:
    raw = "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))
    return f"{raw[:5]}-{raw[5:]}"       # FLOAK-7K2QM reads back over a phone


def fingerprint_for(claim_secret: str) -> str:
    """Short, unambiguous, derived. The requester reads it out; the host
    compares. Because it comes from the claim secret, an attacker who guessed
    the join code still cannot produce a fingerprint the host is expecting."""
    digest = hashlib.sha256(claim_secret.encode()).digest()
    chars = [ALPHABET[b % len(ALPHABET)] for b in digest[:9]]
    return "-".join("".join(chars[i:i + 3]) for i in (0, 3, 6))


def _rate_limit(key: str) -> None:
    now = time.monotonic()
    hits = [t for t in _attempts.get(key, []) if now - t < JOIN_ATTEMPT_WINDOW_S]
    if len(hits) >= JOIN_ATTEMPTS_ALLOWED:
        raise RateLimited("Too many attempts. Wait a few minutes and try again.")
    hits.append(now)
    _attempts[key] = hits


# --- nets ------------------------------------------------------------------

async def create_net(
    org_id: str,
    host_subject_id: str,
    name: str,
    require_approval: bool = True,
    max_members: int = 50,
    default_role: NetRole = NetRole.member,
) -> tuple[FloakNet, str]:
    now = datetime.now(timezone.utc)
    code = _new_code()
    net = FloakNet(
        id=f"net_{secrets.token_hex(5)}",
        org_id=org_id,
        name=name,
        host_subject_id=host_subject_id,
        code_hash=_hmac(_normalise(code)),
        code_rotated_at=now,
        require_approval=require_approval,
        max_members=max_members,
        default_role=default_role,
        created_at=now,
    )
    _nets[net.id] = net
    _code_index[net.code_hash] = net.id

    host = await registry.get_subject(host_subject_id)
    _members[net.id] = [NetMember(
        net_id=net.id,
        subject_id=host_subject_id,
        display_name=host.label if host else "Host",
        role=NetRole.host,
        joined_at=now,
    )]
    return net, code


async def rotate_code(net_id: str, actor_subject_id: str) -> str:
    """New code, old one dead immediately. What you reach for when a code ends
    up somewhere it should not have. Existing members are unaffected — their
    access came from a membership, not from the code."""
    net = _require_host(net_id, actor_subject_id)
    _code_index.pop(net.code_hash, None)
    code = _new_code()
    net.code_hash = _hmac(_normalise(code))
    net.code_rotated_at = datetime.now(timezone.utc)
    _code_index[net.code_hash] = net.id
    return code


async def get_net(net_id: str) -> Optional[FloakNet]:
    net = _nets.get(net_id)
    return net if net and not net.archived_at else None


async def nets_for(subject_id: str) -> list[FloakNet]:
    out = []
    for net_id, members in _members.items():
        if any(m.subject_id == subject_id and not m.revoked_at for m in members):
            net = await get_net(net_id)
            if net:
                out.append(net)
    return out


async def archive_net(net_id: str, actor_subject_id: str) -> FloakNet:
    net = _require_host(net_id, actor_subject_id)
    net.archived_at = datetime.now(timezone.utc)
    _code_index.pop(net.code_hash, None)
    return net


# --- membership ------------------------------------------------------------

def _require_host(net_id: str, subject_id: str) -> FloakNet:
    net = _nets.get(net_id)
    if not net or net.archived_at:
        raise NetError("No such net")
    member = next(
        (m for m in _members.get(net_id, [])
         if m.subject_id == subject_id and not m.revoked_at),
        None,
    )
    if not member or member.role != NetRole.host:
        raise NetError("Only the host can do that")
    return net


async def membership(net_id: str, subject_id: str) -> Optional[NetMember]:
    """Checked on every net request, so revoking is immediate rather than
    waiting for a token to expire."""
    return next(
        (m for m in _members.get(net_id, [])
         if m.subject_id == subject_id and not m.revoked_at),
        None,
    )


async def list_members(net_id: str) -> list[NetMember]:
    return [m for m in _members.get(net_id, []) if not m.revoked_at]


async def member_subject_ids(net_id: str) -> list[str]:
    return [m.subject_id for m in await list_members(net_id)]


async def revoke(net_id: str, actor_subject_id: str, subject_id: str) -> NetMember:
    net = _require_host(net_id, actor_subject_id)
    if subject_id == net.host_subject_id:
        raise NetError("The host cannot be removed from their own net")
    member = await membership(net_id, subject_id)
    if not member:
        raise NetError("That person is not on this net")
    member.revoked_at = datetime.now(timezone.utc)
    return member


# --- joining ---------------------------------------------------------------

async def request_join(
    code: str,
    display_name: str,
    client_fingerprint: str = "anonymous",
) -> tuple[JoinRequest, str]:
    """Step one. Costs the caller a rate-limit slot whether or not the code is
    real, and returns the same error either way, so this cannot be used to
    discover which codes exist."""
    _rate_limit(f"ip:{client_fingerprint}")

    normalised = _normalise(code)
    net_id = _code_index.get(_hmac(normalised))
    net = _nets.get(net_id) if net_id else None
    if not net or net.archived_at:
        raise NetError("That code does not match an open net")

    _rate_limit(f"net:{net.id}")

    pending = [
        r for r in _requests.values()
        if r.net_id == net.id and r.status == RequestStatus.pending
    ]
    if len(pending) >= MAX_PENDING_PER_NET:
        raise NetError("This net has too many pending requests. Try again later.")

    if len(await list_members(net.id)) >= net.max_members:
        raise NetError("This net is full")

    now = datetime.now(timezone.utc)
    claim_secret = secrets.token_urlsafe(32)
    request = JoinRequest(
        id=f"req_{secrets.token_hex(5)}",
        net_id=net.id,
        net_name=net.name,
        display_name=display_name.strip(),
        fingerprint=fingerprint_for(claim_secret),
        requested_at=now,
        expires_at=now + timedelta(minutes=REQUEST_TTL_MINUTES),
        claim_hash=_hmac(claim_secret),
    )
    _requests[request.id] = request

    # A net that trusts its code can skip the queue. Off by default, because
    # the queue is the entire security model.
    if not net.require_approval:
        await _admit(net, request, approved_by="auto")

    return request, claim_secret


async def pending_requests(net_id: str, actor_subject_id: str) -> list[PendingRequest]:
    _require_host(net_id, actor_subject_id)
    _expire_stale()
    return [
        PendingRequest(
            id=r.id,
            display_name=r.display_name,
            fingerprint=r.fingerprint,
            requested_at=r.requested_at,
            expires_at=r.expires_at,
        )
        for r in sorted(_requests.values(), key=lambda r: r.requested_at)
        if r.net_id == net_id and r.status == RequestStatus.pending
    ]


async def decide(
    net_id: str,
    request_id: str,
    actor_subject_id: str,
    approve: bool,
    note: Optional[str] = None,
) -> JoinRequest:
    net = _require_host(net_id, actor_subject_id)
    request = _requests.get(request_id)
    if not request or request.net_id != net_id:
        raise NetError("No such request")
    if request.status != RequestStatus.pending:
        raise NetError(f"That request is already {request.status.value}")
    if request.expires_at <= datetime.now(timezone.utc):
        request.status = RequestStatus.expired
        raise NetError("That request expired. Ask them to try again.")

    if approve:
        await _admit(net, request, approved_by=actor_subject_id)
    else:
        request.status = RequestStatus.denied
        request.decided_by = actor_subject_id
        request.decided_at = datetime.now(timezone.utc)
        request.note = note
    return request


async def _admit(net: FloakNet, request: JoinRequest, approved_by: str) -> None:
    """Create the person, their tracker, and their membership.

    A new subject is minted rather than reusing anything the requester sent,
    because the requester controls their display name and nothing else.
    """
    now = datetime.now(timezone.utc)
    subject_id = f"usr_{secrets.token_hex(4)}"
    tracker_id = f"trk_{subject_id}"

    await registry.upsert_subject(Subject(
        id=subject_id,
        org_id=net.org_id,
        kind=SubjectKind.person,
        label=request.display_name,
        tracker_id=tracker_id,
        share_mode=ShareMode.precise,
        metadata={"type": "net", "net_id": net.id},
    ))

    _members.setdefault(net.id, []).append(NetMember(
        net_id=net.id,
        subject_id=subject_id,
        display_name=request.display_name,
        role=net.default_role,
        joined_at=now,
        approved_by=approved_by,
    ))

    request.status = RequestStatus.approved
    request.subject_id = subject_id
    request.decided_by = approved_by
    request.decided_at = now


async def claim(request_id: str, claim_secret: str) -> ClaimResult:
    """Step two, polled by whoever asked to join.

    The secret is compared in constant time and a wrong one is indistinguishable
    from an unknown request id, so this cannot be used to enumerate requests.
    """
    request = _requests.get(request_id)
    if not request or not hmac.compare_digest(_hmac(claim_secret), request.claim_hash):
        raise NetError("No such request")

    if (request.status == RequestStatus.pending
            and request.expires_at <= datetime.now(timezone.utc)):
        request.status = RequestStatus.expired

    if request.status == RequestStatus.pending:
        return ClaimResult(
            status=RequestStatus.pending,
            net_name=request.net_name,
            note="Waiting for the host.",
        )

    if request.status != RequestStatus.approved:
        return ClaimResult(
            status=request.status,
            net_name=request.net_name,
            note=request.note or "The host did not approve this request.",
        )

    net = _nets[request.net_id]
    member = await membership(net.id, request.subject_id or "")
    if not member:
        return ClaimResult(
            status=RequestStatus.denied,
            net_name=net.name,
            note="Your access to this net was removed.",
        )

    return ClaimResult(
        status=RequestStatus.approved,
        net_id=net.id,
        net_name=net.name,
        subject_id=request.subject_id,
        role=member.role,
        access_token=issue_access_token(
            request.subject_id, net.org_id, Role.member, net_id=net.id,
        ),
    )


async def withdraw(request_id: str, claim_secret: str) -> JoinRequest:
    request = _requests.get(request_id)
    if not request or not hmac.compare_digest(_hmac(claim_secret), request.claim_hash):
        raise NetError("No such request")
    if request.status == RequestStatus.pending:
        request.status = RequestStatus.withdrawn
    return request


def _expire_stale() -> None:
    now = datetime.now(timezone.utc)
    for r in _requests.values():
        if r.status == RequestStatus.pending and r.expires_at <= now:
            r.status = RequestStatus.expired
