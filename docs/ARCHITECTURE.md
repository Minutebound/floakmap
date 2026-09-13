# FloakMap live layer

FloakMap v1 answers "what is near me." This layer answers "where is my crew,
and where are my vans." Same map, same tile stack, one new idea underneath.

## The idea

A person on a road trip and a refrigerated van are the same object. Both emit
a position; both have an audience; both need a way to stop being watched. The
only real difference is the policy wrapped around them:

| | Trip | FloakNet | Fleet |
|---|---|---|---|
| Membership | invite code | code, then host approval | org roster |
| Viewers | friends, guest links | approved members | dispatchers, admins |
| Lifetime | expires on a timer | until archived | until the vehicle is sold |
| Consent | the person shares | the host admits | the employer requires |
| History | discarded when the trip ends | per member | retained for compliance |

One ingest pipeline, one websocket, one animation layer. Two policy objects on
top. Building these as separate products duplicates the hard parts — the
pipeline and the socket — and leaves you with two sets of bugs.

## Data flow

```
 phone SDK / OBD dongle / hardware tracker
         │  POST /api/v1/ingest/positions   (batched, offline-buffered)
         ▼
   ┌───────────────┐
   │ FastAPI pod   │  validate → throttle → privacy filter
   └───────┬───────┘
           ├──────────────► TimescaleDB      (history, replay, reports)
           ├──────────────► geofence engine  (enter/exit/dwell)
           ├──────────────► alert rules      (speed, idle, battery, SOS)
           ▼
   ┌───────────────┐
   │ Redis         │  last-known cache (TTL) + pub/sub per org
   └───────┬───────┘
           ▼
   ┌───────────────┐
   │ FastAPI pod   │  /ws/live: snapshot → deltas
   └───────┬───────┘
           ▼
   browser: rAF interpolation → MapLibre GeoJSON sources
```

Redis sits in the middle so any pod can accept a fix and any pod can serve a
viewer. Nothing is pinned to a machine, which is what makes the API layer
horizontally scalable and rolling deploys boring.

## Decisions worth knowing

**Privacy is applied before storage, not before display.** An "approximate"
subject never has precise coordinates sitting in the live cache. Filtering at
render time means the precise value existed somewhere a bug could reach it.
Raw fixes still go to history, because the account holder is entitled to their
own trail.

**Approximate mode snaps to a grid, not random noise.** Noise jitters frame to
frame and a determined viewer averages it away over a few minutes. A grid cell
is stable and does not leak under repetition.

**Positions are interpolated client-side.** Fixes arrive every one to two
seconds. A marker that snaps between them reads as broken even when the data
is perfect. Interpolation is linear, not eased, because a van does not ease
out of a corner.

**The websocket coalesces on a 250 ms tick.** 500 vehicles at 1 Hz become four
frames a second instead of 500 messages. Viewport filtering drops what is off
screen, so zooming in costs less, not more.

**Freshness is shown continuously, not as a badge.** Each roster row has a bar
that drains as the fix ages. An operator can see a vehicle going quiet before
it has gone quiet, which is the difference between noticing and finding out.

**Absence needs a watcher.** Every alert rule fires on an incoming fix. A
vehicle that goes dark produces no fix, so a background sweep goes looking for
trackers that stopped reporting.

**Geofencing runs in the ingest path, bbox-first.** An integer comparison per
fence rejects almost everything before any ray-casting happens. With PostGIS
this becomes `ST_Contains` against a GiST index behind the same interface.

## FloakNet: asking to join

The consumer side needed a third shape. A trip is something you start with
people you already know; a net is something strangers ask to enter. That makes
admission the hard part, not sharing.

The rule the whole design follows:

> The join code is an address. It is not a credential.

Every location-sharing product that hands out a code-as-password ends up with
the same failure: the code is screenshotted, forwarded, read aloud in a cafe,
pasted into a group chat, and now it is a permanent backdoor that nobody
remembers issuing. Making the code only open a *request* means a leak costs the
host one line in a queue.

The second half is that the host has to be approving a person, not a string.
A display name is typed by the requester, so it is evidence of nothing. The
requester is given a fingerprint derived from a secret only they hold, and
reads it out over a channel the attacker does not control — the same idea as
Signal's safety numbers, minus the cryptography, because here it only has to
survive a human comparison.

Three more things fall out of taking that seriously:

- **404 everywhere, never 403.** A 403 tells you the net exists. Non-members
  get the same response for a real net as for an imaginary one.
- **Uniform errors on `/join`.** A wrong code, a full queue and a full net all
  look identical from outside, so the endpoint cannot be used to sweep for
  live codes.
- **Revocation is checked at use, not at issue.** A JWT cannot be recalled once
  handed out, so membership is re-read on every request and on every websocket
  connect. Removing someone takes effect on their next call rather than
  whenever their token happens to lapse.

Rate limiting is per caller *and* per net. Per caller alone lets a botnet
spread attempts across addresses; per net alone lets one attacker lock a net's
legitimate members out of joining.

## The basemap

The map went from CartoDB raster to a vector style built in
`frontend/src/lib/basemap.ts` from an eleven-colour palette. Raster tiles are
one image per tile — you get whatever colours the provider chose, at whatever
label density they chose, and you cannot re-theme them. Vector tiles carry the
geometry and the styling happens locally, so the palette is yours.

The Felt-ish look is a handful of specific decisions: warm off-white land
rather than grey, sage instead of saturated park green, white road fills over
a warm casing so streets read as ribbons, buildings held back until z13 so
neighbourhoods do not turn to mush, and labels small and warm-grey so the
vehicles are the loudest thing on the map. Dark mode is cooler rather than
inverted, because an inverted warm palette looks muddy.

Tiles come from OpenFreeMap, which is free and keyless but is someone else's
free service. `rasterFallbackStyle` keeps the CartoDB raster ready and MapView
swaps to it on a source error — once, not in a retry loop.

The cost of the change: `setStyle` drops every source and layer the style did
not declare, so facility layers and live layers both have to be re-installable.
Both now reinstall on `styledata` and both are idempotent. Click handlers stay
registered on the map rather than being re-added, or you get duplicate popups.

## Storage split

Positions are append-only, enormous, and read as a time range for one subject.
Everything else is small, mutable, and read by key. They get different
treatment:

- `positions` is a Timescale hypertable partitioned by day, compressed after a
  week, dropped after 400 days, with a continuous aggregate holding daily
  distance and top speed. Utilisation reports read the aggregate, so they do
  not slow down as history grows.
- Everything else is ordinary Postgres with row-level security keyed on
  `app.org_id`. Application code already checks `org_id` everywhere; RLS is the
  second lock, so one bad `WHERE` clause cannot leak another company's fleet.

## Auth

Three callers, three mechanisms:

- **People** get a short JWT carrying `org_id` and `role`. Routes ask for
  capabilities (`fleet:read`, `geofence:write`), never roles, so adding a role
  later does not mean auditing every endpoint.
- **Devices** get an API key scoped to one tracker, stored as an HMAC. A key
  can only report its own tracker, so a leaked key can lie about one vehicle
  rather than move the whole fleet.
- **Guests** get a share token carrying a trip id and an expiry. No account, no
  password reset flow, and it stops working on its own.

## Consent, because this is the part that gets products sued

Location data is the most sensitive thing most apps ever hold. Four things are
built in rather than bolted on:

- Sharing has four states, and a driver can always turn their own down.
  Changing someone else's requires `fleet:write`.
- Trips carry a hard expiry with a 24-hour ceiling. Nobody has to remember to
  stop sharing — that is the failure mode of every location app.
- `location_access_log` records who looked at whose position. Needed for SOC 2,
  and needed the first time an employee asks whether they were watched on a
  Sunday.
- Off-shift tracking is a policy question the schema is ready for: store the
  shift window on the subject and drop fixes outside it at ingest. Some
  jurisdictions require this; all of them make it a good idea.

## What to build next

- [ ] Swap `services/registry.py` for SQLAlchemy against `db/schema.sql`
- [ ] Real routing for ETAs (OSRM or Valhalla) in place of straight-line
- [ ] Route adherence: compare the trail to the planned route, alert on drift
- [ ] Webhooks so geofence events reach a customer's dispatch system
- [ ] Mobile background-location SDK with an offline buffer
- [ ] Douglas-Peucker trail simplification (`ST_Simplify`) so replay keeps corners
- [ ] Clustering at low zoom, so a 5,000-vehicle national view stays readable
- [ ] Per-org rate limits on ingest, keyed by tracker
- [ ] Move FloakNet rate limiting into Redis so it survives more than one pod
- [ ] Push notification to the host when a join request arrives, instead of polling
- [ ] Per-member share schedules on a net (visible during a trip, not after)
