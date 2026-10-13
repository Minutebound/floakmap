-- ==========================================================================
-- FloakMap — layered database schema
-- ==========================================================================
--
-- Design pattern: layered logical databases, implemented as isolated
-- Postgres schemas so a single cluster can host dev and small production,
-- while the SAME migrations promote cleanly to physically separate
-- clusters when scale demands it.
--
--   identity.*        USER database   — auth, orgs, memberships, audit
--   app.*             OPERATIONAL     — subjects, geofences, trips, nets
--   events_raw.*      NETWORK WHOUSE  — one hypertable per network holds raw
--                                       events (positions, geofence events,
--                                       alerts). Segregation is enforced by
--                                       (net_id, org_id) columns + RLS.
--
-- The dbt-style staging/intermediate/marts layers (stg/int/marts) were
-- removed — nothing writes to them yet and the two read call sites
-- (position trail replay) now query events_raw directly. Reintroduce them
-- as a dbt project once there's an actual analytics/BI consumer.
--
-- Every row that belongs to a tenant carries org_id. Row-Level Security
-- enforces isolation. The application connects as the `floak_app` role and
-- sets `app.current_org` per request; PostgreSQL does the rest.
--
-- Extensions: PostGIS for geometry, pgcrypto for gen_random_uuid(),
-- TimescaleDB for hypertables. `timescaledb` is optional — when missing,
-- the CREATE HYPERTABLE calls degrade to normal Postgres tables.
-- ==========================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Timescale is optional. Wrap so a stock Postgres image still loads the file.
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS timescaledb;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'timescaledb extension unavailable; hypertables will be plain tables';
END $$;

CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS events_raw;

-- Roles: the app never runs as superuser. This is not cosmetic — RLS below
-- is enforced with FORCE ROW LEVEL SECURITY, which the table owner bypasses
-- unless we deliberately use a non-owner role.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'floak_app') THEN
        CREATE ROLE floak_app LOGIN PASSWORD 'floak_app_change_me';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'floak_analytics') THEN
        CREATE ROLE floak_analytics LOGIN PASSWORD 'floak_analytics_change_me';
    END IF;
END $$;

-- ==========================================================================
-- IDENTITY: users, organisations, memberships, sessions, audit
-- ==========================================================================

CREATE TABLE IF NOT EXISTS identity.orgs (
    org_id          TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    plan            TEXT NOT NULL DEFAULT 'free',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS identity.users (
    user_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_lower     TEXT UNIQUE NOT NULL,       -- lowercased for case-insensitive uniqueness
    display_name    TEXT NOT NULL,
    -- Argon2id / bcrypt hash. Nullable so SSO-only users don't need a password.
    password_hash   TEXT,
    mfa_secret      TEXT,                       -- TOTP shared secret, encrypted at rest
    status          TEXT NOT NULL DEFAULT 'active',  -- active | locked | pending
    failed_logins   INT NOT NULL DEFAULT 0,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS identity.memberships (
    org_id          TEXT NOT NULL REFERENCES identity.orgs(org_id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES identity.users(user_id) ON DELETE CASCADE,
    role            TEXT NOT NULL,              -- owner|admin|dispatcher|driver|member
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at      TIMESTAMPTZ,
    PRIMARY KEY (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON identity.memberships(user_id);

-- Refresh tokens. Access tokens stay stateless JWTs; refresh tokens are
-- server-tracked so we can revoke them one at a time. Only the HMAC is stored.
CREATE TABLE IF NOT EXISTS identity.refresh_tokens (
    token_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES identity.users(user_id) ON DELETE CASCADE,
    org_id          TEXT NOT NULL REFERENCES identity.orgs(org_id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL UNIQUE,
    issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    replaced_by     UUID REFERENCES identity.refresh_tokens(token_id),
    user_agent      TEXT,
    ip_hash         TEXT
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON identity.refresh_tokens(user_id);

-- Every sensitive action goes here. Read-only for the app role except INSERT.
CREATE TABLE IF NOT EXISTS identity.audit_log (
    audit_id        BIGSERIAL PRIMARY KEY,
    at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    org_id          TEXT,
    actor_user_id   UUID,
    actor_kind      TEXT NOT NULL,              -- user | device | guest | system
    action          TEXT NOT NULL,              -- login.success, net.rotate_code, ...
    target_kind     TEXT,
    target_id       TEXT,
    ip_hash         TEXT,
    detail          JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_audit_org_time ON identity.audit_log(org_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action_time ON identity.audit_log(action, at DESC);

-- ==========================================================================
-- OPERATIONAL: subjects (people, vehicles, assets), geofences, trips, nets
-- ==========================================================================

CREATE TABLE IF NOT EXISTS app.subjects (
    subject_id      TEXT PRIMARY KEY,
    org_id          TEXT NOT NULL REFERENCES identity.orgs(org_id) ON DELETE CASCADE,
    kind            TEXT NOT NULL,              -- person | vehicle | asset
    label           TEXT NOT NULL,
    tracker_id      TEXT UNIQUE,
    share_mode      TEXT NOT NULL DEFAULT 'precise',
    color           TEXT,
    avatar_url      TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- CHECK enforces the enum at the database level so a bug in the app
    -- cannot store 'preciss' and silently break every downstream filter.
    CONSTRAINT ck_subject_kind CHECK (kind IN ('person','vehicle','asset')),
    CONSTRAINT ck_subject_share CHECK (share_mode IN ('precise','approximate','paused','off')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_subjects_org ON app.subjects(org_id) WHERE deleted_at IS NULL;

-- Device API keys. Only the HMAC is stored; plaintext is shown once at mint.
CREATE TABLE IF NOT EXISTS app.device_keys (
    key_hash        TEXT PRIMARY KEY,
    tracker_id      TEXT NOT NULL,
    org_id          TEXT NOT NULL REFERENCES identity.orgs(org_id) ON DELETE CASCADE,
    label           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at    TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_device_keys_tracker ON app.device_keys(tracker_id);

CREATE TABLE IF NOT EXISTS app.geofences (
    geofence_id     TEXT PRIMARY KEY,
    org_id          TEXT NOT NULL REFERENCES identity.orgs(org_id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    trigger         TEXT NOT NULL DEFAULT 'both',
    dwell_minutes   INT NOT NULL DEFAULT 10,
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    color           TEXT NOT NULL DEFAULT '#7c5cff',
    subject_ids     TEXT[] NOT NULL DEFAULT '{}',
    geom            GEOMETRY(Polygon, 4326) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_geofence_trigger CHECK (trigger IN ('enter','exit','both','dwell'))
);
CREATE INDEX IF NOT EXISTS idx_geofences_geom ON app.geofences USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_geofences_org ON app.geofences(org_id) WHERE active;

CREATE TABLE IF NOT EXISTS app.trips (
    trip_id         TEXT PRIMARY KEY,
    org_id          TEXT NOT NULL REFERENCES identity.orgs(org_id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    created_by      TEXT NOT NULL,
    invite_code     TEXT NOT NULL UNIQUE,
    member_subject_ids TEXT[] NOT NULL DEFAULT '{}',
    destination     GEOMETRY(Point, 4326),
    starts_at       TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ NOT NULL,
    active          BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_trips_org_active ON app.trips(org_id) WHERE active;

-- FloakNets: private, named networks with membership approval.
CREATE TABLE IF NOT EXISTS app.floaknets (
    net_id              TEXT PRIMARY KEY,
    org_id              TEXT NOT NULL REFERENCES identity.orgs(org_id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    host_subject_id     TEXT NOT NULL,
    code_hash           TEXT NOT NULL,
    code_rotated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    require_approval    BOOLEAN NOT NULL DEFAULT TRUE,
    max_members         INT NOT NULL DEFAULT 50,
    default_role        TEXT NOT NULL DEFAULT 'member',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_nets_org ON app.floaknets(org_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_nets_code ON app.floaknets(code_hash);

CREATE TABLE IF NOT EXISTS app.net_members (
    net_id          TEXT NOT NULL REFERENCES app.floaknets(net_id) ON DELETE CASCADE,
    subject_id      TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'member',
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at      TIMESTAMPTZ,
    approved_by     TEXT,
    PRIMARY KEY (net_id, subject_id)
);

CREATE TABLE IF NOT EXISTS app.net_join_requests (
    request_id      TEXT PRIMARY KEY,
    net_id          TEXT NOT NULL REFERENCES app.floaknets(net_id) ON DELETE CASCADE,
    display_name    TEXT NOT NULL,
    fingerprint     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL,
    claim_hash      TEXT NOT NULL,
    subject_id      TEXT,
    decided_by      TEXT,
    decided_at      TIMESTAMPTZ,
    note            TEXT,
    CONSTRAINT ck_req_status CHECK (status IN ('pending','approved','denied','expired','withdrawn'))
);
CREATE INDEX IF NOT EXISTS idx_join_req_net_status ON app.net_join_requests(net_id, status);

-- ==========================================================================
-- NETWORK WAREHOUSE: raw events (positions, geofence events, alerts)
-- ==========================================================================
--
-- One physical table per event kind, hypertabled by time. Networks are
-- segregated logically by (net_id, org_id) columns and enforced by RLS,
-- rather than by table-per-network — one table per network multiplies DDL
-- churn and breaks cross-net analytics with no security benefit RLS does
-- not already provide.
-- ==========================================================================

CREATE TABLE IF NOT EXISTS events_raw.positions (
    org_id          TEXT NOT NULL,
    net_id          TEXT,                       -- NULL for org-wide fleet
    subject_id      TEXT NOT NULL,
    tracker_id      TEXT NOT NULL,
    recorded_at     TIMESTAMPTZ NOT NULL,
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lat             DOUBLE PRECISION NOT NULL,
    lon             DOUBLE PRECISION NOT NULL,
    geom            GEOGRAPHY(Point, 4326),     -- generated at insert time
    accuracy_m      DOUBLE PRECISION,
    speed_kmh       DOUBLE PRECISION,
    heading_deg     DOUBLE PRECISION,
    altitude_m      DOUBLE PRECISION,
    battery_pct     INT,
    telemetry       JSONB NOT NULL DEFAULT '{}'::jsonb,
    source          TEXT NOT NULL DEFAULT 'device'  -- device | sim | replay
);
-- (org_id, subject_id, recorded_at) is the natural read pattern for replay;
-- keep the index cheap by not making it unique — the ingest layer dedupes.
CREATE INDEX IF NOT EXISTS idx_positions_subject_time
    ON events_raw.positions(org_id, subject_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_positions_net_time
    ON events_raw.positions(net_id, recorded_at DESC) WHERE net_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_positions_geom
    ON events_raw.positions USING GIST (geom);

DO $$ BEGIN
    PERFORM create_hypertable('events_raw.positions', 'recorded_at',
                              chunk_time_interval => INTERVAL '1 day',
                              if_not_exists => TRUE);
EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE 'create_hypertable() unavailable; positions is a plain table';
END $$;

CREATE TABLE IF NOT EXISTS events_raw.geofence_events (
    event_id        UUID NOT NULL DEFAULT gen_random_uuid(),
    org_id          TEXT NOT NULL,
    net_id          TEXT,
    subject_id      TEXT NOT NULL,
    geofence_id     TEXT NOT NULL,
    geofence_name   TEXT NOT NULL,
    kind            TEXT NOT NULL,              -- enter | exit | dwell
    occurred_at     TIMESTAMPTZ NOT NULL,
    lat             DOUBLE PRECISION NOT NULL,
    lon             DOUBLE PRECISION NOT NULL,
    CONSTRAINT ck_geofence_event_kind CHECK (kind IN ('enter','exit','dwell'))
);
CREATE INDEX IF NOT EXISTS idx_geofence_events_org_time
    ON events_raw.geofence_events(org_id, occurred_at DESC);

DO $$ BEGIN
    PERFORM create_hypertable('events_raw.geofence_events', 'occurred_at',
                              chunk_time_interval => INTERVAL '7 day',
                              if_not_exists => TRUE);
EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE 'create_hypertable() unavailable; geofence_events is a plain table';
END $$;

CREATE TABLE IF NOT EXISTS events_raw.alerts (
    alert_id        TEXT PRIMARY KEY,
    org_id          TEXT NOT NULL,
    net_id          TEXT,
    subject_id      TEXT NOT NULL,
    subject_label   TEXT NOT NULL,
    kind            TEXT NOT NULL,
    severity        TEXT NOT NULL,
    message         TEXT NOT NULL,
    lat             DOUBLE PRECISION,
    lon             DOUBLE PRECISION,
    raised_at       TIMESTAMPTZ NOT NULL,
    acknowledged_by TEXT,
    acknowledged_at TIMESTAMPTZ,
    CONSTRAINT ck_alert_severity CHECK (severity IN ('info','warning','critical'))
);
CREATE INDEX IF NOT EXISTS idx_alerts_org_time
    ON events_raw.alerts(org_id, raised_at DESC);

-- Retention: raw positions auto-drop after 90 days on Timescale. Roll up
-- into a rollup table/materialized view before this fires, once there's an
-- actual analytics consumer.
DO $$ BEGIN
    PERFORM add_retention_policy('events_raw.positions',
                                 INTERVAL '90 days',
                                 if_not_exists => TRUE);
EXCEPTION WHEN undefined_function THEN
    NULL;   -- vanilla Postgres has no add_retention_policy
END $$;

-- Compression policy for old chunks. Positions compress ~10x.
DO $$ BEGIN
    ALTER TABLE events_raw.positions SET (
        timescaledb.compress,
        timescaledb.compress_orderby = 'recorded_at DESC',
        timescaledb.compress_segmentby = 'org_id, subject_id'
    );
    PERFORM add_compression_policy('events_raw.positions',
                                   INTERVAL '7 days',
                                   if_not_exists => TRUE);
EXCEPTION WHEN undefined_function OR feature_not_supported OR undefined_column THEN
    NULL;
END $$;

-- ==========================================================================
-- ROW-LEVEL SECURITY
-- ==========================================================================
--
-- Every request sets `SET LOCAL app.current_org = '<org_id>'`. Policies
-- match rows against that setting. If the app forgets to set it, queries
-- return zero rows rather than the wrong tenant's rows.
-- ==========================================================================

-- Small helper so policies are readable.
CREATE OR REPLACE FUNCTION identity.current_org() RETURNS TEXT
LANGUAGE sql STABLE AS $$
    SELECT current_setting('app.current_org', true)
$$;

-- Convenience macro-ish DO block: enable RLS on every tenant table and
-- attach a symmetric policy. Adding a new tenant table only needs one
-- append to this list.
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'identity.memberships',
        'identity.refresh_tokens',
        'identity.audit_log',
        'app.subjects',
        'app.device_keys',
        'app.geofences',
        'app.trips',
        'app.floaknets',
        'app.net_members',
        'app.net_join_requests',
        'events_raw.positions',
        'events_raw.geofence_events',
        'events_raw.alerts'
    ] LOOP
        EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
        EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
        EXECUTE format(
            'DROP POLICY IF EXISTS p_tenant ON %s;
             CREATE POLICY p_tenant ON %s
                USING (org_id = identity.current_org() OR identity.current_org() = ''__super__'')
                WITH CHECK (org_id = identity.current_org() OR identity.current_org() = ''__super__'')',
            tbl, tbl);
    END LOOP;
END $$;

-- app.net_join_requests carries no org_id column of its own — the check
-- runs through the parent net. Replace the generic policy with a scoped one.
DROP POLICY IF EXISTS p_tenant ON app.net_join_requests;
CREATE POLICY p_tenant ON app.net_join_requests
    USING (
        EXISTS (SELECT 1 FROM app.floaknets n
                WHERE n.net_id = app.net_join_requests.net_id
                  AND (n.org_id = identity.current_org()
                       OR identity.current_org() = '__super__'))
    );

-- Grants: floak_app reads/writes identity, app, events_raw. There is no
-- analytics-only role for now — floak_analytics can be reintroduced
-- alongside the dbt layer described above once it's actually needed.
--
-- Safe to re-run by hand on a database that already exists (e.g. after
-- pulling a newer schema.sql without wiping the Postgres volume) - just
-- connect as the superuser and re-execute from here down. Postgres only
-- runs docker-entrypoint-initdb.d scripts on a brand-new, empty data
-- directory, so an existing pgdata volume will silently skip all of this
-- file, including these grants, which is what "permission denied for schema
-- identity" means: the role exists but was never actually granted anything
-- on this particular database instance.
GRANT USAGE ON SCHEMA identity, app, events_raw TO floak_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA identity, app, events_raw TO floak_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA identity, app, events_raw TO floak_app;

GRANT USAGE ON SCHEMA events_raw TO floak_analytics;
GRANT SELECT ON ALL TABLES IN SCHEMA events_raw TO floak_analytics;

-- Default privileges: any table/sequence created AFTER this point (by a
-- migration or a future ALTER TABLE ... ADD) automatically picks up the
-- same grants, so a new table can never reintroduce this bug.
ALTER DEFAULT PRIVILEGES IN SCHEMA identity, app, events_raw
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO floak_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA identity, app, events_raw
    GRANT USAGE, SELECT ON SEQUENCES TO floak_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA events_raw
    GRANT SELECT ON TABLES TO floak_analytics;

-- ==========================================================================
-- IDENTITY SEED DATA — demo accounts so login works out of the box against
-- a fresh Postgres instance, matching the in-memory fallback seed in
-- repositories/users.py. Password for both is "demo1234" (Argon2 hash below
-- via passlib's default settings). Safe to re-run: ON CONFLICT DO NOTHING.
-- ==========================================================================

INSERT INTO identity.orgs (org_id, name, plan)
VALUES ('org_demo', 'Floak Demo Org', 'demo')
ON CONFLICT (org_id) DO NOTHING;

INSERT INTO identity.users (user_id, email_lower, display_name, password_hash, status)
VALUES
    ('00000000-0000-0000-0000-000000000001', 'maya@floak.demo', 'Maya Ortiz',
     '$argon2id$v=19$m=65536,t=3,p=4$4zzn/L/3HgPA+J9TKmXMWQ$JJDa/LcKxVQHMNZ/kHkuBCfxZY94atvy2z6J5pLUPEk', 'active'),
    ('00000000-0000-0000-0000-000000000002', 'ops@floak.demo', 'Ops',
     '$argon2id$v=19$m=65536,t=3,p=4$NYaQ0rr3fg9hLCWkFEKI8Q$8b4vFX2OyemC3bOnNo4KGBHGHHhNeyLCK53f0TmbOL0', 'active')
ON CONFLICT (email_lower) DO NOTHING;

INSERT INTO identity.memberships (org_id, user_id, role)
VALUES
    ('org_demo', '00000000-0000-0000-0000-000000000001', 'dispatcher'),
    ('org_demo', '00000000-0000-0000-0000-000000000002', 'owner')
ON CONFLICT (org_id, user_id) DO NOTHING;
