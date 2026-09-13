"""Fleet operations: who is where, what needs attention, where have they been."""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from core.security import Principal, current_principal, requires
from models.live import (
    Alert, Geofence, LiveState, ShareMode, Subject, SubjectKind,
)
from services import history, registry, tracking

router = APIRouter(prefix="/api/v1/fleet", tags=["fleet"])


@router.get("/live", response_model=list[LiveState])
async def live_fleet(
    kind: Optional[SubjectKind] = None,
    p: Principal = Depends(requires("fleet:read")),
) -> list[LiveState]:
    """Snapshot for first paint. The websocket takes over from here."""
    states = await tracking.snapshot(p.org_id)
    if kind:
        states = [s for s in states if s.kind == kind]
    return states


@router.get("/subjects", response_model=list[Subject])
async def list_subjects(
    kind: Optional[SubjectKind] = None,
    p: Principal = Depends(requires("fleet:read")),
) -> list[Subject]:
    return await registry.list_subjects(p.org_id, kind)


@router.post("/subjects", response_model=dict, status_code=status.HTTP_201_CREATED)
async def add_subject(
    label: str,
    kind: SubjectKind = SubjectKind.vehicle,
    color: Optional[str] = None,
    p: Principal = Depends(requires("fleet:write")),
) -> dict:
    """Adds a vehicle and returns its device key once. Storing the key is the
    caller's job; the server keeps only a hash."""
    from core.security import mint_device_key

    sid = f"sub_{secrets.token_hex(4)}"
    tid = f"trk_{sid}"
    raw_key, _hash = mint_device_key(tid)

    subject = await registry.upsert_subject(Subject(
        id=sid, org_id=p.org_id, kind=kind, label=label,
        tracker_id=tid, color=color,
    ))
    return {
        "subject": subject.model_dump(mode="json"),
        "device_key": raw_key,
        "note": "Copy this key now. It is not shown again.",
    }


@router.patch("/subjects/{subject_id}/sharing", response_model=Subject)
async def change_sharing(
    subject_id: str,
    mode: ShareMode,
    p: Principal = Depends(current_principal),
) -> Subject:
    """A driver can always turn their own sharing down. Turning someone
    else's down requires managing the fleet."""
    subject = await registry.get_subject(subject_id)
    if not subject or subject.org_id != p.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such subject")
    if subject.id != p.subject_id and not p.can("fleet:write"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only change your own sharing")
    return await registry.set_share_mode(subject_id, mode)


@router.get("/alerts", response_model=list[Alert])
async def list_alerts(
    limit: int = Query(50, le=200),
    p: Principal = Depends(requires("fleet:read")),
) -> list[Alert]:
    return await tracking.recent_alerts(p.org_id, limit)


@router.post("/alerts/{alert_id}/acknowledge", response_model=Alert)
async def acknowledge_alert(
    alert_id: str,
    p: Principal = Depends(requires("fleet:read")),
) -> Alert:
    alert = await tracking.acknowledge(p.org_id, alert_id, p.subject_id)
    if not alert:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such alert")
    return alert


@router.get("/subjects/{subject_id}/trail")
async def subject_trail(
    subject_id: str,
    hours: int = Query(8, ge=1, le=720),
    max_points: int = Query(1000, le=5000),
    p: Principal = Depends(current_principal),
) -> dict:
    """Breadcrumb trail as a GeoJSON LineString, ready to hand to MapLibre."""
    if not (p.can("history:read:all") or (p.can("history:read:own") and p.subject_id == subject_id)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only view your own history")

    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    rows = await history.trail(p.org_id, subject_id, since=since, max_points=max_points)
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": [[r["lon"], r["lat"]] for r in rows]},
        "properties": {
            "subject_id": subject_id,
            "point_count": len(rows),
            "timestamps": [r["t"] for r in rows],
        },
    }


@router.get("/subjects/{subject_id}/summary")
async def subject_summary(
    subject_id: str,
    hours: int = Query(24, ge=1, le=720),
    p: Principal = Depends(requires("history:read:all")),
) -> dict:
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    return await history.summarise(p.org_id, subject_id, since)


# --- geofences -------------------------------------------------------------

@router.get("/geofences", response_model=list[Geofence])
async def get_geofences(p: Principal = Depends(requires("fleet:read"))) -> list[Geofence]:
    return await registry.list_geofences(p.org_id)


@router.post("/geofences", response_model=Geofence, status_code=status.HTTP_201_CREATED)
async def create_geofence(
    fence: Geofence,
    p: Principal = Depends(requires("geofence:write")),
) -> Geofence:
    ring = fence.polygon[0] if fence.polygon else []
    if len(ring) < 4:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "A zone needs at least three corners",
        )
    if ring[0] != ring[-1]:
        fence.polygon[0].append(ring[0])     # close the ring for the caller
    fence = fence.model_copy(update={
        "id": fence.id or f"gf_{secrets.token_hex(4)}",
        "org_id": p.org_id,
    })
    return await registry.upsert_geofence(fence)


@router.delete("/geofences/{fence_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_geofence(
    fence_id: str,
    p: Principal = Depends(requires("geofence:write")),
) -> None:
    if not await registry.delete_geofence(p.org_id, fence_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such zone")
