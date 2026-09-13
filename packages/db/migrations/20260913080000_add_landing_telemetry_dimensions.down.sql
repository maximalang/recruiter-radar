BEGIN;

DROP INDEX IF EXISTS product_telemetry_visit_time_idx;

ALTER TABLE product_telemetry_events
  DROP CONSTRAINT IF EXISTS product_telemetry_visit_id_format;

ALTER TABLE product_telemetry_events
  DROP COLUMN IF EXISTS visit_id;

COMMIT;
