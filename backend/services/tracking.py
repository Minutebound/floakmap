"""The ingest pipeline. Every fix in the system goes through `ingest_batch`.

    device -> validate -> throttle -> privacy filter -> cache last known
           -> geofence -> alerts -> publish to bus -> append to history

Ordering matters: privacy is applied before anything is stored or published,
so an "approximate" subject never has precise coordinates sitting in Redis
waiting to leak.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Iterable, Optional

from core.config import get_settings
from models.live import (
    Alert, GeofenceEvent, IngestResult, LiveState, Position, ShareMode, Subject,
)
from services import alerts as alert_rules
from services import geofence as geo
from services import registry
from services.bus import get_bus
from services.history import append_fix

# tracker_id -> last accepted timestamp, for throttling
_last_fix: dict[str, datetime] = {}
# org_id -> recent alerts, newest first (Postgres in production)
_alert_log: dict[str, list[Alert]] = {}

EARTH_R_KM = 6371.0


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R_KM * math.asin(math.sqrt(a))


def _blur(lat: float, lon: float, metres: int) -> tuple[float, float]:
    """Snap to a grid rather than adding noise. Noise jitters frame to frame
    and a viewer can average it away; a grid cell is stable and honest."""
    step = metres / 111_320
    return (round(lat / step) * step, round(lon / step) * step)


def _apply_privacy(subject: Subject, pos: Position) -> Optional[Position]:
    s = get_settings()
    if subject.share_mode in (ShareMode.off, ShareMode.paused):
        return None
    if subject.share_mode == ShareMode.approximate:
        lat, lon = _blur(pos.lat, pos.lon, s.approximate_precision_m)
        return pos.model_copy(update={
            "lat": lat, "lon": lon,
            "accuracy_m": float(s.approximate_precision_m),
            "speed_kmh": None, "heading_deg": None,
        })
    return pos


def _to_state(subject: Subject, pos: Position, stale: bool = False) -> LiveState:
    return LiveState(
        subject_id=subject.id,
        label=subject.label,
        kind=subject.kind,
        lat=pos.lat,
        lon=pos.lon,
        heading_deg=pos.heading_deg,
        speed_kmh=pos.speed_kmh,
        battery_pct=pos.battery_pct,
        accuracy_m=pos.accuracy_m,
        recorded_at=pos.recorded_at,
        stale=stale,
        share_mode=subject.share_mode,
        color=subject.color,
        telemetry=pos.telemetry,
    )


async def ingest_batch(positions: Iterable[Position], org_id: str) -> IngestResult:
    s = get_settings()
    bus = get_bus()
    fences = await registry.list_geofences(org_id)

    accepted = throttled = rejected = 0
    states: list[LiveState] = []
    events: list[GeofenceEvent] = []
    raised: list[Alert] = []

    for pos in sorted(positions, key=lambda p: p.recorded_at):
        subject = await registry.subject_for_tracker(pos.tracker_id)
        if not subject or subject.org_id != org_id:
            rejected += 1
            continue

        previous = _last_fix.get(pos.tracker_id)
        if previous and (pos.recorded_at - previous).total_seconds() < s.min_seconds_between_fixes:
            throttled += 1
            continue
        if pos.accuracy_m is not None and pos.accuracy_m > 2000:
            rejected += 1          # a fix this vague is worse than no fix
            continue

        _last_fix[pos.tracker_id] = pos.recorded_at

        # History keeps the true fix; only the live feed is blurred, because
        # the account owner is entitled to their own raw trail.
        await append_fix(org_id, subject.id, pos)

        shared = _apply_privacy(subject, pos)
        accepted += 1
        if shared is None:
            continue

        state = _to_state(subject, shared)
        states.append(state)
        await bus.set_last(org_id, subject.id, state.model_dump(mode="json"))

        for ev in geo.evaluate(subject.id, shared, fences):
            events.append(ev)
            raised.append(alert_rules.from_geofence(subject, ev))
        raised.extend(alert_rules.from_position(subject, shared))

    if states:
        await bus.publish(org_id, {
            "type": "positions",
            "data": [st.model_dump(mode="json") for st in states],
        })
    for ev in events:
        await bus.publish(org_id, {"type": "geofence_event", "data": ev.model_dump(mode="json")})
    for alert in raised:
        log = _alert_log.setdefault(org_id, [])
        log.insert(0, alert)
        del log[200:]
        await bus.publish(org_id, {"type": "alert", "data": alert.model_dump(mode="json")})

    return IngestResult(
        accepted=accepted,
        throttled=throttled,
        rejected=rejected,
        events=events,
        server_time=datetime.now(timezone.utc),
    )


async def snapshot(org_id: str, subject_ids: Optional[list[str]] = None) -> list[LiveState]:
    """Current state of everything, with staleness computed at read time so a
    van that went quiet ten minutes ago shows as quiet without needing a
    background sweep to mark it."""
    s = get_settings()
    now = datetime.now(timezone.utc)
    rows = await get_bus().snapshot(org_id)

    out: list[LiveState] = []
    for row in rows:
        state = LiveState.model_validate(row)
        if subject_ids and state.subject_id not in subject_ids:
            continue
        state.stale = (now - state.recorded_at).total_seconds() > s.stale_after_seconds
        out.append(state)
    return sorted(out, key=lambda st: st.label)


async def recent_alerts(org_id: str, limit: int = 50) -> list[Alert]:
    return _alert_log.get(org_id, [])[:limit]


async def acknowledge(org_id: str, alert_id: str, by: str) -> Optional[Alert]:
    for a in _alert_log.get(org_id, []):
        if a.id == alert_id:
            a.acknowledged_by = by
            a.acknowledged_at = datetime.now(timezone.utc)
            return a
    return None
