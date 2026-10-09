-- Landing telemetry demand-measurement dimensions (task t_98d91920).
--
-- Adds the keyed pseudonymous visit identifier as a dedicated column:
--   visit_id - server-derived, 32 hex chars, rotates daily; used for
--              session dedupe and outcome linkage. Deliberately NOT
--              event_key, which is UNIQUE and would collapse a visit's
--              funnel into one row.
--
-- Observation classes (referer_class, utm_source_class, ua_class,
-- internal_marker) stay inside the existing metadata JSONB: their fixed
-- vocabularies are validated at ingress (apps/web/lib/telemetry-dimensions.ts)
-- and their definitions stay re-interpretable only via a new preregistration,
-- without re-shaping a hot table. The funnel report reads them from metadata,
-- so class semantics never drift from a second DDL copy.
--
-- Backfill: existing rows keep NULL visit_id - they predate the observation
-- protocol and must not be re-linked.

BEGIN;

ALTER TABLE product_telemetry_events
  ADD COLUMN visit_id TEXT;

ALTER TABLE product_telemetry_events
  ADD CONSTRAINT product_telemetry_visit_id_format
    CHECK (visit_id IS NULL OR visit_id ~ '^[0-9a-f]{32}$');

CREATE INDEX product_telemetry_visit_time_idx
  ON product_telemetry_events (visit_id, occurred_at)
  WHERE visit_id IS NOT NULL;

COMMIT;
