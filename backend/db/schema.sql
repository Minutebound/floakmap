-- FloakMap live layer: PostgreSQL 16 + PostGIS 3.4 + TimescaleDB 2.
--
-- Two storage shapes, because positions and everything else have opposite
-- access patterns. Positions are append-only, enormous, and almost always
-- read as a time range for one subject. Everything else is small, mutable,
-- and read by key. Treating them the same is how tracking databases die.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------- tenancy

CREATE TABLE orgs (
    id          TEXT PRIMARY KEY DEFAULT 'org_' || encode(gen_random_bytes(6), 'hex'),
    name        TEXT NOT NULL,
    plan        TEXT NOT NULL DEFAULT 'free',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id            TEXT PRIMARY KEY DEFAULT 'usr_' || encode(gen_random_bytes(6), 'hex'),
    org_id        TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    email         CITEXT NOT NULL,
    display_name  TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN
                    ('owner','admin','dispatcher','driver','member')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, email)
);

-- ------------------------------------------------------------- subjects

CREATE TABLE subjects (
    id           TEXT PRIMARY KEY DEFAULT 'sub_' || encode(gen_random_bytes(6), 'hex'),
    org_id       TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('person','vehicle','asset')),
    label        TEXT NOT NULL,
    user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
    color        TEXT,
    share_mode   TEXT NOT NULL DEFAULT 'precise'
                 CHECK (share_mode IN ('precise','approximate','paused','off')),
    metadata     JSONB NOT NULL DEFAULT '{}',
    archived_at  TIMESTAMPTZ
);
CREATE INDEX ON subjects (org_id) WHERE archived_at IS NULL;

CREATE TABLE trackers (
    id           TEXT PRIMARY KEY DEFAULT 'trk_' || encode(gen_random_bytes(6), 'hex'),
    org_id       TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    subject_id   TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    key_hash     TEXT NOT NULL UNIQUE,     -- never the key itself
    kind         TEXT NOT NULL DEFAULT 'phone',  -- phone | obd | hardware
    last_seen_at TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ
);
CREATE INDEX ON trackers (key_hash) WHERE revoked_at IS NULL;

-- ------------------------------------------------------------- positions

CREATE TABLE positions (
    org_id       TEXT        NOT NULL,
    subject_id   TEXT        NOT NULL,
    recorded_at  TIMESTAMPTZ NOT NULL,
    geom         GEOGRAPHY(POINT, 4326) NOT NULL,
    speed_kmh    REAL,
    heading_deg  REAL,
    accuracy_m   REAL,
    battery_pct  SMALLINT,
    telemetry    JSONB NOT NULL DEFAULT '{}'
);

SELECT create_hypertable('positions', 'recorded_at', chunk_time_interval => INTERVAL '1 day');

-- Trip replay is always "this subject, this window", so lead with subject_id.
CREATE INDEX positions_subject_time ON positions (subject_id, recorded_at DESC);
-- "Everything inside this polygon right now" needs the spatial index.
CREATE INDEX positions_geom ON positions USING GIST (geom);

ALTER TABLE positions SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'subject_id',
    timescaledb.compress_orderby   = 'recorded_at DESC'
);
SELECT add_compression_policy('positions', INTERVAL '7 days');
SELECT add_retention_policy('positions', INTERVAL '400 days');

-- Pre-aggregated daily mileage. Utilisation reports read this instead of
-- scanning raw fixes, which is the difference between a dashboard that loads
-- and one that times out at the end of the quarter.
CREATE MATERIALIZED VIEW subject_daily
WITH (timescaledb.continuous) AS
SELECT
    subject_id,
    org_id,
    time_bucket('1 day', recorded_at)                     AS day,
    count(*)                                              AS fixes,
    max(speed_kmh)                                        AS max_speed_kmh,
    ST_Length(ST_MakeLine(geom::geometry ORDER BY recorded_at)::geography) / 1000
                                                          AS distance_km
FROM positions
GROUP BY subject_id, org_id, day;

SELECT add_continuous_aggregate_policy('subject_daily',
    start_offset => INTERVAL '3 days',
    end_offset   => INTERVAL '1 hour',
    schedule_interval => INTERVAL '30 minutes');

-- ------------------------------------------------------------- geofences

CREATE TABLE geofences (
    id            TEXT PRIMARY KEY DEFAULT 'gf_' || encode(gen_random_bytes(6), 'hex'),
    org_id        TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    geom          GEOGRAPHY(POLYGON, 4326) NOT NULL,
    trigger       TEXT NOT NULL DEFAULT 'both'
                  CHECK (trigger IN ('enter','exit','both','dwell')),
    dwell_minutes INT NOT NULL DEFAULT 10,
    subject_ids   TEXT[] NOT NULL DEFAULT '{}',
    color         TEXT NOT NULL DEFAULT '#7c5cff',
    active        BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX geofences_geom ON geofences USING GIST (geom);
CREATE INDEX ON geofences (org_id) WHERE active;

CREATE TABLE geofence_state (
    subject_id   TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    geofence_id  TEXT NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
    inside       BOOLEAN NOT NULL,
    since        TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (subject_id, geofence_id)
);

-- ---------------------------------------------------------------- alerts

CREATE TABLE alerts (
    id              TEXT PRIMARY KEY DEFAULT 'alr_' || encode(gen_random_bytes(6), 'hex'),
    org_id          TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    subject_id      TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL,
    severity        TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
    message         TEXT NOT NULL,
    geom            GEOGRAPHY(POINT, 4326),
    raised_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_by TEXT REFERENCES users(id),
    acknowledged_at TIMESTAMPTZ
);
CREATE INDEX ON alerts (org_id, raised_at DESC);
CREATE INDEX ON alerts (org_id) WHERE acknowledged_at IS NULL;

-- ----------------------------------------------------------------- trips

CREATE TABLE trips (
    id           TEXT PRIMARY KEY DEFAULT 'trip_' || encode(gen_random_bytes(6), 'hex'),
    org_id       TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    created_by   TEXT NOT NULL REFERENCES users(id),
    invite_code  TEXT NOT NULL UNIQUE,
    destination  GEOGRAPHY(POINT, 4326),
    starts_at    TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ NOT NULL,
    active       BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX ON trips (org_id) WHERE active;

CREATE TABLE trip_members (
    trip_id    TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (trip_id, subject_id)
);

-- -------------------------------------------------------------- floaknets

CREATE TABLE floaknets (
    id               TEXT PRIMARY KEY DEFAULT 'net_' || encode(gen_random_bytes(5), 'hex'),
    org_id           TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    host_subject_id  TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    -- HMAC only. There is no query that returns a working join code, which is
    -- the point: a code you can look up is a code an attacker can look up.
    code_hash        TEXT NOT NULL,
    code_rotated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    require_approval BOOLEAN NOT NULL DEFAULT TRUE,
    max_members      INT NOT NULL DEFAULT 50,
    default_role     TEXT NOT NULL DEFAULT 'member'
                     CHECK (default_role IN ('host','member','viewer')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at      TIMESTAMPTZ
);
-- Partial unique: rotated-away hashes may repeat historically, live ones cannot.
CREATE UNIQUE INDEX floaknets_code ON floaknets (code_hash) WHERE archived_at IS NULL;

CREATE TABLE net_members (
    net_id       TEXT NOT NULL REFERENCES floaknets(id) ON DELETE CASCADE,
    subject_id   TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    role         TEXT NOT NULL CHECK (role IN ('host','member','viewer')),
    joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_by  TEXT,
    revoked_at   TIMESTAMPTZ,
    PRIMARY KEY (net_id, subject_id)
);
CREATE INDEX ON net_members (subject_id) WHERE revoked_at IS NULL;

CREATE TABLE net_join_requests (
    id           TEXT PRIMARY KEY DEFAULT 'req_' || encode(gen_random_bytes(5), 'hex'),
    net_id       TEXT NOT NULL REFERENCES floaknets(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    fingerprint  TEXT NOT NULL,
    claim_hash   TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','denied','expired','withdrawn')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    subject_id   TEXT REFERENCES subjects(id) ON DELETE SET NULL,
    decided_by   TEXT,
    decided_at   TIMESTAMPTZ,
    note         TEXT
);
CREATE INDEX ON net_join_requests (net_id, status, requested_at);

-- Rate limiting. In Redis at runtime; this table is for the durable record of
-- who hammered which code, which is what you want when a net gets targeted.
CREATE TABLE net_join_attempts (
    id          BIGSERIAL PRIMARY KEY,
    code_hash   TEXT,
    client_key  TEXT NOT NULL,
    succeeded   BOOLEAN NOT NULL,
    at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON net_join_attempts (client_key, at DESC);

-- ------------------------------------------------------------ audit trail

-- Who looked at whose location, and when. Required for SOC 2, and the thing
-- an employee will ask for the first time they suspect they are being
-- watched outside working hours.
CREATE TABLE location_access_log (
    id         BIGSERIAL PRIMARY KEY,
    org_id     TEXT NOT NULL,
    actor_id   TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    action     TEXT NOT NULL,   -- live_view | history_read | export | share_link
    at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    context    JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX ON location_access_log (org_id, at DESC);
CREATE INDEX ON location_access_log (subject_id, at DESC);

-- --------------------------------------------------------- tenant isolation

-- Belt and braces alongside the application-level org_id checks. One bad
-- WHERE clause in a router should not leak another company's fleet.
ALTER TABLE subjects  ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE geofences ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips     ENABLE ROW LEVEL SECURITY;
ALTER TABLE floaknets ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON subjects
    USING (org_id = current_setting('app.org_id', TRUE));
CREATE POLICY org_isolation ON positions
    USING (org_id = current_setting('app.org_id', TRUE));
CREATE POLICY org_isolation ON geofences
    USING (org_id = current_setting('app.org_id', TRUE));
CREATE POLICY org_isolation ON alerts
    USING (org_id = current_setting('app.org_id', TRUE));
CREATE POLICY org_isolation ON trips
    USING (org_id = current_setting('app.org_id', TRUE));
CREATE POLICY org_isolation ON floaknets
    USING (org_id = current_setting('app.org_id', TRUE));
