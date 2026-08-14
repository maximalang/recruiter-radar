BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE lead_channel_deliveries
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processing_claim_token UUID,
  ADD COLUMN IF NOT EXISTS last_error_reason TEXT;

ALTER TABLE lead_channel_deliveries
  DROP CONSTRAINT IF EXISTS lead_channel_deliveries_attempt_count_check,
  DROP CONSTRAINT IF EXISTS lead_channel_deliveries_status_check;

UPDATE lead_channel_deliveries
SET delivery_status = CASE
  WHEN delivery_status = 'sent' THEN 'sent'
  WHEN delivery_status IN ('processing', 'partial', 'failed') THEN 'failed_terminal'
  ELSE 'failed_terminal'
END,
processing_claim_token = NULL,
next_retry_at = NULL,
attempt_count = LEAST(GREATEST(attempt_count, 1), 5);

UPDATE digest_delivery_attempts
SET status = 'failed_terminal',
    processing_claim_token = NULL
WHERE channel = 'telegram'
  AND status IN ('failed', 'processing')
  AND idempotency_key LIKE 'digest:%:profile:%:telegram-batch';

ALTER TABLE lead_channel_deliveries
  ADD CONSTRAINT lead_channel_deliveries_attempt_count_check
    CHECK (attempt_count BETWEEN 1 AND 5),
  ADD CONSTRAINT lead_channel_deliveries_status_check
    CHECK (delivery_status IN ('processing', 'sent', 'failed_retryable', 'failed_terminal'));

COMMENT ON COLUMN lead_channel_deliveries.delivery_status IS
  'Fenced aggregate channel state. Only failed_retryable may be reclaimed; sent and failed_terminal are final.';
COMMENT ON COLUMN lead_channel_deliveries.processing_claim_token IS
  'Fences finalization to the worker that owns the current processing attempt.';
COMMENT ON COLUMN lead_channel_deliveries.next_retry_at IS
  'Database-owned eligibility timestamp for failed_retryable aggregate deliveries.';

COMMENT ON COLUMN digest_delivery_attempts.status IS
  'Telegram batch state. sent and skipped_not_configured are successful final states; failed_terminal and stale processing are never replayed automatically.';

COMMIT;
