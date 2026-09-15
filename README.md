# FloakMap

Interactive US parking and services map, plus live tracking: friends watching
each other on a road trip, and businesses watching their fleet.

Everything from v1 still works. The facilities API, the four data layers, the
city search, the theme toggle and the popups are untouched — the tracking layer
sits on top of the same map.

## Run it

```bash
# Everything: API on :8000, web on :3000
docker compose up --build

# Plus nine fake vehicles and people, so the map has something moving on it
docker compose --profile demo up --build
```

Each half also runs on its own:

```bash
cd backend  && docker compose up --build     # API + Redis        → :8000
cd frontend && docker compose up --build     # web                → :3000
```

No database needed. The backend ships with a seeded demo org and an in-memory
registry, so a first run works with nothing but Docker. PostGIS and TimescaleDB
are behind a profile for when you want them:

```bash
docker compose --profile db up --build
```

Without Docker:

```bash
cd backend  && pip install -r requirements.txt && uvicorn main:app --reload
cd frontend && npm install && npm run dev
python tools/simulate_fleet.py               # in a third shell
```

## What's new

```
floakmap/
├── docker-compose.yml            ← all services, + demo and db profiles
├── tools/
│   └── simulate_fleet.py         ← NEW  fake vehicles and people
├── docs/
│   └── ARCHITECTURE.md           ← NEW  why the pieces are shaped this way
├── backend/
│   ├── docker-compose.yml        ← NEW  backend + Redis, standalone
│   ├── .env.example              ← NEW  every FLOAK_ setting
│   ├── main.py                   ← UPDATED  live routers alongside facilities
│   ├── requirements.txt          ← UPDATED  PyJWT, redis, pydantic-settings
│   ├── core/
│   │   ├── config.py             ← NEW  settings
│   │   └── security.py           ← NEW  JWT, device keys, share tokens, roles
│   ├── models/
│   │   ├── facility.py           ← unchanged
│   │   ├── live.py               ← NEW  positions, subjects, geofences, alerts
│   │   └── floaknet.py           ← NEW  nets, memberships, join requests
│   ├── services/
│   │   ├── bus.py                ← NEW  Redis pub/sub, in-process fallback
│   │   ├── tracking.py           ← NEW  the ingest pipeline
│   │   ├── geofence.py           ← NEW  enter/exit/dwell evaluation
│   │   ├── alerts.py             ← NEW  speeding, idling, battery, SOS
│   │   ├── history.py            ← NEW  trails, distance, utilisation
│   │   ├── registry.py           ← NEW  subjects, trackers, trips, zones
│   │   └── floaknet.py           ← NEW  codes, fingerprints, approval, limits
│   ├── routers/
│   │   ├── facilities.py         ← unchanged
│   │   ├── floaknet.py           ← NEW  join requests, approval, revocation
│   │   ├── auth.py               ← NEW  demo tokens (replace before launch)
│   │   ├── ingest.py             ← NEW  position ingest
│   │   ├── fleet.py              ← NEW  roster, alerts, trails, geofences
│   │   └── trips.py              ← NEW  invite codes, share links, ETAs
│   ├── ws/live.py                ← NEW  the live websocket
│   └── db/schema.sql             ← NEW  PostGIS + TimescaleDB + RLS
└── frontend/
    ├── docker-compose.yml        ← NEW  frontend alone
    └── src/
        ├── app/page.tsx          ← UPDATED  live hook, layer and panel wired in
        ├── components/
        │   ├── MapView.tsx       ← UPDATED  vector basemap, onReady, style-swap safe
        │   ├── Sidebar.tsx       ← unchanged
        │   ├── LiveLayer.tsx     ← NEW  animated subjects, trails, zones
        │   ├── NetworkPanel.tsx      ← NEW  host: code, queue, roster
        │   ├── JoinNet.tsx       ← NEW  joiner: code entry, fingerprint, wait
        │   ├── LivePanel.tsx     ← NEW  roster and alert feed
        │   ├── GeofenceEditor.tsx ← NEW  draw a zone on the map
        │   └── ShareTripButton.tsx ← NEW  expiring read-only link
        ├── hooks/useLiveTracking.ts ← NEW  one hook owns all live state
        └── lib/
            ├── live-types.ts     ← NEW  mirrors backend/models/live.py
            ├── live-client.ts    ← NEW  reconnecting websocket client
            ├── basemap.ts        ← NEW  Felt-like vector style + raster fallback
            ├── floaknet-types.ts ← NEW  mirrors backend/models/floaknet.py
            └── floaknet-api.ts   ← NEW  host and join clients, kept separate
```

`GeofenceEditor` and `ShareTripButton` are built but not mounted anywhere yet —
drop them into `page.tsx` when you want zone drawing and trip sharing in the UI.

## FloakNet

A private group that shares location. Someone hosts it, everyone else asks to
join, and the host approves each request by hand.

```
Host creates a net           →  join code, shown once:  AKZZ1-ZG2FD
Someone enters the code      →  request queued, they get a fingerprint: JMR-NSH-V7V
They read the fingerprint out →  host compares it in the queue
Host approves                →  the joiner's next poll returns an access token
```

The design rests on one line: **the join code is an address, not a password.**
Knowing it lets you appear in the host's queue and nothing else. That is why a
code can safely be texted, read aloud or put on a whiteboard — a leaked code
buys an attacker a row in a list where a human is looking.

What actually proves identity is the fingerprint. Anyone can type "Sam" into
the name box, so the host approves a three-group code the requester reads out
over a channel the attacker does not control. It is derived from a secret only
the requester holds, so it cannot be guessed or replayed.

The rest of the controls:

| Concern | How it is handled |
|---|---|
| Leaked code | Rotate it. Members keep access; their access came from a membership, not the code |
| Enumerating codes | Uniform 404s, rate limited to 8 attempts per 5 min per caller *and* per net |
| Enumerating requests | Claim secrets compared in constant time; wrong secret and unknown id give the same 404 |
| Stored secrets | Codes and claim secrets are kept as HMACs. No endpoint can show a code again |
| Removing someone | Membership is re-checked on every request, so revoking is immediate rather than waiting for a token to expire |
| Probing for nets | Non-members get 404 on every net endpoint, never 403 — a 403 confirms the net exists |
| Abandoned requests | Expire after 15 minutes |

```
POST   /api/v1/nets                                create, returns the code once
GET    /api/v1/nets                                nets you are on
GET    /api/v1/nets/{id}/members
GET    /api/v1/nets/{id}/live                      members only
GET    /api/v1/nets/{id}/requests                  host: the pending queue
POST   /api/v1/nets/{id}/requests/{rid}/approve
POST   /api/v1/nets/{id}/requests/{rid}/deny
POST   /api/v1/nets/{id}/rotate-code
POST   /api/v1/nets/{id}/members/{sid}/revoke
POST   /api/v1/nets/{id}/archive

# no account needed for these two — this is the whole unauthenticated surface
POST   /api/v1/nets/join                           {code, display_name}
GET    /api/v1/nets/requests/{rid}?claim=…         poll for the decision
DELETE /api/v1/nets/requests/{rid}?claim=…         withdraw
```

Joining swaps your session token for one scoped to that net, so the websocket
re-authorises and the map narrows to your group. No client-side filtering, so
there is nothing to get wrong.

In the UI: the **Nets** tab on the right is the host view, and **Join** opens
the code entry.

## The basemap

`frontend/src/lib/basemap.ts` builds a Felt-like vector style from an
eleven-colour palette — warm off-white land, sage parks, white road ribbons
over a warm casing, and labels quiet enough that your own data is the loudest
thing on screen. Edit `PALETTE` to change the whole map.

Tiles come from [OpenFreeMap](https://openfreemap.org): OpenMapTiles schema,
no API key, no signup. It is a free public service, so `rasterFallbackStyle`
keeps the original CartoDB raster ready and `MapView` switches to it
automatically if the vector tiles fail to load. A map that looks slightly
different beats a map that goes blank.

To go back to raster permanently, change one line in `MapView.tsx`:

```tsx
style: rasterFallbackStyle(theme),
```

## New endpoints

```
POST   /api/v1/ingest/positions              batch of fixes; device key or JWT
WS     /ws/live?token=…                      snapshot, then deltas

GET    /api/v1/fleet/live                    snapshot for first paint
GET    /api/v1/fleet/subjects                roster
POST   /api/v1/fleet/subjects                add a vehicle, returns device key once
PATCH  /api/v1/fleet/subjects/{id}/sharing   precise | approximate | paused | off
GET    /api/v1/fleet/subjects/{id}/trail     GeoJSON LineString for replay
GET    /api/v1/fleet/subjects/{id}/summary   distance, moving time, top speed
GET    /api/v1/fleet/alerts
POST   /api/v1/fleet/alerts/{id}/acknowledge
GET    /api/v1/fleet/geofences
POST   /api/v1/fleet/geofences
DELETE /api/v1/fleet/geofences/{id}

GET    /api/v1/trips                         trips you are on
POST   /api/v1/trips                         start one, get an invite code
POST   /api/v1/trips/join?code=MOAB24
POST   /api/v1/trips/{id}/share-link         read-only guest link, 1–24 h
GET    /api/v1/trips/{id}/live
GET    /api/v1/trips/{id}/etas
POST   /api/v1/trips/{id}/end
```

The v1 facilities endpoints are unchanged: `/api/v1/facilities`,
`/api/v1/facilities/categories`, `/api/v1/cities`.

## Sending a position from a device

```bash
curl -X POST http://localhost:8000/api/v1/ingest/positions \
  -H 'X-Device-Key: demo-key-veh_01' \
  -H 'Content-Type: application/json' \
  -d '{"positions":[{
        "tracker_id":"trk_veh_01",
        "lat":39.5186,"lon":-104.7614,
        "recorded_at":"2026-09-12T18:40:00Z",
        "speed_kmh":48,"heading_deg":95,"battery_pct":82,
        "telemetry":{"engine_on":true,"fuel_pct":64}}]}'
```

Send one fix or a hundred. Devices should buffer while offline and flush the
backlog on reconnect; the pipeline sorts by timestamp and throttles anything
faster than 1 Hz.

## Configuration

Backend settings all take a `FLOAK_` prefix — see `backend/.env.example`.

| Variable | Default | What it does |
|---|---|---|
| `FLOAK_JWT_SECRET` | dev value | **Change this before deploying** |
| `FLOAK_REDIS_URL` | empty | Empty means in-process, single pod |
| `FLOAK_DATABASE_URL` | empty | Empty means the in-memory registry |
| `FLOAK_MIN_SECONDS_BETWEEN_FIXES` | 1.0 | Ingest throttle per tracker |
| `FLOAK_STALE_AFTER_SECONDS` | 180 | When a marker dims |
| `FLOAK_APPROXIMATE_PRECISION_M` | 500 | Grid size for approximate sharing |
| `FLOAK_MAX_TRIP_HOURS` | 24 | Ceiling on any share link |
| `FLOAK_SPEEDING_KMH` | 120 | Speed alert threshold |
| `FLOAK_IDLE_MINUTES` | 15 | Idle alert threshold |

The frontend needs one: `NEXT_PUBLIC_API_URL`. It drives both the REST calls in
`lib/api.ts` and the websocket in `hooks/useLiveTracking.ts`, which swaps
`http` for `ws`. It is baked in at build time, so point it at wherever the
browser can reach the API — not at a Docker-internal hostname.

## Before this goes to real customers

1. Replace `routers/auth.py` with your identity provider and delete
   `/demo-token`. On the frontend, swap `useDemoToken()` in `page.tsx`.
2. Set `FLOAK_JWT_SECRET` from a secret store, not a file in git.
3. Swap `services/registry.py` for SQLAlchemy against `backend/db/schema.sql`.
4. Put ingest behind a rate limit keyed by tracker.
5. Turn on `location_access_log` writes in the read paths.
6. Narrow CORS in `main.py` from localhost to your real origins.
7. Move FloakNet rate limiting from the in-memory dict in
   `services/floaknet.py` to Redis. With more than one pod an attacker just
   retries against a different one.
8. In `routers/floaknet.py`, `_client_key` reads `request.client.host`. Behind
   a proxy that is the proxy — read a trusted forwarded header instead, and
   only one you set yourself. `X-Forwarded-For` is caller-controlled, so
   trusting it as-is lets anyone reset their own rate limit.

`docs/ARCHITECTURE.md` covers the design: why trips and fleets share one
pipeline, why positions are interpolated client-side, why privacy is applied
before storage rather than before display, and what the scaling path looks like.
