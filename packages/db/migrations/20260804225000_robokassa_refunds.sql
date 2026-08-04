BEGIN;

CREATE TABLE IF NOT EXISTS payment_refunds (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES checkout_orders(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL DEFAULT 'robokassa',
  provider_refund_id TEXT,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  is_full BOOLEAN NOT NULL,
  status TEXT NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating', 'requested', 'processing', 'succeeded', 'failed')),
  requested_by TEXT NOT NULL,
  provider_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  error_message TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (BTRIM(provider) <> ''),
  CHECK (BTRIM(requested_by) <> ''),
  CHECK (provider_refund_id IS NULL OR BTRIM(provider_refund_id) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_refunds_provider_id_uidx
  ON payment_refunds (provider, provider_refund_id)
  WHERE provider_refund_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_refunds_order_created_idx
  ON payment_refunds (order_id, created_at DESC);

CREATE OR REPLACE FUNCTION enforce_payment_refund_amount()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  order_amount_minor BIGINT;
  order_status TEXT;
  order_provider TEXT;
  reserved_amount_minor BIGINT;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.order_id <> OLD.order_id
    OR NEW.provider <> OLD.provider
    OR NEW.amount_minor <> OLD.amount_minor
    OR NEW.is_full <> OLD.is_full
  ) THEN
    RAISE EXCEPTION 'refund financial identity is immutable';
  END IF;

  SELECT amount_rub::BIGINT * 100, status, provider
  INTO order_amount_minor, order_status, order_provider
  FROM checkout_orders
  WHERE id = NEW.order_id
  FOR UPDATE;

  IF order_amount_minor IS NULL THEN
    RAISE EXCEPTION 'checkout order % not found', NEW.order_id;
  END IF;

  IF order_status NOT IN ('paid', 'refunded') THEN
    RAISE EXCEPTION 'checkout order % is not refundable in status %', NEW.order_id, order_status;
  END IF;

  IF order_provider <> 'robokassa' OR NEW.provider <> 'robokassa' THEN
    RAISE EXCEPTION 'checkout order % is not a Robokassa order', NEW.order_id;
  END IF;

  IF NEW.amount_minor > order_amount_minor THEN
    RAISE EXCEPTION 'refund amount exceeds checkout order % amount', NEW.order_id;
  END IF;

  IF NEW.is_full <> (NEW.amount_minor = order_amount_minor) THEN
    RAISE EXCEPTION 'refund full flag does not match amount for checkout order %', NEW.order_id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(SUM(amount_minor), 0)
    INTO reserved_amount_minor
    FROM payment_refunds
    WHERE order_id = NEW.order_id
      AND status IN ('creating', 'requested', 'processing', 'succeeded');

    IF reserved_amount_minor + NEW.amount_minor > order_amount_minor THEN
      RAISE EXCEPTION 'refund reservations exceed checkout order % amount', NEW.order_id;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'succeeded' AND NEW.status <> 'succeeded' THEN
      RAISE EXCEPTION 'succeeded refund % is terminal', OLD.id;
    END IF;
    IF OLD.status = 'failed' AND NEW.status <> 'failed' THEN
      RAISE EXCEPTION 'failed refund % is terminal', OLD.id;
    END IF;
    IF OLD.status = 'creating' AND NEW.status NOT IN ('creating', 'requested', 'failed') THEN
      RAISE EXCEPTION 'invalid refund transition creating -> %', NEW.status;
    END IF;
    IF OLD.status = 'requested' AND NEW.status NOT IN ('requested', 'processing', 'succeeded', 'failed') THEN
      RAISE EXCEPTION 'invalid refund transition requested -> %', NEW.status;
    END IF;
    IF OLD.status = 'processing' AND NEW.status NOT IN ('processing', 'succeeded', 'failed') THEN
      RAISE EXCEPTION 'invalid refund transition processing -> %', NEW.status;
    END IF;
  END IF;

  NEW.completed_at := CASE
    WHEN NEW.status IN ('succeeded', 'failed') THEN COALESCE(NEW.completed_at, NOW())
    ELSE NULL
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_refunds_enforce_amount ON payment_refunds;
CREATE TRIGGER payment_refunds_enforce_amount
BEFORE INSERT OR UPDATE ON payment_refunds
FOR EACH ROW
EXECUTE FUNCTION enforce_payment_refund_amount();

DROP TRIGGER IF EXISTS payment_refunds_set_updated_at ON payment_refunds;
CREATE TRIGGER payment_refunds_set_updated_at
BEFORE UPDATE ON payment_refunds
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION reconcile_checkout_order_after_refund_success()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  order_amount_minor BIGINT;
  succeeded_amount_minor BIGINT;
BEGIN
  IF NEW.status <> 'succeeded' OR OLD.status = 'succeeded' THEN
    RETURN NEW;
  END IF;

  SELECT amount_rub::BIGINT * 100
  INTO order_amount_minor
  FROM checkout_orders
  WHERE id = NEW.order_id
  FOR UPDATE;

  SELECT COALESCE(SUM(amount_minor), 0)
  INTO succeeded_amount_minor
  FROM payment_refunds
  WHERE order_id = NEW.order_id
    AND status = 'succeeded';

  IF succeeded_amount_minor = order_amount_minor THEN
    UPDATE checkout_orders
    SET status = 'refunded',
        payload = jsonb_set(
          payload,
          '{paymentMessage}',
          to_jsonb('Оплата полностью возвращена через Robokassa.'::TEXT),
          true
        )
    WHERE id = NEW.order_id
      AND status = 'paid';
  ELSIF succeeded_amount_minor > order_amount_minor THEN
    RAISE EXCEPTION 'succeeded refunds exceed checkout order % amount', NEW.order_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_refunds_reconcile_order ON payment_refunds;
CREATE TRIGGER payment_refunds_reconcile_order
AFTER UPDATE OF status ON payment_refunds
FOR EACH ROW
EXECUTE FUNCTION reconcile_checkout_order_after_refund_success();

COMMIT;
