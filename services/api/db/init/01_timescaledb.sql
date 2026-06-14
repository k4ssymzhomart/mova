-- Runs once on first DB init (mounted into /docker-entrypoint-initdb.d).
-- Enables TimescaleDB and creates a hypertable for streamed FoG telemetry.

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS fog_events (
    time        TIMESTAMPTZ      NOT NULL,
    session_id  TEXT             NOT NULL,
    is_fog      BOOLEAN          NOT NULL,
    confidence  DOUBLE PRECISION NOT NULL,
    freeze_index DOUBLE PRECISION
);

SELECT create_hypertable('fog_events', 'time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS fog_events_session_time_idx
    ON fog_events (session_id, time DESC);
