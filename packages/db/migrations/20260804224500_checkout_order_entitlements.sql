BEGIN;

CREATE TABLE IF NOT EXISTS checkout_order_entitlements (
  order_id BIGINT PRIMARY KEY REFERENCES checkout_orders(id) ON DELETE RESTRICT,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL CHECK (plan_code IN ('pilot', 'monthly', 'quarterly')),
  duration_days INTEGER NOT NULL CHECK (duration_days IN (7, 30, 90)),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at),
  CHECK (revoked_at IS NULL OR BTRIM(COALESCE(revocation_reason, '')) <> '')
);

CREATE INDEX IF NOT EXISTS checkout_order_entitlements_user_ends_idx
  ON checkout_order_entitlements (user_id, ends_at DESC)
  WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION reconcile_checkout_entitlements_after_full_refund()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_user_id BIGINT;
  cursor_at TIMESTAMPTZ;
  first_start_at TIMESTAMPTZ;
  row_item RECORD;
BEGIN
  IF NEW.status <> 'refunded' OR OLD.status = 'refunded' THEN
    RETURN NEW;
  END IF;

  UPDATE checkout_order_entitlements
  SET revoked_at = COALESCE(revoked_at, NOW()),
      revocation_reason = COALESCE(revocation_reason, 'full_refund_checkout_order:' || NEW.id::TEXT)
  WHERE order_id = NEW.id
  RETURNING user_id INTO target_user_id;

  IF target_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  cursor_at := NULL;
  first_start_at := NULL;

  FOR row_item IN
    SELECT
      entitlement.order_id,
      entitlement.duration_days,
      COALESCE(checkout.paid_at, checkout.created_at) AS paid_at
    FROM checkout_order_entitlements AS entitlement
    JOIN checkout_orders AS checkout ON checkout.id = entitlement.order_id
    WHERE entitlement.user_id = target_user_id
      AND entitlement.revoked_at IS NULL
      AND checkout.status = 'paid'
    ORDER BY COALESCE(checkout.paid_at, checkout.created_at), entitlement.order_id
  LOOP
    cursor_at := CASE
      WHEN cursor_at IS NULL THEN row_item.paid_at
      ELSE GREATEST(cursor_at, row_item.paid_at)
    END;
    first_start_at := COALESCE(first_start_at, cursor_at);

    UPDATE checkout_order_entitlements
    SET starts_at = cursor_at,
        ends_at = cursor_at + (row_item.duration_days::INT * INTERVAL '1 day')
    WHERE order_id = row_item.order_id;

    cursor_at := cursor_at + (row_item.duration_days::INT * INTERVAL '1 day');
  END LOOP;

  IF cursor_at IS NULL OR cursor_at <= NOW() THEN
    UPDATE pilot_enrollments
    SET status = 'canceled',
        ends_at = GREATEST(starts_at + INTERVAL '1 second', LEAST(COALESCE(ends_at, NOW()), NOW())),
        updated_at = NOW(),
        activated_by = 'refund_reconciliation',
        notes = 'full_refund_checkout_order:' || NEW.id::TEXT
    WHERE user_id = target_user_id
      AND status = 'active';
  ELSE
    INSERT INTO pilot_enrollments (
      user_id,
      status,
      starts_at,
      ends_at,
      activated_by,
      notes
    )
    VALUES (
      target_user_id,
      'active',
      first_start_at,
      cursor_at,
      'refund_reconciliation',
      'recalculated_after_refund:' || NEW.id::TEXT
    )
    ON CONFLICT (user_id) WHERE status = 'active'
    DO UPDATE SET
      starts_at = EXCLUDED.starts_at,
      ends_at = EXCLUDED.ends_at,
      updated_at = NOW(),
      activated_by = EXCLUDED.activated_by,
      notes = EXCLUDED.notes;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS checkout_orders_reconcile_entitlement_refund ON checkout_orders;
CREATE TRIGGER checkout_orders_reconcile_entitlement_refund
AFTER UPDATE OF status ON checkout_orders
FOR EACH ROW
EXECUTE FUNCTION reconcile_checkout_entitlements_after_full_refund();

COMMIT;
