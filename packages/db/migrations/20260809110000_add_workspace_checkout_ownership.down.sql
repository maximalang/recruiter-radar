BEGIN;

-- A legacy schema cannot represent two active grants with the same source for
-- one user. Fail before dropping any scoped data so rollback stays recoverable.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM entitlement_grants
    WHERE status = 'active'
    GROUP BY user_id, source
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'cannot remove workspace entitlement scope while duplicate active user grants exist'
      USING ERRCODE = '2BP01';
  END IF;
END;
$$;

DROP INDEX IF EXISTS entitlement_grants_active_workspace_owner_source_uidx;
DROP INDEX IF EXISTS entitlement_grants_audit_workspace_owner_idx;
DROP INDEX IF EXISTS entitlement_grants_effective_workspace_owner_idx;

ALTER TABLE entitlement_grants
  DROP CONSTRAINT IF EXISTS entitlement_grants_owner_workspace_member_fkey,
  DROP COLUMN IF EXISTS entitlement_owner_id,
  DROP COLUMN IF EXISTS workspace_id;

CREATE INDEX entitlement_grants_effective_user_idx
  ON entitlement_grants (user_id, ends_at DESC)
  WHERE status = 'active';
CREATE INDEX entitlement_grants_audit_user_idx
  ON entitlement_grants (user_id, created_at DESC);
CREATE UNIQUE INDEX entitlement_grants_active_user_source_uidx
  ON entitlement_grants (user_id, source)
  WHERE status = 'active';

DROP INDEX IF EXISTS checkout_order_entitlements_workspace_owner_ends_idx;

ALTER TABLE checkout_order_entitlements
  DROP CONSTRAINT IF EXISTS checkout_order_entitlements_order_scope_fkey,
  DROP CONSTRAINT IF EXISTS checkout_order_entitlements_owner_matches_user_check,
  DROP COLUMN IF EXISTS entitlement_owner_id,
  DROP COLUMN IF EXISTS workspace_id;

DROP INDEX IF EXISTS checkout_orders_entitlement_scope_uidx;

ALTER TABLE checkout_orders
  DROP CONSTRAINT IF EXISTS checkout_orders_entitlement_owner_workspace_member_fkey,
  DROP CONSTRAINT IF EXISTS checkout_orders_purchaser_workspace_member_fkey,
  DROP COLUMN IF EXISTS entitlement_owner_id,
  DROP COLUMN IF EXISTS purchased_by_user_id,
  ALTER COLUMN workspace_id DROP NOT NULL;

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
    SELECT entitlement.order_id, entitlement.duration_days,
           COALESCE(checkout.paid_at, checkout.created_at) AS paid_at
    FROM checkout_order_entitlements AS entitlement
    JOIN checkout_orders AS checkout ON checkout.id = entitlement.order_id
    WHERE entitlement.user_id = target_user_id
      AND entitlement.revoked_at IS NULL
      AND checkout.status = 'paid'
    ORDER BY COALESCE(checkout.paid_at, checkout.created_at), entitlement.order_id
  LOOP
    cursor_at := CASE WHEN cursor_at IS NULL THEN row_item.paid_at
      ELSE GREATEST(cursor_at, row_item.paid_at) END;
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
        updated_at = NOW(), activated_by = 'refund_reconciliation',
        notes = 'full_refund_checkout_order:' || NEW.id::TEXT
    WHERE user_id = target_user_id AND status = 'active';
  ELSE
    INSERT INTO pilot_enrollments (
      user_id, status, starts_at, ends_at, activated_by, notes
    ) VALUES (
      target_user_id, 'active', first_start_at, cursor_at,
      'refund_reconciliation', 'recalculated_after_refund:' || NEW.id::TEXT
    )
    ON CONFLICT (user_id) WHERE status = 'active'
    DO UPDATE SET starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at,
      updated_at = NOW(), activated_by = EXCLUDED.activated_by,
      notes = EXCLUDED.notes;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
