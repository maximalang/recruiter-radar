BEGIN;
ALTER TABLE digest_delivery_attempts
  ADD COLUMN IF NOT EXISTS processing_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processing_claim_token TEXT;
COMMIT;
