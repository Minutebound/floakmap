"""Position ingest. The only write path into the live system."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from core.config import get_settings
from core.security import Principal, current_principal
from models.live import IngestResult, PositionBatch
from services import tracking

router = APIRouter(prefix="/api/v1/ingest", tags=["ingest"])


@router.post("/positions", response_model=IngestResult)
async def ingest_positions(
    batch: PositionBatch,
    principal: Principal = Depends(current_principal),
) -> IngestResult:
    """Accepts one fix or a backlog flushed after a tunnel.

    Device keys may only report their own tracker. Without that check any
    leaked key could move any vehicle on the map.
    """
    s = get_settings()
    if len(batch.positions) > s.max_batch_size:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"Send at most {s.max_batch_size} positions per request",
        )

    if principal.tracker_id:
        foreign = [p for p in batch.positions if p.tracker_id != principal.tracker_id]
        if foreign:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "This device key can only report its own tracker",
            )

    future = [
        p for p in batch.positions
        if (p.recorded_at - datetime.now(timezone.utc)).total_seconds() > 300
    ]
    if future:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Some positions are timestamped in the future; check the device clock",
        )

    return await tracking.ingest_batch(batch.positions, principal.org_id)
