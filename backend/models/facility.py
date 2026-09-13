from __future__ import annotations
from typing import List, Literal, Optional
from pydantic import BaseModel

CategoryKey = Literal["parking", "carwash", "ev", "auto"]


class GeoPoint(BaseModel):
    type: str = "Point"
    coordinates: List[float]  # [lng, lat]


class FacilityProps(BaseModel):
    name: str
    address: str
    city: str
    state: str
    category: CategoryKey
    # optional fields
    type: Optional[str] = None
    phone: Optional[str] = None
    hours: Optional[str] = None
    notes: Optional[str] = None
    spaces: Optional[int] = None
    free: Optional[str] = None
    ev: Optional[str] = None
    network: Optional[str] = None
    ports: Optional[int] = None
    level: Optional[str] = None


class GeoFeature(BaseModel):
    type: str = "Feature"
    geometry: GeoPoint
    properties: FacilityProps


class FeatureCollection(BaseModel):
    type: str = "FeatureCollection"
    features: List[GeoFeature]
