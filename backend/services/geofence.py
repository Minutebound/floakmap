"""Geofence evaluation.

Runs in the ingest path, so it has to be cheap. Two-stage: bounding-box reject
first (an integer comparison per fence), then ray-casting only for survivors.
With PostGIS available, swap `_point_in_polygon` for ST_Contains against a
GiST index and the same interface holds.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from models.live import Geofence, GeofenceEvent, GeofenceTrigger, Position

# subject_id -> {geofence_id: (inside, since)}
_membership: dict[str, dict[str, tuple[bool, datetime]]] = {}


def _bbox(polygon: list[list[list[float]]]) -> tuple[float, float, float, float]:
    ring = polygon[0]
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    return min(lons), min(lats), max(lons), max(lats)


def _point_in_polygon(lon: float, lat: float, polygon: list[list[list[float]]]) -> bool:
    """Ray casting against the outer ring, minus any holes."""
    def in_ring(ring: list[list[float]]) -> bool:
        inside = False
        n = len(ring)
        for i in range(n):
            x1, y1 = ring[i]
            x2, y2 = ring[(i + 1) % n]
            if (y1 > lat) != (y2 > lat):
                x_at = (x2 - x1) * (lat - y1) / (y2 - y1) + x1
                if lon < x_at:
                    inside = not inside
        return inside

    if not polygon or not in_ring(polygon[0]):
        return False
    return not any(in_ring(hole) for hole in polygon[1:])


def evaluate(
    subject_id: str,
    position: Position,
    fences: list[Geofence],
) -> list[GeofenceEvent]:
    """Compare this fix against every fence and emit only the transitions."""
    now = position.recorded_at or datetime.now(timezone.utc)
    state = _membership.setdefault(subject_id, {})
    events: list[GeofenceEvent] = []

    for fence in fences:
        if fence.subject_ids and subject_id not in fence.subject_ids:
            continue

        west, south, east, north = _bbox(fence.polygon)
        inside = (
            west <= position.lon <= east
            and south <= position.lat <= north
            and _point_in_polygon(position.lon, position.lat, fence.polygon)
        )

        was_inside, since = state.get(fence.id, (False, now))
        kind: Optional[str] = None

        if inside and not was_inside:
            kind, since = "enter", now
        elif was_inside and not inside:
            kind, since = "exit", now
        elif inside and was_inside and fence.trigger == GeofenceTrigger.dwell:
            held = (now - since).total_seconds() / 60
            if held >= fence.dwell_minutes:
                kind, since = "dwell", now   # re-arm so dwell repeats

        state[fence.id] = (inside, since)

        wanted = {
            GeofenceTrigger.enter: {"enter"},
            GeofenceTrigger.exit: {"exit"},
            GeofenceTrigger.both: {"enter", "exit"},
            GeofenceTrigger.dwell: {"dwell"},
        }[fence.trigger]

        if kind and kind in wanted:
            events.append(GeofenceEvent(
                geofence_id=fence.id,
                geofence_name=fence.name,
                subject_id=subject_id,
                kind=kind,
                lat=position.lat,
                lon=position.lon,
                occurred_at=now,
            ))

    return events


def forget(subject_id: str) -> None:
    _membership.pop(subject_id, None)
