"""Runtime configuration for the live-tracking layer."""
from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # --- identity -------------------------------------------------------
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 30
    refresh_token_days: int = 30

    # --- storage --------------------------------------------------------
    # Empty redis_url falls back to an in-process bus, so a single container
    # still works for local dev and demos.
    redis_url: str = ""
    database_url: str = ""

    # --- ingest policy --------------------------------------------------
    min_seconds_between_fixes: float = 1.0   # server-side throttle, ~1 Hz
    max_batch_size: int = 200                # positions per ingest call
    position_ttl_seconds: int = 900          # last-known cache lifetime
    stale_after_seconds: int = 180           # marker dims after this

    # --- privacy --------------------------------------------------------
    approximate_precision_m: int = 500       # "approximate" sharing mode
    max_trip_hours: int = 24                 # hard ceiling on a share link

    # --- alert thresholds ------------------------------------------------
    speeding_kmh: float = 120.0
    idle_minutes: int = 15

    # --- cors -------------------------------------------------------------
    # Comma-separated, so it survives a single FLOAK_CORS_ORIGINS env var
    # without needing JSON quoting in docker-compose.
    #
    # allow_credentials=True in main.py means "*" is NOT a usable shortcut —
    # browsers reject a wildcard origin when credentials are on. Every origin
    # the frontend is served from has to be listed here.
    cors_origins: str = (
        "http://localhost:3000,"
        "http://localhost:3001,"
        "http://localhost:3002,"
        "http://127.0.0.1:3000,"
        "http://127.0.0.1:3001,"
        "http://127.0.0.1:3002"
    )

    class Config:
        env_prefix = "FLOAK_"
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()


def cors_origins_list() -> list[str]:
    """Settings.cors_origins split into the list CORSMiddleware wants.

    Deliberately a module-level function rather than a property on Settings:
    a property appended to the end of that class lands inside `class Config`
    by accident, and pydantic then reports it as a missing attribute.
    """
    return [o.strip() for o in get_settings().cors_origins.split(",") if o.strip()]