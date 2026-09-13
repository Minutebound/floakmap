"""Position history: trip replay, distance travelled, utilisation reports.

In production this is a TimescaleDB hypertable (see db/schema.sql) partitioned
by day and compressed after a week, which is what makes "replay Tuesday for
Van 12" a sub-second query over months of data. The ring buffer below keeps
the interface honest for local dev.
"""
from __future__ import annotations

from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Optional

from models.live import Position

_MAX_POINTS = 5000
_trails: dict[str, deque] = defaultdict(lambda: deque(maxlen=_MAX_POINTS))


def _key(org_id: str, subject_id: str) -> str:
    return f"{org_id}:{subject_id}"


async def append_fix(org_id: str, subject_id: str, pos: Position) -> None:
    _trails[_key(org_id, subject_id)].append({
        "lat": pos.lat,
        "lon": pos.lon,
        "t": pos.recorded_at,
        "speed_kmh": pos.speed_kmh,
        "heading_deg": pos.heading_deg,
    })


async def trail(
    org_id: str,
    subject_id: str,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    max_points: int = 1000,
) -> list[dict]:
    """Returns a GeoJSON-ready coordinate list, decimated to max_points.

    Decimation is nth-point sampling with the endpoints pinned. For production
    use Douglas-Peucker (PostGIS ST_Simplify) so corners survive; nth-point can
    round off a sharp turn.
    """
    rows = list(_trails.get(_key(org_id, subject_id), []))
    if since:
        rows = [r for r in rows if r["t"] >= since]
    if until:
        rows = [r for r in rows if r["t"] <= until]
    if len(rows) <= max_points:
        return rows

    step = len(rows) / max_points
    picked = [rows[int(i * step)] for i in range(max_points)]
    picked[-1] = rows[-1]
    return picked


async def summarise(org_id: str, subject_id: str, since: datetime) -> dict:
    """Distance, moving time and top speed. The numbers behind a utilisation
    report or a mileage claim."""
    from services.tracking import haversine_km

    rows = await trail(org_id, subject_id, since=since, max_points=_MAX_POINTS)
    if len(rows) < 2:
        return {"distance_km": 0.0, "moving_minutes": 0.0, "max_speed_kmh": 0.0, "fixes": len(rows)}

    distance = 0.0
    moving = 0.0
    top = 0.0
    for a, b in zip(rows, rows[1:]):
        leg = haversine_km(a["lat"], a["lon"], b["lat"], b["lon"])
        gap = (b["t"] - a["t"]).total_seconds() / 60
        distance += leg
        if leg > 0.01:              # ignore GPS drift while parked
            moving += gap
        top = max(top, b.get("speed_kmh") or 0.0)

    return {
        "distance_km": round(distance, 2),
        "moving_minutes": round(moving, 1),
        "max_speed_kmh": round(top, 1),
        "fixes": len(rows),
        "since": since,
        "until": datetime.now(timezone.utc),
    }
