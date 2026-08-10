BEGIN;

UPDATE lead_channel_deliveries
SET delivered_at = COALESCE(delivered_at, attempted_at, NOW())
WHERE delivered_at IS NULL;

ALTER TABLE lead_channel_deliveries
  ALTER COLUMN delivered_at SET DEFAULT NOW(),
  ALTER COLUMN delivered_at SET NOT NULL;

ALTER TABLE lead_channel_deliveries
  DROP CONSTRAINT IF EXISTS lead_channel_deliveries_status_check,
  DROP COLUMN IF EXISTS delivery_status,
  DROP COLUMN IF EXISTS attempted_at;

COMMIT;