BEGIN;

CREATE TABLE IF NOT EXISTS checkout_order_entitlements (
  order_id BIGINT PRIMARY KEY REFERENCES checkout_orders(id) ON DELETE RESTRICT,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL CHECK (plan_code IN ('pilot', 'monthly', 'quarterly')),
  duration_days INTEGER NOT NULL CHECK (duration_days IN (7, 30, 90)),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS checkout_order_entitlements_user_ends_idx
  ON checkout_order_entitlements (user_id, ends_at DESC);

COMMIT;
