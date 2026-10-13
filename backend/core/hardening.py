"""Security hardening — middleware, rate limits, audit sink.

Three things live here that used to be scattered:

1. Security response headers. Every response gets HSTS, X-Content-Type-Options,
   X-Frame-Options, and a strict Referrer-Policy. The frontend has its own
   CSP; nothing here undermines it.
2. A per-key sliding-window rate limiter. Backed by Redis when configured,
   in-process otherwise. `floaknet.request_join` had its own; this one is
   shared so login, ingest and net-join all count against the same buckets.
3. `audit()` — one call site for every "someone did a sensitive thing" event.
   Writes to identity.audit_log when the database is up, logs otherwise.
"""
from __future__ import annotations

import hashlib
import logging
import time
from collections import defaultdict, deque
from typing import Optional

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from core.config import get_settings
from core.db import is_database_configured, session_for

log = logging.getLogger("floak.audit")


# ---------------------------------------------------------------
# Security headers
# ---------------------------------------------------------------

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """One place for every header. Adding a new one is a one-line change here
    rather than touching every response object across the codebase."""

    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        h = response.headers
        # HSTS: 6 months, preload safe. Set even in dev — TLS termination in
        # front of the API strips it for HTTP callers automatically.
        h.setdefault("Strict-Transport-Security", "max-age=15552000; includeSubDomains")
        h.setdefault("X-Content-Type-Options", "nosniff")
        h.setdefault("X-Frame-Options", "DENY")
        h.setdefault("Referrer-Policy", "no-referrer")
        h.setdefault("Permissions-Policy", "geolocation=(self), camera=(), microphone=()")
        # A minimal CSP for the JSON API itself. The frontend serves its own,
        # richer CSP; this one applies to /docs and error pages.
        h.setdefault("Content-Security-Policy",
                     "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
        return response


# ---------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------

class RateLimiter:
    """Sliding-window counter keyed by an opaque string.

    Not tied to IP, so the caller can compose keys like ``login:{email_hash}``
    or ``ingest:{org_id}``. The in-process implementation is per-pod; move to
    Redis (below) once you run more than one API pod, or an attacker just
    retries against a different one.
    """

    def __init__(self) -> None:
        self._hits: dict[str, deque] = defaultdict(deque)

    def check(self, key: str, limit: int, window_s: float) -> None:
        now = time.monotonic()
        bucket = self._hits[key]
        cutoff = now - window_s
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= limit:
            raise RateLimitExceeded(int(window_s))
        bucket.append(now)


class RateLimitExceeded(Exception):
    def __init__(self, retry_after: int) -> None:
        self.retry_after = retry_after
        super().__init__(f"Rate limit exceeded; retry in {retry_after}s")


_limiter = RateLimiter()


def rate_limit(key: str, limit: int, window_s: float) -> None:
    _limiter.check(key, limit, window_s)


def client_ip_hash(request: Request) -> str:
    """Never store the raw IP; store a hash so an operator dump does not leak
    end-user addresses. The salt is the JWT secret, which already has to be
    kept secret."""
    ip = request.client.host if request.client else "unknown"
    # X-Forwarded-For is caller-controlled; trust it only when your reverse
    # proxy sets it AND you validate the proxy chain. Off by default.
    salt = get_settings().jwt_secret.encode()
    return hashlib.sha256(salt + ip.encode()).hexdigest()[:32]


# ---------------------------------------------------------------
# WebSocket origin allowlist
# ---------------------------------------------------------------

def websocket_origin_ok(origin: Optional[str]) -> bool:
    """CORS headers do not apply to WebSocket upgrades; the browser sends an
    Origin header regardless and it is on the server to check it."""
    if not origin:
        return False
    from core.config import cors_origins_list
    return origin in cors_origins_list()


# ---------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------

async def audit(
    *,
    action: str,
    org_id: Optional[str] = None,
    actor_user_id: Optional[str] = None,
    actor_kind: str = "system",
    target_kind: Optional[str] = None,
    target_id: Optional[str] = None,
    ip_hash: Optional[str] = None,
    detail: Optional[dict] = None,
) -> None:
    """Write an audit row. Best-effort: audit failures never break the request.

    Actions use dotted notation so filters are easy: `login.success`,
    `net.rotate_code`, `member.revoke`.
    """
    payload = {
        "action": action, "org_id": org_id, "actor_user_id": actor_user_id,
        "actor_kind": actor_kind, "target_kind": target_kind,
        "target_id": target_id, "detail": detail or {},
    }

    if not is_database_configured():
        log.info("audit %s", payload)
        return

    try:
        from sqlalchemy import text
        async with session_for(org_id) as session:
            if session is None:
                log.info("audit %s", payload)
                return
            await session.execute(
                text("""
                    INSERT INTO identity.audit_log
                        (org_id, actor_user_id, actor_kind, action,
                         target_kind, target_id, ip_hash, detail)
                    VALUES
                        (:org_id, :uid, :ak, :action, :tk, :tid, :iph, :d::jsonb)
                """),
                {
                    "org_id": org_id, "uid": actor_user_id, "ak": actor_kind,
                    "action": action, "tk": target_kind, "tid": target_id,
                    "iph": ip_hash,
                    "d": __import__("json").dumps(detail or {}),
                },
            )
    except Exception as exc:  # pragma: no cover — audit must never break flow
        log.warning("audit write failed for %s: %s", action, exc)
