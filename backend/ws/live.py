"""The live websocket.

Connect -> authenticate -> snapshot -> deltas forever.

Three things keep this from melting under a large account:

* Viewport filtering. The client sends its map bounds; the server drops
  subjects outside them. A dispatcher zoomed into one city does not pay for
  the other forty.
* Coalescing. Updates are batched on a 250 ms tick rather than forwarded one
  by one, so 500 vehicles at 1 Hz become 4 frames a second, not 500.
* Backpressure. If a client stops draining, its queue fills and the oldest
  frames are dropped. A slow phone degrades to lower-frequency updates
  instead of stalling the server.
"""
from __future__ import annotations

import asyncio
import contextlib
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from core.security import Role, decode_token
from models.live import ClientFrame, ServerFrame
from services import floaknet, registry, tracking
from services.bus import get_bus

router = APIRouter()

TICK_SECONDS = 0.25
MAX_QUEUE = 500


class Session:
    def __init__(self, ws: WebSocket, org_id: str, allowed: Optional[set[str]]):
        self.ws = ws
        self.org_id = org_id
        self.allowed = allowed          # None = every subject in the org
        self.bbox: Optional[list[float]] = None
        self.follow: Optional[str] = None
        self.seq = 0
        self.pending: dict[str, dict] = {}      # subject_id -> newest state
        self.other: list[dict] = []             # alerts, geofence events

    def visible(self, state: dict) -> bool:
        if self.allowed is not None and state["subject_id"] not in self.allowed:
            return False
        if self.follow and state["subject_id"] == self.follow:
            return True             # never drop the subject being followed
        if self.bbox:
            w, s, e, n = self.bbox
            if not (w <= state["lon"] <= e and s <= state["lat"] <= n):
                return False
        return True

    async def send(self, frame: ServerFrame) -> None:
        self.seq += 1
        frame.seq = self.seq
        await self.ws.send_text(frame.model_dump_json())


async def _authorise(token: str) -> tuple[str, Optional[set[str]], str]:
    """Returns (org_id, allowed_subject_ids, role). Guests on a share link see
    only that trip's members, which is the whole point of a share link."""
    claims = decode_token(token)
    org_id = claims["org"]
    role = claims["role"]

    if role == Role.guest.value:
        trip = await registry.get_trip(claims.get("trip", ""))
        if not trip or not trip.active or trip.expires_at <= datetime.now(timezone.utc):
            raise ValueError("This trip link is no longer active")
        return org_id, set(trip.member_subject_ids), role

    net_id = claims.get("net")
    if net_id:
        # Membership is re-checked here rather than trusted from the token, so
        # a revoked member cannot keep a socket open on an old one.
        if not await floaknet.membership(net_id, claims["sub"]):
            raise ValueError("You are no longer on this net")
        return org_id, set(await floaknet.member_subject_ids(net_id)), role

    if role == Role.driver.value:
        return org_id, {claims["sub"]}, role

    return org_id, None, role


@router.websocket("/ws/live")
async def live_feed(ws: WebSocket, token: str = Query(...)):
    await ws.accept()

    try:
        org_id, allowed, _role = await _authorise(token)
    except Exception as exc:
        await ws.send_text(ServerFrame(type="error", data={"message": str(exc)}).model_dump_json())
        await ws.close(code=4401)
        return

    session = Session(ws, org_id, allowed)

    initial = await tracking.snapshot(org_id, list(allowed) if allowed else None)
    fences = await registry.list_geofences(org_id)
    await session.send(ServerFrame(type="snapshot", data={
        "subjects": [s.model_dump(mode="json") for s in initial],
        "geofences": [f.model_dump(mode="json") for f in fences],
        "alerts": [a.model_dump(mode="json") for a in await tracking.recent_alerts(org_id, 20)],
    }))

    inbox: asyncio.Queue = asyncio.Queue(maxsize=MAX_QUEUE)

    async def pump_bus() -> None:
        async for message in get_bus().subscribe(org_id):
            if inbox.full():
                with contextlib.suppress(asyncio.QueueEmpty):
                    inbox.get_nowait()      # drop oldest, keep the feed current
            await inbox.put(message)

    async def read_client() -> None:
        while True:
            raw = await ws.receive_text()
            try:
                frame = ClientFrame.model_validate_json(raw)
            except Exception:
                continue
            if frame.type == "viewport" and frame.bbox and len(frame.bbox) == 4:
                session.bbox = frame.bbox
            elif frame.type == "follow":
                session.follow = frame.follow_subject_id
            elif frame.type == "subscribe" and frame.subject_ids is not None:
                extra = set(frame.subject_ids)
                session.allowed = extra if session.allowed is None else session.allowed & extra
            elif frame.type == "ping":
                await session.send(ServerFrame(type="pong"))

    async def flush() -> None:
        while True:
            await asyncio.sleep(TICK_SECONDS)
            while not inbox.empty():
                msg = inbox.get_nowait()
                if msg["type"] == "positions":
                    for state in msg["data"]:
                        if session.visible(state):
                            session.pending[state["subject_id"]] = state
                else:
                    session.other.append(msg)

            if session.pending:
                await session.send(ServerFrame(type="positions", data=list(session.pending.values())))
                session.pending.clear()
            for msg in session.other:
                await session.send(ServerFrame(type=msg["type"], data=msg["data"]))
            session.other.clear()

    tasks = [asyncio.create_task(t()) for t in (pump_bus, read_client, flush)]
    try:
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_EXCEPTION)
        for task in done:
            exc = task.exception()
            if exc and not isinstance(exc, WebSocketDisconnect):
                raise exc
    except WebSocketDisconnect:
        pass
    finally:
        for task in tasks:
            task.cancel()
        with contextlib.suppress(Exception):
            await ws.close()
