"""Subject / tracker / geofence registry.

Backed by Postgres in production. The in-memory dict below is deliberately
behind the same async interface, so swapping in SQLAlchemy later touches this
file only. Seeded with one demo org so the app is usable the moment it boots.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from core.security import hash_device_key
from models.live import Geofence, ShareMode, Subject, SubjectKind, Trip

DEMO_ORG = "org_demo"

_subjects: dict[str, Subject] = {}
_trackers: dict[str, str] = {}        # tracker_id -> subject_id
_device_keys: dict[str, dict] = {}    # key_hash   -> {tracker_id, org_id}
_geofences: dict[str, Geofence] = {}
_trips: dict[str, Trip] = {}


def _seed() -> None:
    """Six vehicles around Parker, CO plus a three-person road trip, so the
    map has something moving on first load."""
    fleet = [
        ("veh_01", "Van 12",       SubjectKind.vehicle, "#2563eb"),
        ("veh_02", "Van 14",       SubjectKind.vehicle, "#0891b2"),
        ("veh_03", "Flatbed 3",    SubjectKind.vehicle, "#ea580c"),
        ("veh_04", "Service 7",    SubjectKind.vehicle, "#16a34a"),
        ("veh_05", "Service 9",    SubjectKind.vehicle, "#c026d3"),
        ("veh_06", "Trailer B",    SubjectKind.asset,   "#64748b"),
    ]
    for sid, label, kind, color in fleet:
        tid = f"trk_{sid}"
        _subjects[sid] = Subject(
            id=sid, org_id=DEMO_ORG, kind=kind, label=label,
            tracker_id=tid, color=color,
            metadata={"plate": f"CO-{sid[-2:]}84", "type": "fleet"},
        )
        _trackers[tid] = sid
        _device_keys[hash_device_key(f"demo-key-{sid}")] = {
            "tracker_id": tid, "org_id": DEMO_ORG,
        }

    for sid, label in [("usr_maya", "Maya"), ("usr_dev", "Dev"), ("usr_sam", "Sam")]:
        tid = f"trk_{sid}"
        _subjects[sid] = Subject(
            id=sid, org_id=DEMO_ORG, kind=SubjectKind.person, label=label,
            tracker_id=tid, share_mode=ShareMode.precise,
            metadata={"type": "trip"},
        )
        _trackers[tid] = sid
        _device_keys[hash_device_key(f"demo-key-{sid}")] = {
            "tracker_id": tid, "org_id": DEMO_ORG,
        }

    _geofences["gf_yard"] = Geofence(
        id="gf_yard", org_id=DEMO_ORG, name="Depot yard",
        polygon=[[
            [-104.780, 39.508], [-104.760, 39.508],
            [-104.760, 39.522], [-104.780, 39.522], [-104.780, 39.508],
        ]],
        color="#7c5cff",
    )

    _trips["trip_moab"] = Trip(
        id="trip_moab", org_id=DEMO_ORG, name="Moab weekend",
        created_by="usr_maya", invite_code="MOAB24",
        member_subject_ids=["usr_maya", "usr_dev", "usr_sam"],
        destination=[-109.549, 38.573],
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    )


_seed()


async def lookup_device_key(raw_key: str) -> Optional[dict]:
    return _device_keys.get(hash_device_key(raw_key))


async def subject_for_tracker(tracker_id: str) -> Optional[Subject]:
    sid = _trackers.get(tracker_id)
    return _subjects.get(sid) if sid else None


async def get_subject(subject_id: str) -> Optional[Subject]:
    return _subjects.get(subject_id)


async def list_subjects(org_id: str, kind: Optional[SubjectKind] = None) -> list[Subject]:
    return [
        s for s in _subjects.values()
        if s.org_id == org_id and (kind is None or s.kind == kind)
    ]


async def upsert_subject(subject: Subject) -> Subject:
    _subjects[subject.id] = subject
    if subject.tracker_id:
        _trackers[subject.tracker_id] = subject.id
    return subject


async def set_share_mode(subject_id: str, mode: ShareMode) -> Optional[Subject]:
    s = _subjects.get(subject_id)
    if s:
        s.share_mode = mode
    return s


async def list_geofences(org_id: str) -> list[Geofence]:
    return [g for g in _geofences.values() if g.org_id == org_id and g.active]


async def upsert_geofence(fence: Geofence) -> Geofence:
    _geofences[fence.id] = fence
    return fence


async def delete_geofence(org_id: str, fence_id: str) -> bool:
    f = _geofences.get(fence_id)
    if f and f.org_id == org_id:
        del _geofences[fence_id]
        return True
    return False


async def list_trips(org_id: str) -> list[Trip]:
    now = datetime.now(timezone.utc)
    return [t for t in _trips.values() if t.org_id == org_id and t.expires_at > now]


async def get_trip(trip_id: str) -> Optional[Trip]:
    return _trips.get(trip_id)


async def find_trip_by_code(code: str) -> Optional[Trip]:
    return next((t for t in _trips.values() if t.invite_code == code.upper()), None)


async def create_trip(org_id: str, name: str, created_by: str,
                      hours: int, destination: Optional[list[float]]) -> Trip:
    trip = Trip(
        id=f"trip_{secrets.token_hex(4)}",
        org_id=org_id,
        name=name,
        created_by=created_by,
        invite_code=secrets.token_hex(3).upper(),
        member_subject_ids=[created_by],
        destination=destination,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=hours),
    )
    _trips[trip.id] = trip
    return trip
