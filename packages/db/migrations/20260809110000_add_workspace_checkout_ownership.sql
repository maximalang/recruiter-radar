SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE checkout_orders
  ADD COLUMN purchased_by_user_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN entitlement_owner_id BIGINT REFERENCES users(id) ON DELETE RESTRICT;

-- Preserve legacy ownership while making the actor/recipient split explicit.
-- Updating every row also lets the existing tenant trigger fill workspace_id.
UPDATE checkout_orders
SET purchased_by_user_id = user_id,
    entitlement_owner_id = user_id,
    updated_at = updated_at;

ALTER TABLE checkout_orders
  ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN purchased_by_user_id SET NOT NULL,
  ALTER COLUMN entitlement_owner_id SET NOT NULL,
  ADD CONSTRAINT checkout_orders_purchaser_workspace_member_fkey
    FOREIGN KEY (workspace_id, purchased_by_user_id)
    REFERENCES workspace_members(workspace_id, user_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT checkout_orders_entitlement_owner_workspace_member_fkey
    FOREIGN KEY (workspace_id, entitlement_owner_id)
    REFERENCES workspace_members(workspace_id, user_id)
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX checkout_orders_entitlement_scope_uidx
  ON checkout_orders (id, workspace_id, entitlement_owner_id);

ALTER TABLE checkout_order_entitlements
  ADD COLUMN workspace_id BIGINT,
  ADD COLUMN entitlement_owner_id BIGINT;

UPDATE checkout_order_entitlements AS entitlement
SET workspace_id = checkout.workspace_id,
    entitlement_owner_id = checkout.entitlement_owner_id
FROM checkout_orders AS checkout
WHERE checkout.id = entitlement.order_id;

ALTER TABLE checkout_order_entitlements
  ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN entitlement_owner_id SET NOT NULL,
  ADD CONSTRAINT checkout_order_entitlements_owner_matches_user_check
    CHECK (user_id = entitlement_owner_id),
  ADD CONSTRAINT checkout_order_entitlements_order_scope_fkey
    FOREIGN KEY (order_id, workspace_id, entitlement_owner_id)
    REFERENCES checkout_orders(id, workspace_id, entitlement_owner_id)
    ON DELETE RESTRICT;

CREATE INDEX checkout_order_entitlements_workspace_owner_ends_idx
  ON checkout_order_entitlements (workspace_id, entitlement_owner_id, ends_at DESC)
  WHERE revoked_at IS NULL;

ALTER TABLE entitlement_grants
  ADD COLUMN workspace_id BIGINT,
  ADD COLUMN entitlement_owner_id BIGINT;

-- The preceding canonical-grant migration creates rows exclusively from active
-- admin pilots. Refuse ambiguous history instead of letting UPDATE ... FROM
-- choose an arbitrary workspace.
DO $$
BEGIN
  IF EXISTS (
    SELECT entitlement.id
    FROM entitlement_grants AS entitlement
    LEFT JOIN pilot_enrollments AS pilot
      ON pilot.user_id = entitlement.user_id
     AND pilot.status = 'active'
     AND pilot.activated_by = 'admin'
     AND pilot.starts_at = entitlement.starts_at
     AND pilot.ends_at IS NOT DISTINCT FROM entitlement.ends_at
    GROUP BY entitlement.id
    HAVING COUNT(DISTINCT pilot.workspace_id) <> 1
  ) THEN
    RAISE EXCEPTION 'canonical entitlement workspace backfill is missing or ambiguous'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

UPDATE entitlement_grants AS entitlement
SET workspace_id = (
      SELECT MIN(pilot.workspace_id)
      FROM pilot_enrollments AS pilot
      WHERE pilot.user_id = entitlement.user_id
        AND pilot.status = 'active'
        AND pilot.activated_by = 'admin'
        AND pilot.starts_at = entitlement.starts_at
        AND pilot.ends_at IS NOT DISTINCT FROM entitlement.ends_at
    ),
    entitlement_owner_id = entitlement.user_id;

ALTER TABLE entitlement_grants
  ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN entitlement_owner_id SET NOT NULL,
  ADD CONSTRAINT entitlement_grants_owner_workspace_member_fkey
    FOREIGN KEY (workspace_id, entitlement_owner_id)
    REFERENCES workspace_members(workspace_id, user_id)
    ON DELETE RESTRICT;

DROP INDEX entitlement_grants_effective_user_idx;
DROP INDEX entitlement_grants_audit_user_idx;
DROP INDEX entitlement_grants_active_user_source_uidx;

CREATE INDEX entitlement_grants_effective_workspace_owner_idx
  ON entitlement_grants (workspace_id, entitlement_owner_id, ends_at DESC)
  WHERE status = 'active';

CREATE INDEX entitlement_grants_audit_workspace_owner_idx
  ON entitlement_grants (workspace_id, entitlement_owner_id, created_at DESC);

CREATE UNIQUE INDEX entitlement_grants_active_workspace_owner_source_uidx
  ON entitlement_grants (workspace_id, entitlement_owner_id, source)
  WHERE status = 'active';

CREATE OR REPLACE FUNCTION reconcile_checkout_entitlements_after_full_refund()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_workspace_id BIGINT;
  target_owner_id BIGINT;
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
  RETURNING workspace_id, entitlement_owner_id
  INTO target_workspace_id, target_owner_id;

  IF target_workspace_id IS NULL OR target_owner_id IS NULL THEN
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
    WHERE entitlement.workspace_id = target_workspace_id
      AND entitlement.entitlement_owner_id = target_owner_id
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

  -- Legacy payment pilots remain compatibility/audit projections only. Keep
  -- their mutation tenant-scoped while canonical runtime reads order grants.
  IF cursor_at IS NULL OR cursor_at <= NOW() THEN
    UPDATE pilot_enrollments
    SET status = 'canceled',
        ends_at = GREATEST(starts_at + INTERVAL '1 second', LEAST(COALESCE(ends_at, NOW()), NOW())),
        updated_at = NOW(),
        activated_by = 'refund_reconciliation',
        notes = 'full_refund_checkout_order:' || NEW.id::TEXT
    WHERE user_id = target_owner_id
      AND workspace_id = target_workspace_id
      AND status = 'active'
      AND activated_by IN ('payment_webhook', 'refund_reconciliation');
  ELSE
    UPDATE pilot_enrollments
    SET starts_at = first_start_at,
        ends_at = cursor_at,
        updated_at = NOW(),
        activated_by = 'refund_reconciliation',
        notes = 'recalculated_after_refund:' || NEW.id::TEXT
    WHERE user_id = target_owner_id
      AND workspace_id = target_workspace_id
      AND status = 'active'
      AND activated_by IN ('payment_webhook', 'refund_reconciliation');
  END IF;

  RETURN NEW;
END;
$$;
