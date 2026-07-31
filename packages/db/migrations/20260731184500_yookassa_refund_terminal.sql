BEGIN;

CREATE OR REPLACE FUNCTION enforce_checkout_order_payment_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'refunded' AND NEW.status <> 'refunded' THEN
    RAISE EXCEPTION 'refunded checkout order % is terminal', OLD.id;
  END IF;

  IF OLD.status = 'paid' AND NEW.status NOT IN ('paid', 'refunded') THEN
    RAISE EXCEPTION 'paid checkout order % cannot be downgraded to %', OLD.id, NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS checkout_orders_enforce_payment_transition ON checkout_orders;
CREATE TRIGGER checkout_orders_enforce_payment_transition
BEFORE UPDATE OF status ON checkout_orders
FOR EACH ROW
EXECUTE FUNCTION enforce_checkout_order_payment_transition();

CREATE OR REPLACE FUNCTION reconcile_pilot_entitlement_after_full_refund()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  remaining_ends_at TIMESTAMPTZ;
BEGIN
  IF NEW.status <> 'refunded' OR OLD.status = 'refunded' OR NEW.plan_code <> 'pilot' THEN
    RETURN NEW;
  END IF;

  SELECT MAX(COALESCE(paid_at, created_at) + INTERVAL '7 days')
    INTO remaining_ends_at
  FROM checkout_orders
  WHERE user_id = NEW.user_id
    AND id <> NEW.id
    AND plan_code = 'pilot'
    AND status = 'paid';

  IF remaining_ends_at IS NOT NULL AND remaining_ends_at > NOW() THEN
    INSERT INTO pilot_enrollments (user_id, status, starts_at, ends_at, activated_by, notes)
    VALUES (NEW.user_id, 'active', NOW(), remaining_ends_at, 'refund_reconciliation', 'reconciled_after_refund')
    ON CONFLICT (user_id) WHERE status = 'active'
    DO UPDATE SET
      ends_at = EXCLUDED.ends_at,
      updated_at = NOW(),
      activated_by = EXCLUDED.activated_by,
      notes = EXCLUDED.notes;
  ELSE
    UPDATE pilot_enrollments
    SET status = 'canceled',
        ends_at = GREATEST(starts_at + INTERVAL '1 second', LEAST(COALESCE(ends_at, NOW()), NOW())),
        updated_at = NOW(),
        activated_by = 'refund_reconciliation',
        notes = 'full_refund_checkout_order:' || NEW.id::TEXT
    WHERE user_id = NEW.user_id AND status = 'active';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS checkout_orders_reconcile_refund_entitlement ON checkout_orders;
CREATE TRIGGER checkout_orders_reconcile_refund_entitlement
AFTER UPDATE OF status ON checkout_orders
FOR EACH ROW
EXECUTE FUNCTION reconcile_pilot_entitlement_after_full_refund();

COMMIT;
