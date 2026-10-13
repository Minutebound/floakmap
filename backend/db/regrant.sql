-- Run this against an EXISTING database that is hitting "permission denied
-- for schema identity" (or any schema) because floak_app was never actually
-- granted anything on it -- typically because docker-entrypoint-initdb.d
-- only runs once, on a brand-new Postgres data directory, so a schema.sql
-- update never re-applies to a volume that already has data in it.
--
-- Usage:
--   docker compose exec db psql -U postgres -d floakmap -f /docker-entrypoint-initdb.d/../db/regrant.sql
-- or, from your host, with the port published:
--   psql "postgresql://postgres:floak@localhost:5432/floakmap" -f backend/db/regrant.sql
--
-- Idempotent -- safe to run as many times as you like.

GRANT USAGE ON SCHEMA identity, app, events_raw, stg, int, marts TO floak_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA identity, app, events_raw TO floak_app;
GRANT SELECT ON ALL TABLES IN SCHEMA stg, int, marts TO floak_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA identity, app, events_raw TO floak_app;

GRANT USAGE ON SCHEMA stg, int, marts, events_raw TO floak_analytics;
GRANT SELECT ON ALL TABLES IN SCHEMA stg, int, marts, events_raw TO floak_analytics;

ALTER DEFAULT PRIVILEGES IN SCHEMA identity, app, events_raw
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO floak_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA stg, int, marts
    GRANT SELECT ON TABLES TO floak_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA identity, app, events_raw
    GRANT USAGE, SELECT ON SEQUENCES TO floak_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA stg, int, marts, events_raw
    GRANT SELECT ON TABLES TO floak_analytics;

-- Quick sanity check: should list rows for identity.* tables with floak_app
-- as grantee once this has run successfully.
-- SELECT table_schema, table_name, privilege_type
--   FROM information_schema.table_privileges
--  WHERE grantee = 'floak_app' AND table_schema = 'identity';
