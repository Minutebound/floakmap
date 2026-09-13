"""Rules that turn raw fixes into things a dispatcher should look at.

Every rule is stateless apart from a small per-subject memo, so this scales by
sharding subjects across pods. Rules are debounced: a van sitting at a red
light should not produce forty idle alerts.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from core.config import get_settings
from models.live import Alert, AlertKind, GeofenceEvent, Position, Severity, Subject

# subject_id -> {rule: last_raised_at}
_debounce: dict[str, dict[str, datetime]] = {}
# subject_id -> (lat, lon, since)
_idle_anchor: dict[str, tuple[float, float, datetime]] = {}

_COOLDOWN = {
    AlertKind.speeding: timedelta(minutes=5),
    AlertKind.idling: timedelta(minutes=15),
    AlertKind.low_battery: timedelta(hours=2),
    AlertKind.signal_lost: timedelta(minutes=30),
}
_IDLE_RADIUS_DEG = 0.0003   # roughly 30 m


def _fresh(subject_id: str, kind: AlertKind, now: datetime) -> bool:
    memo = _debounce.setdefault(subject_id, {})
    last = memo.get(kind.value)
    if last and now - last < _COOLDOWN.get(kind, timedelta(minutes=10)):
        return False
    memo[kind.value] = now
    return True


def _make(subject: Subject, kind: AlertKind, severity: Severity,
          message: str, pos: Optional[Position], now: datetime) -> Alert:
    return Alert(
        id=f"alr_{secrets.token_hex(5)}",
        org_id=subject.org_id,
        subject_id=subject.id,
        subject_label=subject.label,
        kind=kind,
        severity=severity,
        message=message,
        lat=pos.lat if pos else None,
        lon=pos.lon if pos else None,
        raised_at=now,
    )


def from_position(subject: Subject, pos: Position) -> list[Alert]:
    s = get_settings()
    now = pos.recorded_at
    out: list[Alert] = []

    if pos.speed_kmh and pos.speed_kmh > s.speeding_kmh:
        if _fresh(subject.id, AlertKind.speeding, now):
            out.append(_make(
                subject, AlertKind.speeding, Severity.warning,
                f"{subject.label} is doing {pos.speed_kmh:.0f} km/h",
                pos, now,
            ))

    if pos.battery_pct is not None and pos.battery_pct <= 15:
        if _fresh(subject.id, AlertKind.low_battery, now):
            out.append(_make(
                subject, AlertKind.low_battery, Severity.info,
                f"{subject.label}'s tracker is at {pos.battery_pct}%",
                pos, now,
            ))

    anchor = _idle_anchor.get(subject.id)
    moved = (
        anchor is None
        or abs(anchor[0] - pos.lat) > _IDLE_RADIUS_DEG
        or abs(anchor[1] - pos.lon) > _IDLE_RADIUS_DEG
    )
    if moved:
        _idle_anchor[subject.id] = (pos.lat, pos.lon, now)
    else:
        held = (now - anchor[2]).total_seconds() / 60
        engine_on = bool(pos.telemetry.get("engine_on"))
        if held >= s.idle_minutes and engine_on and _fresh(subject.id, AlertKind.idling, now):
            out.append(_make(
                subject, AlertKind.idling, Severity.warning,
                f"{subject.label} has idled {held:.0f} min with the engine running",
                pos, now,
            ))

    if pos.telemetry.get("sos"):
        out.append(_make(
            subject, AlertKind.sos, Severity.critical,
            f"{subject.label} triggered an SOS",
            pos, now,
        ))

    return out


def from_geofence(subject: Subject, event: GeofenceEvent) -> Alert:
    verb = {"enter": "arrived at", "exit": "left", "dwell": "is still sitting in"}[event.kind]
    return Alert(
        id=f"alr_{secrets.token_hex(5)}",
        org_id=subject.org_id,
        subject_id=subject.id,
        subject_label=subject.label,
        kind=AlertKind.geofence,
        severity=Severity.info,
        message=f"{subject.label} {verb} {event.geofence_name}",
        lat=event.lat,
        lon=event.lon,
        raised_at=event.occurred_at,
    )


def signal_lost(subject: Subject, last_seen: datetime) -> Optional[Alert]:
    now = datetime.now(timezone.utc)
    gap = (now - last_seen).total_seconds() / 60
    if not _fresh(subject.id, AlertKind.signal_lost, now):
        return None
    return _make(
        subject, AlertKind.signal_lost, Severity.warning,
        f"No signal from {subject.label} for {gap:.0f} min", None, now,
    )
