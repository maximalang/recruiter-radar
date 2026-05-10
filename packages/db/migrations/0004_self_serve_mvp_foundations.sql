BEGIN;

CREATE TYPE pilot_status AS ENUM (
  'requested',
  'active',
  'expired',
  'converted',
  'canceled'
);

CREATE TABLE webhook_events (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  error_message TEXT,
  processed_at TIMESTAMPTZ,
  processing_claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT webhook_events_provider_not_blank CHECK (BTRIM(provider) <> ''),
  CONSTRAINT webhook_events_event_type_not_blank CHECK (BTRIM(event_type) <> ''),
  CONSTRAINT webhook_events_external_event_id_not_blank CHECK (BTRIM(external_event_id) <> ''),
  CONSTRAINT webhook_events_idempotency_key_not_blank CHECK (BTRIM(idempotency_key) <> '')
);
CREATE UNIQUE INDEX webhook_events_provider_idempotency_uidx
  ON webhook_events (provider, idempotency_key);
CREATE INDEX webhook_events_provider_event_type_idx
  ON webhook_events (provider, event_type, created_at DESC);

CREATE TABLE digest_delivery_attempts (
  id BIGSERIAL PRIMARY KEY,
  digest_candidate_id BIGINT NOT NULL REFERENCES digest_candidates(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'telegram',
  status TEXT NOT NULL,
  error_message TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT digest_delivery_attempts_idempotency_key_not_blank CHECK (BTRIM(idempotency_key) <> ''),
  CONSTRAINT digest_delivery_attempts_channel_not_blank CHECK (BTRIM(channel) <> '')
);
CREATE UNIQUE INDEX digest_delivery_attempts_candidate_idempotency_uidx
  ON digest_delivery_attempts (digest_candidate_id, idempotency_key);

CREATE TABLE billing_webhook_events (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  error_message TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_webhook_provider_not_blank CHECK (BTRIM(provider) <> ''),
  CONSTRAINT billing_webhook_external_event_id_not_blank CHECK (BTRIM(external_event_id) <> ''),
  CONSTRAINT billing_webhook_idempotency_key_not_blank CHECK (BTRIM(idempotency_key) <> '')
);
CREATE UNIQUE INDEX billing_webhook_provider_idempotency_uidx
  ON billing_webhook_events (provider, idempotency_key);

CREATE TABLE checkout_orders (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL,
  amount_rub INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RUB',
  status TEXT NOT NULL DEFAULT 'created',
  external_order_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT checkout_orders_plan_code_not_blank CHECK (BTRIM(plan_code) <> ''),
  CONSTRAINT checkout_orders_amount_positive CHECK (amount_rub > 0),
  CONSTRAINT checkout_orders_currency_not_blank CHECK (BTRIM(currency) <> '')
);

CREATE TABLE pilot_enrollments (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status pilot_status NOT NULL DEFAULT 'requested',
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  activated_by TEXT NOT NULL DEFAULT 'system',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pilot_enrollments_activated_by_not_blank CHECK (BTRIM(activated_by) <> ''),
  CONSTRAINT pilot_enrollments_window_check CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE UNIQUE INDEX pilot_enrollments_active_user_uidx
  ON pilot_enrollments (user_id)
  WHERE status = 'active';

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS billing_provider TEXT,
  ADD COLUMN IF NOT EXISTS billing_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS billing_subscription_id TEXT;

CREATE INDEX subscriptions_billing_provider_customer_idx
  ON subscriptions (billing_provider, billing_customer_id)
  WHERE billing_provider IS NOT NULL AND billing_customer_id IS NOT NULL;

CREATE TRIGGER checkout_orders_set_updated_at
BEFORE UPDATE ON checkout_orders
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER pilot_enrollments_set_updated_at
BEFORE UPDATE ON pilot_enrollments
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;
