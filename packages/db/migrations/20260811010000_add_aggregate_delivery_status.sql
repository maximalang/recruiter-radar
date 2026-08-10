BEGIN;

ALTER TABLE lead_channel_deliveries
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE lead_channel_deliveries
  ALTER COLUMN delivered_at DROP NOT NULL,
  ALTER COLUMN delivered_at DROP DEFAULT;

ALTER TABLE lead_channel_deliveries
  DROP CONSTRAINT IF EXISTS lead_channel_deliveries_status_check;

ALTER TABLE lead_channel_deliveries
  ADD CONSTRAINT lead_channel_deliveries_status_check
  CHECK (delivery_status IN ('processing', 'sent', 'partial', 'failed'));

COMMENT ON COLUMN lead_channel_deliveries.delivery_status IS
  'Aggregate Email/Web Push delivery outcome. Existing pre-migration rows are treated as sent; new claims start processing and are finalized after the provider attempt.';
COMMENT ON COLUMN lead_channel_deliveries.attempted_at IS
  'Timestamp when the aggregate delivery claim was acquired.';
COMMENT ON COLUMN lead_channel_deliveries.delivered_at IS
  'Timestamp of an actual successful or partially successful provider delivery. NULL for processing/failed claims.';

COMMIT;