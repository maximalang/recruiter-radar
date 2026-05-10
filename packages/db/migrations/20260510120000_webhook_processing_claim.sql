BEGIN;
ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS processing_claimed_at TIMESTAMPTZ;
COMMIT;
