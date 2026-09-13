"""FloakNet: a private, named network people ask to join.

The security shape matters more than the feature list, so it is worth stating
plainly:

    The join code is not a credential. It is an address.

Knowing the code lets you *ask* to join and nothing else. A code that grants
access is a password that gets screenshotted, forwarded, read aloud in a cafe
and pasted into a group chat. Here the only thing a leaked code buys an
attacker is the ability to appear in the host's pending queue, where a human
looks at them.

What actually grants access is a membership issued by the host, and what
proves the host approved the right person is a fingerprint the requester reads
out over a channel the attacker does not control.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class NetRole(str, Enum):
    host = "host"        # approve, revoke, rotate the code, rename, archive
    member = "member"    # share position, see other members
    viewer = "viewer"    # see members, never shares its own position


class RequestStatus(str, Enum):
    pending = "pending"
    approved = "approved"
    denied = "denied"
    expired = "expired"
    withdrawn = "withdrawn"


class FloakNet(BaseModel):
    id: str
    org_id: str
    name: str
    host_subject_id: str
    # Only the HMAC is stored. A database dump yields no working codes.
    code_hash: str = Field(exclude=True)
    code_rotated_at: datetime
    require_approval: bool = True
    max_members: int = 50
    default_role: NetRole = NetRole.member
    created_at: datetime
    archived_at: Optional[datetime] = None


class NetMember(BaseModel):
    net_id: str
    subject_id: str
    display_name: str
    role: NetRole
    joined_at: datetime
    revoked_at: Optional[datetime] = None
    # Why this person is on the net, kept for the audit trail.
    approved_by: Optional[str] = None


class JoinRequest(BaseModel):
    id: str
    net_id: str
    net_name: str
    display_name: str
    # Three groups the requester reads aloud so the host can confirm they are
    # approving the person they think they are. Derived from the claim secret,
    # so it cannot be chosen or replayed by someone else.
    fingerprint: str
    status: RequestStatus = RequestStatus.pending
    requested_at: datetime
    expires_at: datetime
    # HMAC of the claim secret. The requester keeps the plaintext; it is how
    # they collect their membership without having an account yet.
    claim_hash: str = Field(exclude=True)
    subject_id: Optional[str] = None
    decided_by: Optional[str] = None
    decided_at: Optional[datetime] = None
    note: Optional[str] = None


# --- request and response bodies -------------------------------------------

class CreateNet(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    require_approval: bool = True
    max_members: int = Field(default=50, ge=2, le=500)
    default_role: NetRole = NetRole.member


class NetCreated(BaseModel):
    net: FloakNet
    join_code: str
    note: str = "Share this code however you like. It only lets someone ask to join."


class JoinNet(BaseModel):
    code: str = Field(min_length=4, max_length=32)
    display_name: str = Field(min_length=1, max_length=40)


class JoinSubmitted(BaseModel):
    """What the person asking to join gets back.

    No detail about the net beyond its name — an unapproved requester should
    not learn the member list, the host, or how many people are on it.
    """
    request_id: str
    net_name: str
    fingerprint: str
    claim_secret: str
    status: RequestStatus
    expires_at: datetime
    note: str = "Read the fingerprint to the host so they know it is you."


class ClaimResult(BaseModel):
    status: RequestStatus
    net_id: Optional[str] = None
    net_name: Optional[str] = None
    subject_id: Optional[str] = None
    access_token: Optional[str] = None
    role: Optional[NetRole] = None
    note: Optional[str] = None


class PendingRequest(BaseModel):
    """The host's view of the queue. Deliberately thin: a display name the
    requester chose is not evidence of anything, so the fingerprint is what
    the host is meant to act on."""
    id: str
    display_name: str
    fingerprint: str
    requested_at: datetime
    expires_at: datetime
