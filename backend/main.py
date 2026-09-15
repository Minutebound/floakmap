from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# near the top, replace the existing core.config import
from core.config import cors_origins_list, get_settings
from routers import auth, facilities, fleet, floaknet, ingest, trips
from services import alerts as alert_rules
from services import registry
from services.bus import get_bus
from ws import live

settings = get_settings()


async def _watch_for_silence():
    """Raise signal-lost alerts for trackers that stopped reporting.

    Every other alert rule fires on an incoming fix. A vehicle that goes dark
    produces no fix to react to, so something has to go looking.
    """
    bus = get_bus()
    while True:
        await asyncio.sleep(60)
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=settings.stale_after_seconds)
        for subject in await registry.list_subjects(registry.DEMO_ORG):
            last = await bus.get_last(subject.org_id, subject.id)
            if not last:
                continue
            seen = datetime.fromisoformat(str(last["recorded_at"]))
            if seen < cutoff:
                alert = alert_rules.signal_lost(subject, seen)
                if alert:
                    await bus.publish(subject.org_id, {
                        "type": "alert",
                        "data": alert.model_dump(mode="json"),
                    })


@asynccontextmanager
async def lifespan(app: FastAPI):
    watchdog = asyncio.create_task(_watch_for_silence())
    yield
    watchdog.cancel()


app = FastAPI(
    title="FloakMap API",
    version="2.0.0",
    description="US Parking & Services — GeoJSON data API, plus live tracking",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── v1: the original map API (unchanged) ─────────────────────────────────────
app.include_router(facilities.router, prefix="/api/v1", tags=["facilities"])

# ── v2: live tracking ────────────────────────────────────────────────────────
app.include_router(auth.router)
app.include_router(ingest.router)
app.include_router(fleet.router)
app.include_router(trips.router)
app.include_router(floaknet.router)
app.include_router(live.router)


@app.get("/")
def root():
    return {
        "name": "FloakMap API",
        "version": app.version,
        "docs": "/docs",
        "live": True,
        "transport": "redis" if settings.redis_url else "in-process",
    }


@app.get("/health")
def health():
    return {"status": "ok"}
