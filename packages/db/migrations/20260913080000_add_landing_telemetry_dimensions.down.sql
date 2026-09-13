BEGIN;

DROP INDEX IF EXISTS product_telemetry_visit_time_idx;

ALTER TABLE product_telemetry_events
  DROP CONSTRAINT IF EXISTS product_telemetry_internal_marker_check;
ALTER TABLE product_telemetry_events
  DROP CONSTRAINT IF EXISTS product_telemetry_ua_class_check;
ALTER TABLE product_telemetry_events
  DROP CONSTRAINT IF EXISTS product_telemetry_utm_source_class_check;
ALTER TABLE product_telemetry_events
  DROP CONSTRAINT IF EXISTS product_telemetry_referer_class_check;
ALTER TABLE product_telemetry_events
  DROP CONSTRAINT IF EXISTS product_telemetry_visit_id_format;

ALTER TABLE product_telemetry_events
  DROP COLUMN IF EXISTS internal_marker;
ALTER TABLE product_telemetry_events
  DROP COLUMN IF EXISTS ua_class;
ALTER TABLE product_telemetry_events
  DROP COLUMN IF EXISTS utm_source_class;
ALTER TABLE product_telemetry_events
  DROP COLUMN IF EXISTS referer_class;
ALTER TABLE product_telemetry_events
  DROP COLUMN IF EXISTS visit_id;

COMMIT;
