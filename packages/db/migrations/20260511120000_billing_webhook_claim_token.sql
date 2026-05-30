-- Add claim columns to billing_webhook_events to match the route's processing claim pattern.
-- The route uses claimed_at / claim_token to prevent TOCTOU on concurrent webhook handlers.

ALTER TABLE billing_webhook_events
  ADD COLUMN claimed_at TIMESTAMPTZ,
  ADD COLUMN claim_token TEXT;

COMMENT ON COLUMN billing_webhook_events.claimed_at IS 'When the event was claimed for processing (NULL = unclaimed).';
COMMENT ON COLUMN billing_webhook_events.claim_token IS 'UUID token that must match on update to prevent TOCTOU race.';