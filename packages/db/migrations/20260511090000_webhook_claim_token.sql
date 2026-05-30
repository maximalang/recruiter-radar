BEGIN;
ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS processing_claim_token TEXT;
COMMIT;
