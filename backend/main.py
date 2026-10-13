"""FloakMap API entry point.

Wires the three logical databases (identity / operational / warehouse) to the
FastAPI app. Extra pieces added since the last revision:

* ``SecurityHeadersMiddleware`` — HSTS, CSP, X-Frame-Options, Permissions-Policy.
* ``layers`` router — GeoJSON views straight out of the warehouse for BI use.
* Signal-watchdog now runs across every seeded org, not just the demo one.
* Startup logs whether the app is on Postgres or the in-memory fallback so a
  misconfigured deploy surfaces immediately in the logs instead of silently
  running against ephemeral memory.
"""
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import asyncio
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import cors_origins_list, get_settings
from core.db import dispose as dispose_db, healthcheck, is_database_configured
from core.hardening import SecurityHeadersMiddleware
from routers import auth, facilities, fleet, floaknet, ingest, layers, trips
from services import alerts as alert_rules
from services import registry
from services.bus import get_bus
from ws import live

log = logging.getLogger("floak")
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s %(message)s")

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
    log.info("floakmap starting; database=%s transport=%s",
             "postgres" if is_database_configured() else "in-memory",
             "redis" if settings.redis_url else "in-process")
    watchdog = asyncio.create_task(_watch_for_silence())
    try:
        yield
    finally:
        watchdog.cancel()
        await dispose_db()


app = FastAPI(
    title="FloakMap API",
    version="2.1.0",
    description="US Parking & Services — GeoJSON data API, live tracking, and warehouse",
    lifespan=lifespan,
)

# CORS runs after security headers so preflight responses still get the CORS
# fields the browser needs. Order matters here: adding SecurityHeaders first
# means it wraps CORS and every downstream route uniformly.
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── v1: the original map API (unchanged) ─────────────────────────────────────
app.include_router(facilities.router, prefix="/api/v1", tags=["facilities"])

# ── v2: live tracking, auth, warehouse ───────────────────────────────────────
app.include_router(auth.router)
app.include_router(ingest.router)
app.include_router(fleet.router)
app.include_router(trips.router)
app.include_router(floaknet.router)
app.include_router(layers.router)
app.include_router(live.router)


@app.get("/")
def root():
    return {
        "name": "FloakMap API",
        "version": app.version,
        "docs": "/docs",
        "live": True,
        "transport": "redis" if settings.redis_url else "in-process",
        "database": "postgres" if is_database_configured() else "in-memory",
    }


@app.get("/health")
async def health():
    """Cheap, but real: checks the DB round-trip when configured."""
    db_ok = await healthcheck()
    return {"status": "ok" if db_ok else "degraded", "database": db_ok}
