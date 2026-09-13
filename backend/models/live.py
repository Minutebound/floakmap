"""Wire formats for everything that moves.

One idea holds the whole product together: a *subject* is anything whose
position matters. A friend on a road trip and a refrigerated van are the same
shape on the wire. What differs is the audience policy attached to them --
a trip (temporary, invite-based, self-destructing) or a fleet (permanent,
org-scoped, role-gated). One pipeline, two policy layers.
"""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator


class SubjectKind(str, Enum):
    person = "person"
    vehicle = "vehicle"
    asset = "asset"     # trailer, tool crate, generator


class ShareMode(str, Enum):
    precise = "precise"          # exact coordinates
    approximate = "approximate"  # snapped to a coarse grid
    paused = "paused"            # last known point frozen, no updates
    off = "off"                  # nothing leaves the device


class Position(BaseModel):
    """A single GPS fix as the device reports it."""
    tracker_id: str
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    recorded_at: datetime
    accuracy_m: Optional[float] = Field(default=None, ge=0)
    speed_kmh: Optional[float] = Field(default=None, ge=0)
    heading_deg: Optional[float] = Field(default=None, ge=0, lt=360)
    altitude_m: Optional[float] = None
    battery_pct: Optional[int] = Field(default=None, ge=0, le=100)
    # Free-form telemetry: fuel_pct, engine_on, door_open, temp_c, odometer_km.
    telemetry: dict[str, Any] = Field(default_factory=dict)

    @field_validator("recorded_at")
    @classmethod
    def _tz_aware(cls, v: datetime) -> datetime:
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)


class PositionBatch(BaseModel):
    """Devices buffer while offline and flush on reconnect, so ingest is
    always a batch even when it holds one fix."""
    positions: list[Position]
    client_sent_at: Optional[datetime] = None


class IngestResult(BaseModel):
    accepted: int
    throttled: int
    rejected: int
    events: list["GeofenceEvent"] = Field(default_factory=list)
    server_time: datetime


class Subject(BaseModel):
    """A person, vehicle or asset being followed."""
    id: str
    org_id: str
    kind: SubjectKind
    label: str                       # "Maya", "Van 12", "Trailer B"
    tracker_id: Optional[str] = None
    color: Optional[str] = None      # overrides the palette default
    avatar_url: Optional[str] = None
    share_mode: ShareMode = ShareMode.precise
    metadata: dict[str, Any] = Field(default_factory=dict)


class LiveState(BaseModel):
    """What a viewer receives for one subject."""
    subject_id: str
    label: str
    kind: SubjectKind
    lat: float
    lon: float
    heading_deg: Optional[float] = None
    speed_kmh: Optional[float] = None
    battery_pct: Optional[int] = None
    accuracy_m: Optional[float] = None
    recorded_at: datetime
    stale: bool = False
    share_mode: ShareMode = ShareMode.precise
    color: Optional[str] = None
    telemetry: dict[str, Any] = Field(default_factory=dict)


# --- geofencing ------------------------------------------------------------

class GeofenceTrigger(str, Enum):
    enter = "enter"
    exit = "exit"
    both = "both"
    dwell = "dwell"   # inside longer than dwell_minutes


class Geofence(BaseModel):
    id: str
    org_id: str
    name: str
    # GeoJSON Polygon rings, same shape MapLibre draws.
    polygon: list[list[list[float]]]
    trigger: GeofenceTrigger = GeofenceTrigger.both
    dwell_minutes: int = 10
    subject_ids: list[str] = Field(default_factory=list)  # empty = all subjects
    active: bool = True
    color: str = "#7c5cff"


class GeofenceEvent(BaseModel):
    geofence_id: str
    geofence_name: str
    subject_id: str
    kind: Literal["enter", "exit", "dwell"]
    lat: float
    lon: float
    occurred_at: datetime


# --- alerts ----------------------------------------------------------------

class AlertKind(str, Enum):
    speeding = "speeding"
    idling = "idling"
    signal_lost = "signal_lost"
    low_battery = "low_battery"
    geofence = "geofence"
    off_route = "off_route"
    sos = "sos"


class Severity(str, Enum):
    info = "info"
    warning = "warning"
    critical = "critical"


class Alert(BaseModel):
    id: str
    org_id: str
    subject_id: str
    subject_label: str
    kind: AlertKind
    severity: Severity
    message: str
    lat: Optional[float] = None
    lon: Optional[float] = None
    raised_at: datetime
    acknowledged_by: Optional[str] = None
    acknowledged_at: Optional[datetime] = None


# --- trips (consumer side) --------------------------------------------------

class Trip(BaseModel):
    id: str
    org_id: str
    name: str                    # "Moab weekend"
    created_by: str
    invite_code: str             # 6 chars, human-readable
    member_subject_ids: list[str] = Field(default_factory=list)
    destination: Optional[list[float]] = None   # [lon, lat]
    starts_at: Optional[datetime] = None
    expires_at: datetime
    active: bool = True


class TripMemberEta(BaseModel):
    subject_id: str
    label: str
    distance_km: float
    eta_minutes: Optional[float]
    arrived: bool = False


# --- websocket envelope -----------------------------------------------------

class ServerFrame(BaseModel):
    """Every websocket message the server sends uses this envelope so the
    client has exactly one switch statement."""
    type: Literal[
        "snapshot",     # full state on connect
        "positions",    # delta batch
        "alert",
        "geofence_event",
        "subject_left",
        "pong",
        "error",
    ]
    seq: int = 0
    at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    data: Any = None


class ClientFrame(BaseModel):
    """Viewport lets the server skip subjects that are off screen, which is
    what keeps a 5,000-vehicle account from shipping 5,000 updates a second."""
    type: Literal["subscribe", "viewport", "ping", "follow"]
    subject_ids: Optional[list[str]] = None
    bbox: Optional[list[float]] = None      # [west, south, east, north]
    follow_subject_id: Optional[str] = None


IngestResult.model_rebuild()
