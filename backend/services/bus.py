"""Fan-out bus and last-known-position cache.

Redis when it is configured, an in-process implementation when it is not.
Same interface either way, so `docker compose up` with no Redis still gives a
working demo and production gets horizontal scaling for free: any API pod can
accept a fix, any API pod can serve a viewer, Redis is the meeting point.
"""
from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import AsyncIterator, Optional

from core.config import get_settings


def _pos_key(org_id: str, subject_id: str) -> str:
    return f"live:{org_id}:{subject_id}"


def _channel(org_id: str) -> str:
    return f"ch:{org_id}"


class Bus:
    async def publish(self, org_id: str, payload: dict) -> None: ...
    async def subscribe(self, org_id: str) -> AsyncIterator[dict]: ...
    async def set_last(self, org_id: str, subject_id: str, state: dict) -> None: ...
    async def get_last(self, org_id: str, subject_id: str) -> Optional[dict]: ...
    async def snapshot(self, org_id: str) -> list[dict]: ...


class MemoryBus(Bus):
    def __init__(self) -> None:
        self._queues: dict[str, list[asyncio.Queue]] = defaultdict(list)
        self._last: dict[str, dict] = {}

    async def publish(self, org_id: str, payload: dict) -> None:
        for q in list(self._queues[_channel(org_id)]):
            if q.qsize() < 1000:        # drop for a viewer that stopped reading
                q.put_nowait(payload)

    async def subscribe(self, org_id: str) -> AsyncIterator[dict]:
        q: asyncio.Queue = asyncio.Queue()
        self._queues[_channel(org_id)].append(q)
        try:
            while True:
                yield await q.get()
        finally:
            self._queues[_channel(org_id)].remove(q)

    async def set_last(self, org_id: str, subject_id: str, state: dict) -> None:
        self._last[_pos_key(org_id, subject_id)] = state

    async def get_last(self, org_id: str, subject_id: str) -> Optional[dict]:
        return self._last.get(_pos_key(org_id, subject_id))

    async def snapshot(self, org_id: str) -> list[dict]:
        prefix = f"live:{org_id}:"
        return [v for k, v in self._last.items() if k.startswith(prefix)]


class RedisBus(Bus):
    def __init__(self, url: str) -> None:
        import redis.asyncio as redis
        self._r = redis.from_url(url, decode_responses=True)
        self._ttl = get_settings().position_ttl_seconds

    async def publish(self, org_id: str, payload: dict) -> None:
        await self._r.publish(_channel(org_id), json.dumps(payload, default=str))

    async def subscribe(self, org_id: str) -> AsyncIterator[dict]:
        pubsub = self._r.pubsub()
        await pubsub.subscribe(_channel(org_id))
        try:
            async for msg in pubsub.listen():
                if msg["type"] == "message":
                    yield json.loads(msg["data"])
        finally:
            await pubsub.unsubscribe(_channel(org_id))
            await pubsub.close()

    async def set_last(self, org_id: str, subject_id: str, state: dict) -> None:
        await self._r.set(
            _pos_key(org_id, subject_id),
            json.dumps(state, default=str),
            ex=self._ttl,
        )

    async def get_last(self, org_id: str, subject_id: str) -> Optional[dict]:
        raw = await self._r.get(_pos_key(org_id, subject_id))
        return json.loads(raw) if raw else None

    async def snapshot(self, org_id: str) -> list[dict]:
        out, cursor = [], 0
        while True:
            cursor, keys = await self._r.scan(cursor, match=f"live:{org_id}:*", count=500)
            if keys:
                out.extend(json.loads(v) for v in await self._r.mget(keys) if v)
            if cursor == 0:
                return out


_bus: Optional[Bus] = None


def get_bus() -> Bus:
    global _bus
    if _bus is None:
        url = get_settings().redis_url
        _bus = RedisBus(url) if url else MemoryBus()
    return _bus
