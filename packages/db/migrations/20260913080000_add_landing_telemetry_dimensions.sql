-- Landing telemetry demand-measurement dimensions (task t_98d91920).
--
-- Adds the preregistered observation dimensions as dedicated columns:
--   visit_id       - keyed pseudonymous visit identifier (server-derived,
--                    32 hex chars) for session dedupe and outcome linkage;
--                    deliberately NOT event_key, which is UNIQUE and would
--                    collapse a visit's funnel into one row.
--   referer_class  - fixed taxonomy: relevant|not_relevant|unknown
--   utm_source_class - fixed taxonomy: relevant|not_relevant|unknown
--   ua_class       - fixed taxonomy: browser|bot|monitoring|internal
--   internal_marker - fixed taxonomy: none|preview|staff|healthcheck
-- Class taxonomies are frozen BEFORE any observation window (protocol §4);
-- raw referer/UTM/user-agent strings are never stored.
--
-- Backfill: existing rows keep NULL dimensions - they predate the
-- observation protocol and must not be re-classified.

BEGIN;

ALTER TABLE product_telemetry_events
  ADD COLUMN visit_id TEXT;
ALTER TABLE product_telemetry_events
  ADD COLUMN referer_class TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE product_telemetry_events
  ADD COLUMN utm_source_class TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE product_telemetry_events
  ADD COLUMN ua_class TEXT NOT NULL DEFAULT 'browser';
ALTER TABLE product_telemetry_events
  ADD COLUMN internal_marker TEXT NOT NULL DEFAULT 'none';

ALTER TABLE product_telemetry_events
  ADD CONSTRAINT product_telemetry_visit_id_format
    CHECK (visit_id IS NULL OR visit_id ~ '^[0-9a-f]{32}$');
ALTER TABLE product_telemetry_events
  ADD CONSTRAINT product_telemetry_referer_class_check
    CHECK (referer_class IN ('relevant', 'not_relevant', 'unknown'));
ALTER TABLE product_telemetry_events
  ADD CONSTRAINT product_telemetry_utm_source_class_check
    CHECK (utm_source_class IN ('relevant', 'not_relevant', 'unknown'));
ALTER TABLE product_telemetry_events
  ADD CONSTRAINT product_telemetry_ua_class_check
    CHECK (ua_class IN ('browser', 'bot', 'monitoring', 'internal'));
ALTER TABLE product_telemetry_events
  ADD CONSTRAINT product_telemetry_internal_marker_check
    CHECK (internal_marker IN ('none', 'preview', 'staff', 'healthcheck'));

CREATE INDEX product_telemetry_visit_time_idx
  ON product_telemetry_events (visit_id, occurred_at)
  WHERE visit_id IS NOT NULL;

COMMIT;
