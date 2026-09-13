"""Trips: the consumer half of the product.

A trip is a temporary, self-destructing fleet. Same pipeline, different policy:
membership is by invite code, viewers do not need accounts, and the whole thing
stops existing when `expires_at` passes. Nobody has to remember to turn sharing
off, which is the failure mode of every location-sharing app.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from core.security import Principal, current_principal, issue_share_token, requires
from models.live import LiveState, Trip, TripMemberEta
from services import registry, tracking

router = APIRouter(prefix="/api/v1/trips", tags=["trips"])

ASSUMED_KMH = 75.0   # fallback when a member is stopped and has no speed


class CreateTrip(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    hours: int = Field(default=8, ge=1, le=24)
    destination: Optional[list[float]] = None   # [lon, lat]


@router.get("", response_model=list[Trip])
async def my_trips(p: Principal = Depends(current_principal)) -> list[Trip]:
    trips = await registry.list_trips(p.org_id)
    if p.can("history:read:all"):
        return trips
    return [t for t in trips if p.subject_id in t.member_subject_ids]


@router.post("", response_model=Trip, status_code=status.HTTP_201_CREATED)
async def start_trip(
    body: CreateTrip,
    p: Principal = Depends(requires("trip:write")),
) -> Trip:
    return await registry.create_trip(
        org_id=p.org_id,
        name=body.name,
        created_by=p.subject_id,
        hours=body.hours,
        destination=body.destination,
    )


@router.post("/join", response_model=Trip)
async def join_trip(
    code: str = Query(min_length=4, max_length=12),
    p: Principal = Depends(requires("trip:write")),
) -> Trip:
    trip = await registry.find_trip_by_code(code)
    if not trip or trip.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That code does not match an open trip")
    if p.subject_id not in trip.member_subject_ids:
        trip.member_subject_ids.append(p.subject_id)
    return trip


@router.post("/{trip_id}/share-link")
async def create_share_link(
    trip_id: str,
    hours: int = Query(4, ge=1, le=24),
    p: Principal = Depends(requires("trip:write")),
) -> dict:
    """A read-only link for someone who is not in the trip: a partner watching
    the drive home, a client waiting on a delivery."""
    trip = await registry.get_trip(trip_id)
    if not trip or trip.org_id != p.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such trip")
    if p.subject_id not in trip.member_subject_ids and not p.can("history:read:all"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only members can share a trip")

    token = issue_share_token(trip.id, trip.org_id, hours)
    expires = min(
        trip.expires_at,
        datetime.now(timezone.utc).replace(microsecond=0),
    )
    return {
        "url": f"/follow/{token}",
        "expires_at": trip.expires_at if trip.expires_at < expires else trip.expires_at,
        "hours": hours,
        "note": "Anyone with this link can watch the trip until it expires.",
    }


@router.get("/{trip_id}/live", response_model=list[LiveState])
async def trip_live(
    trip_id: str,
    p: Principal = Depends(current_principal),
) -> list[LiveState]:
    trip = await _readable_trip(trip_id, p)
    return await tracking.snapshot(p.org_id, trip.member_subject_ids)


@router.get("/{trip_id}/etas", response_model=list[TripMemberEta])
async def trip_etas(
    trip_id: str,
    p: Principal = Depends(current_principal),
) -> list[TripMemberEta]:
    """Straight-line ETA to the trip destination.

    Deliberately naive: no routing provider, no API key, no cost. Swap in
    OSRM or Valhalla by replacing the two lines below when road-accurate ETAs
    are worth the dependency.
    """
    trip = await _readable_trip(trip_id, p)
    if not trip.destination:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This trip has no destination set")

    dest_lon, dest_lat = trip.destination
    out: list[TripMemberEta] = []
    for state in await tracking.snapshot(p.org_id, trip.member_subject_ids):
        km = tracking.haversine_km(state.lat, state.lon, dest_lat, dest_lon)
        speed = state.speed_kmh if (state.speed_kmh or 0) > 5 else ASSUMED_KMH
        out.append(TripMemberEta(
            subject_id=state.subject_id,
            label=state.label,
            distance_km=round(km, 1),
            eta_minutes=None if km < 0.2 else round(km / speed * 60, 0),
            arrived=km < 0.2,
        ))
    return sorted(out, key=lambda m: m.distance_km)


@router.post("/{trip_id}/end", response_model=Trip)
async def end_trip(
    trip_id: str,
    p: Principal = Depends(requires("trip:write")),
) -> Trip:
    trip = await registry.get_trip(trip_id)
    if not trip or trip.org_id != p.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such trip")
    trip.active = False
    trip.expires_at = datetime.now(timezone.utc)
    return trip


async def _readable_trip(trip_id: str, p: Principal) -> Trip:
    trip = await registry.get_trip(trip_id)
    if not trip or trip.org_id != p.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such trip")
    if trip.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_410_GONE, "This trip has ended")

    guest_ok = p.trip_id == trip_id
    member_ok = p.subject_id in trip.member_subject_ids
    if not (guest_ok or member_ok or p.can("history:read:all")):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not on this trip")
    return trip
