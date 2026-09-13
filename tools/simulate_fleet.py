#!/usr/bin/env python3
"""Drives fake vehicles and people so the map has something moving.

    python tools/simulate_fleet.py --api http://localhost:8000

Each subject follows a loop of waypoints with a little wander, reports at a
realistic cadence, and occasionally does something worth alerting on: a speed
burst, a long idle with the engine running, a dropout in a tunnel. That last
one matters -- a tracking system that has only ever seen clean data will
surprise you the first time a van goes through a parking garage.
"""
from __future__ import annotations

import argparse
import asyncio
import math
import random
from datetime import datetime, timezone

import httpx

# Loops around Parker, CO for the fleet; I-70 west for the road trip.
ROUTES: dict[str, list[tuple[float, float]]] = {
    "trk_veh_01": [(-104.7614, 39.5186), (-104.7385, 39.5301), (-104.7212, 39.5120), (-104.7590, 39.5040)],
    "trk_veh_02": [(-104.8010, 39.5600), (-104.7700, 39.5750), (-104.7450, 39.5480), (-104.7900, 39.5350)],
    "trk_veh_03": [(-104.7100, 39.4900), (-104.6800, 39.5200), (-104.7000, 39.5500), (-104.7400, 39.5100)],
    "trk_veh_04": [(-104.8300, 39.5200), (-104.8000, 39.5400), (-104.7800, 39.5100), (-104.8200, 39.4950)],
    "trk_veh_05": [(-104.7700, 39.4800), (-104.7300, 39.4900), (-104.7200, 39.5250), (-104.7650, 39.5150)],
    "trk_veh_06": [(-104.7700, 39.5150), (-104.7680, 39.5170)],          # parked trailer
    "trk_usr_maya": [(-105.2000, 39.6000), (-106.0000, 39.6300), (-107.3000, 39.5500), (-109.5490, 38.5730)],
    "trk_usr_dev": [(-105.0000, 39.7000), (-105.9000, 39.6000), (-107.0000, 39.5000), (-109.5490, 38.5730)],
    "trk_usr_sam": [(-104.9000, 39.7392), (-105.5000, 39.6500), (-106.8000, 39.5200), (-109.5490, 38.5730)],
}
SPEEDS = {"trk_usr_": 95.0, "trk_veh_06": 0.0}
DEFAULT_SPEED = 45.0


def bearing(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1 = map(math.radians, a)
    lon2, lat2 = map(math.radians, b)
    dl = lon2 - lon1
    y = math.sin(dl) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def cruise(tracker: str) -> float:
    for prefix, speed in SPEEDS.items():
        if tracker.startswith(prefix) or tracker == prefix:
            return speed
    return DEFAULT_SPEED


class Rig:
    def __init__(self, tracker: str, route: list[tuple[float, float]]):
        self.tracker = tracker
        self.route = route
        self.leg = 0
        self.t = random.random()
        self.speed = cruise(tracker)
        self.battery = random.randint(35, 100)
        self.offline_until = 0.0
        self.idle_until = 0.0

    def step(self, dt: float, tick: float) -> dict | None:
        if tick < self.offline_until:
            return None                      # in a tunnel

        a = self.route[self.leg]
        b = self.route[(self.leg + 1) % len(self.route)]

        idling = tick < self.idle_until
        speed = 0.0 if idling or self.speed == 0 else self.speed * random.uniform(0.85, 1.15)

        if random.random() < 0.004:
            self.offline_until = tick + random.uniform(60, 180)
        if random.random() < 0.003 and not idling:
            self.idle_until = tick + random.uniform(300, 1200)
        if random.random() < 0.01:
            speed = self.speed * random.uniform(2.6, 3.1)   # speed burst

        if speed > 0:
            leg_km = 111.32 * math.hypot(b[0] - a[0], (b[1] - a[1]))
            if leg_km > 0:
                self.t += (speed * dt / 3600) / leg_km
            while self.t >= 1:
                self.t -= 1
                self.leg = (self.leg + 1) % len(self.route)
                a = self.route[self.leg]
                b = self.route[(self.leg + 1) % len(self.route)]

        lon = a[0] + (b[0] - a[0]) * self.t + random.gauss(0, 0.00004)
        lat = a[1] + (b[1] - a[1]) * self.t + random.gauss(0, 0.00004)
        self.battery = max(3, self.battery - (0.01 if random.random() < 0.1 else 0))

        return {
            "tracker_id": self.tracker,
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "recorded_at": datetime.now(timezone.utc).isoformat(),
            "speed_kmh": round(speed, 1),
            "heading_deg": round(bearing(a, b), 1),
            "accuracy_m": round(random.uniform(4, 25), 1),
            "battery_pct": int(self.battery),
            "telemetry": {
                "engine_on": speed > 0 or idling,
                "fuel_pct": random.randint(20, 100),
            },
        }


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://localhost:8000")
    ap.add_argument("--interval", type=float, default=2.0, help="seconds between fixes")
    ap.add_argument("--speed", type=float, default=1.0, help="simulation speed multiplier")
    args = ap.parse_args()

    async with httpx.AsyncClient(timeout=10) as client:
        auth = await client.post(
            f"{args.api}/api/v1/auth/demo-token",
            json={"subject_id": "usr_maya", "role": "dispatcher"},
        )
        auth.raise_for_status()
        headers = {"Authorization": f"Bearer {auth.json()['access_token']}"}
        print(f"Driving {len(ROUTES)} trackers at {args.interval}s intervals. Ctrl-C to stop.")

        rigs = [Rig(t, r) for t, r in ROUTES.items()]
        tick = 0.0
        while True:
            tick += args.interval
            dt = args.interval * args.speed
            batch = [fix for fix in (r.step(dt, tick) for r in rigs) if fix]
            if batch:
                res = await client.post(
                    f"{args.api}/api/v1/ingest/positions",
                    json={"positions": batch},
                    headers=headers,
                )
                body = res.json()
                events = ", ".join(
                    f"{e['subject_id']} {e['kind']} {e['geofence_name']}"
                    for e in body.get("events", [])
                )
                print(
                    f"\r{len(batch)} fixes sent, {body.get('throttled', 0)} throttled"
                    + (f"  |  {events}" if events else "") + "   ",
                    end="", flush=True,
                )
            await asyncio.sleep(args.interval)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nStopped.")
