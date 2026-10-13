"""GeoJSON layer endpoints backed directly by the warehouse.

Only meaningful when Postgres is configured. Without it these endpoints
return an empty FeatureCollection, so the frontend degrades gracefully
rather than 500-ing.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends

from core.db import is_database_configured, session_for
from core.security import Principal, current_principal

router = APIRouter(prefix="/api/v1/layers", tags=["layers"])

_EMPTY = {"type": "FeatureCollection", "features": []}


async def _geojson_from(table: str, org_id: str,
                        where: Optional[str] = None) -> dict:
    if not is_database_configured():
        return _EMPTY
    from sqlalchemy import text
    async with session_for(org_id) as session:
        if session is None:
            return _EMPTY
        # Safe: `table` and `where` are internal constants below, never user input.
        clause = f"WHERE {where}" if where else ""
        row = (await session.execute(text(f"""
            SELECT jsonb_build_object(
                'type', 'FeatureCollection',
                'features', COALESCE(jsonb_agg(features.feature), '[]'::jsonb)
            )
              FROM (
                SELECT jsonb_build_object(
                    'type', 'Feature',
                    'geometry', ST_AsGeoJSON(geom)::jsonb,
                    'properties', to_jsonb(inputs) - 'geom'
                ) AS feature
                  FROM (SELECT * FROM {table} {clause}) inputs
              ) features
        """))).scalar()
        return row or _EMPTY


@router.get("/geofences")
async def geofences(p: Principal = Depends(current_principal)) -> dict:
    return await _geojson_from("app.geofences", p.org_id, "active")


@router.get("/positions/latest")
async def latest_positions(p: Principal = Depends(current_principal)) -> dict:
    """One point per subject, using the latest fix within the last hour."""
    if not is_database_configured():
        return _EMPTY
    from sqlalchemy import text
    async with session_for(p.org_id) as session:
        if session is None:
            return _EMPTY
        row = (await session.execute(text("""
            WITH latest AS (
                SELECT DISTINCT ON (subject_id)
                       subject_id, recorded_at, lat, lon, speed_kmh, heading_deg
                  FROM marts.fct_positions
                 WHERE org_id = :org
                   AND recorded_at >= NOW() - INTERVAL '1 hour'
                 ORDER BY subject_id, recorded_at DESC
            )
            SELECT jsonb_build_object(
                'type', 'FeatureCollection',
                'features', COALESCE(jsonb_agg(
                    jsonb_build_object(
                      'type', 'Feature',
                      'geometry', jsonb_build_object(
                          'type', 'Point',
                          'coordinates', jsonb_build_array(lon, lat)
                      ),
                      'properties', to_jsonb(latest) - 'lat' - 'lon'
                    )
                ), '[]'::jsonb)
            )
              FROM latest
        """), {"org": p.org_id})).scalar()
        return row or _EMPTY
