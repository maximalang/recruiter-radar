-- Roll back the custom Telegram inbound claim protocol.
BEGIN;

-- Do not leave a status that the pre-claim schema cannot represent.
UPDATE notification_inbound_events
SET status = 'failed',
    processed_at = COALESCE(processed_at, NOW()),
    error_message = COALESCE(error_message, 'Claim protocol migration rolled back.')
WHERE status = 'processing';

ALTER TABLE notification_inbound_events
  DROP CONSTRAINT IF EXISTS notification_inbound_events_terminal_claim_check;

ALTER TABLE notification_inbound_events
  DROP CONSTRAINT IF EXISTS notification_inbound_events_status_check;

ALTER TABLE notification_inbound_events
  ADD CONSTRAINT notification_inbound_events_status_check
  CHECK (status IN ('received', 'processed', 'ignored', 'failed'));

ALTER TABLE notification_inbound_events
  DROP COLUMN IF EXISTS processing_claimed_at,
  DROP COLUMN IF EXISTS processing_claim_token;

COMMIT;
