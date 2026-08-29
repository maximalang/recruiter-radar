-- Claim protocol columns for the custom Telegram webhook replay ledger.
-- A claim is held only while status='processing'; terminal rows must not retain
-- ownership metadata, so a retry can audit them without mistaking them for work.
BEGIN;

ALTER TABLE notification_inbound_events
  ADD COLUMN IF NOT EXISTS processing_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processing_claim_token TEXT;

ALTER TABLE notification_inbound_events
  DROP CONSTRAINT IF EXISTS notification_inbound_events_status_check;

ALTER TABLE notification_inbound_events
  ADD CONSTRAINT notification_inbound_events_status_check
  CHECK (status IN ('received', 'processing', 'processed', 'ignored', 'failed'));

ALTER TABLE notification_inbound_events
  DROP CONSTRAINT IF EXISTS notification_inbound_events_terminal_claim_check;

ALTER TABLE notification_inbound_events
  ADD CONSTRAINT notification_inbound_events_terminal_claim_check
  CHECK (
    status NOT IN ('processed', 'ignored')
    OR (processing_claimed_at IS NULL AND processing_claim_token IS NULL)
  );

COMMIT;
