"""Event warehouse: positions, geofence events, alerts.

Writes go here first from ``services.tracking.ingest_batch``. If Postgres +
TimescaleDB is configured, they land in ``events_raw.*`` and become durable
history. If not, the in-memory `services.history` ring buffer keeps its
existing role — the app runs either way.

Segregation: every row carries (org_id, net_id). RLS in schema.sql filters
by org_id. Net-scoped queries just add an equality filter — no per-network
tables to create or migrate.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Iterable, Optional

from core.db import is_database_configured, session_for
from models.live import Alert, GeofenceEvent, Position

log = logging.getLogger(__name__)


async def record_positions(
    org_id: str,
    fixes: Iterable[tuple[str, str, Position]],   # (subject_id, tracker_id, pos)
    net_id: Optional[str] = None,
) -> int:
    """Bulk insert. Returns the count written. Silently no-ops when DB is off
    so the ingest path stays hot regardless of persistence configuration."""
    if not is_database_configured():
        return 0

    rows = list(fixes)
    if not rows:
        return 0

    from sqlalchemy import text
    async with session_for(org_id) as session:
        if session is None:
            return 0
        payload = [{
            "org_id": org_id, "net_id": net_id,
            "subject_id": sid, "tracker_id": tid,
            "recorded_at": p.recorded_at,
            "lat": p.lat, "lon": p.lon,
            "accuracy_m": p.accuracy_m, "speed_kmh": p.speed_kmh,
            "heading_deg": p.heading_deg, "altitude_m": p.altitude_m,
            "battery_pct": p.battery_pct,
            "telemetry": __import__("json").dumps(p.telemetry or {}),
        } for (sid, tid, p) in rows]
        try:
            await session.execute(text("""
                INSERT INTO events_raw.positions
                    (org_id, net_id, subject_id, tracker_id, recorded_at,
                     lat, lon, geom,
                     accuracy_m, speed_kmh, heading_deg, altitude_m,
                     battery_pct, telemetry)
                VALUES
                    (:org_id, :net_id, :subject_id, :tracker_id, :recorded_at,
                     :lat, :lon,
                     ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
                     :accuracy_m, :speed_kmh, :heading_deg, :altitude_m,
                     :battery_pct, :telemetry::jsonb)
            """), payload)
            return len(payload)
        except Exception as exc:                # pragma: no cover
            log.warning("position insert failed: %s", exc)
            return 0


async def record_geofence_events(
    org_id: str, events: Iterable[GeofenceEvent], net_id: Optional[str] = None,
) -> int:
    if not is_database_configured():
        return 0
    rows = list(events)
    if not rows:
        return 0
    from sqlalchemy import text
    async with session_for(org_id) as session:
        if session is None:
            return 0
        try:
            await session.execute(text("""
                INSERT INTO events_raw.geofence_events
                    (org_id, net_id, subject_id, geofence_id, geofence_name,
                     kind, occurred_at, lat, lon)
                VALUES
                    (:org_id, :net_id, :subject_id, :geofence_id, :geofence_name,
                     :kind, :occurred_at, :lat, :lon)
            """), [{
                "org_id": org_id, "net_id": net_id,
                "subject_id": e.subject_id, "geofence_id": e.geofence_id,
                "geofence_name": e.geofence_name, "kind": e.kind,
                "occurred_at": e.occurred_at, "lat": e.lat, "lon": e.lon,
            } for e in rows])
            return len(rows)
        except Exception as exc:               # pragma: no cover
            log.warning("geofence event insert failed: %s", exc)
            return 0


async def record_alerts(
    org_id: str, alerts: Iterable[Alert], net_id: Optional[str] = None,
) -> int:
    if not is_database_configured():
        return 0
    rows = list(alerts)
    if not rows:
        return 0
    from sqlalchemy import text
    async with session_for(org_id) as session:
        if session is None:
            return 0
        try:
            await session.execute(text("""
                INSERT INTO events_raw.alerts
                    (alert_id, org_id, net_id, subject_id, subject_label,
                     kind, severity, message, lat, lon, raised_at)
                VALUES
                    (:alert_id, :org_id, :net_id, :subject_id, :subject_label,
                     :kind, :severity, :message, :lat, :lon, :raised_at)
                ON CONFLICT (alert_id) DO NOTHING
            """), [{
                "alert_id": a.id, "org_id": org_id, "net_id": net_id,
                "subject_id": a.subject_id, "subject_label": a.subject_label,
                "kind": a.kind.value if hasattr(a.kind, "value") else a.kind,
                "severity": a.severity.value if hasattr(a.severity, "value") else a.severity,
                "message": a.message, "lat": a.lat, "lon": a.lon,
                "raised_at": a.raised_at,
            } for a in rows])
            return len(rows)
        except Exception as exc:               # pragma: no cover
            log.warning("alert insert failed: %s", exc)
            return 0


async def trail(
    org_id: str,
    subject_id: str,
    since: datetime,
    until: Optional[datetime] = None,
    max_points: int = 1000,
) -> list[dict]:
    """Warehouse-backed replay. Falls back to [] when DB is off — the caller
    should keep its in-memory ring buffer for that case."""
    if not is_database_configured():
        return []
    from sqlalchemy import text
    async with session_for(org_id) as session:
        if session is None:
            return []
        rows = (await session.execute(text("""
            SELECT recorded_at AS t, lat, lon, speed_kmh, heading_deg
              FROM marts.fct_positions
             WHERE org_id = :org AND subject_id = :sid
               AND recorded_at >= :since
               AND (:until IS NULL OR recorded_at <= :until)
             ORDER BY recorded_at
             LIMIT :lim
        """), {"org": org_id, "sid": subject_id,
               "since": since, "until": until, "lim": max_points})).mappings().all()
        return [dict(r) for r in rows]
