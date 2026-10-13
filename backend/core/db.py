"""Database entry point.

Two things this file exists to guarantee:

1. Every request runs against a session that has `app.current_org` set, so
   Row-Level Security in schema.sql does its job. Repositories never call
   `SELECT ... WHERE org_id = ...` — the database does that filter.

2. The app boots and runs with `FLOAK_DATABASE_URL` empty. The repositories
   then fall through to an in-process seed store, so `docker compose up`
   without Postgres still produces a working demo. Same interface either way,
   so swapping later touches only this module.
"""
from __future__ import annotations

import contextlib
import logging
from typing import AsyncIterator, Optional

from core.config import get_settings

log = logging.getLogger(__name__)

_engine = None
_session_factory = None
_sqlalchemy_available = False

try:  # pragma: no cover — optional dependency
    from sqlalchemy.ext.asyncio import (
        AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine,
    )
    from sqlalchemy import text
    _sqlalchemy_available = True
except ImportError:  # pragma: no cover
    AsyncEngine = AsyncSession = object      # type: ignore[assignment,misc]
    async_sessionmaker = create_async_engine = None  # type: ignore[assignment]
    text = None                              # type: ignore[assignment]


def is_database_configured() -> bool:
    """True when the app should hit Postgres. False sends every repo call
    through the in-memory fallback."""
    return bool(get_settings().database_url) and _sqlalchemy_available


def get_engine():
    global _engine, _session_factory
    if _engine is not None:
        return _engine
    if not is_database_configured():
        return None
    url = get_settings().database_url
    _engine = create_async_engine(
        url,
        pool_pre_ping=True,   # kills stale connections after a Postgres restart
        pool_size=10,
        max_overflow=20,
        # echo is deliberately off; turn on with FLOAK_SQL_ECHO=1 for debugging.
    )
    _session_factory = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine


@contextlib.asynccontextmanager
async def session_for(org_id: Optional[str]) -> AsyncIterator:
    """Yield an AsyncSession pinned to `org_id` for RLS.

    Passing None is meaningful: unauthenticated flows (net join, guest share
    poll) legitimately have no org yet. Those queries must NOT touch tenant
    tables — the RLS policy will hide everything if they try.
    """
    if not is_database_configured():
        yield None
        return

    get_engine()  # ensure factory
    assert _session_factory is not None
    async with _session_factory() as session:
        # SET LOCAL is scoped to the transaction; the next request cannot
        # inherit an org from a previous one on the same pooled connection.
        await session.execute(text("BEGIN"))
        try:
            token = org_id or "__none__"
            # set_config is safer than string concat: values are parameterised.
            await session.execute(
                text("SELECT set_config('app.current_org', :o, true)"),
                {"o": token},
            )
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def healthcheck() -> bool:
    if not is_database_configured():
        return True   # in-memory fallback is always up
    try:
        engine = get_engine()
        async with engine.connect() as conn:  # type: ignore[union-attr]
            await conn.execute(text("SELECT 1"))
        return True
    except Exception as exc:                  # pragma: no cover
        log.warning("db health failed: %s", exc)
        return False


async def dispose() -> None:
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _session_factory = None


# ------------------------------------------------------------------
# FastAPI dependency helper: `Depends(get_db)`.
# ------------------------------------------------------------------
async def get_db() -> AsyncIterator:  # pragma: no cover — thin wrapper
    """Dependency used by routers that talk directly to the warehouse (layers).

    Yields None when the database is not configured so the caller can decide
    whether to return an empty result or fall back to a service call.
    """
    async with session_for(None) as session:
        yield session
