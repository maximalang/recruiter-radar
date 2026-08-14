BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE lead_channel_deliveries
  DROP CONSTRAINT IF EXISTS lead_channel_deliveries_status_check,
  DROP CONSTRAINT IF EXISTS lead_channel_deliveries_attempt_count_check;

ALTER TABLE lead_channel_deliveries
  ADD CONSTRAINT lead_channel_deliveries_status_check
    CHECK (delivery_status IN (
      'processing', 'sent', 'partial', 'failed', 'failed_retryable', 'failed_terminal'
    ));

ALTER TABLE lead_channel_deliveries
  DROP COLUMN IF EXISTS last_error_reason,
  DROP COLUMN IF EXISTS processing_claim_token,
  DROP COLUMN IF EXISTS next_retry_at,
  DROP COLUMN IF EXISTS attempt_count;

COMMENT ON COLUMN digest_delivery_attempts.status IS
  'Rollback preserves failed_terminal so legacy code cannot replay an ambiguous Telegram delivery.';

COMMIT;
