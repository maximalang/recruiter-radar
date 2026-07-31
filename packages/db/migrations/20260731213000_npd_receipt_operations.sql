BEGIN;

CREATE TABLE npd_receipts (
  id BIGSERIAL PRIMARY KEY,
  checkout_order_id BIGINT NOT NULL UNIQUE REFERENCES checkout_orders(id) ON DELETE RESTRICT,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending_issue',
  amount_rub INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RUB',
  customer_email TEXT,
  service_name TEXT NOT NULL,
  payment_received_at TIMESTAMPTZ NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  receipt_url TEXT,
  receipt_number TEXT,
  issued_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  delivered_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT npd_receipts_status_check CHECK (
    status IN ('pending_issue', 'issued', 'cancellation_required', 'canceled', 'not_required')
  ),
  CONSTRAINT npd_receipts_delivery_status_check CHECK (
    delivery_status IN ('pending', 'sent', 'failed', 'not_required')
  ),
  CONSTRAINT npd_receipts_amount_positive CHECK (amount_rub > 0),
  CONSTRAINT npd_receipts_currency_not_blank CHECK (BTRIM(currency) <> ''),
  CONSTRAINT npd_receipts_service_name_not_blank CHECK (BTRIM(service_name) <> ''),
  CONSTRAINT npd_receipts_receipt_url_https CHECK (
    receipt_url IS NULL OR receipt_url ~ '^https://'
  ),
  CONSTRAINT npd_receipts_issue_fields_check CHECK (
    status NOT IN ('issued', 'cancellation_required', 'canceled')
    OR (receipt_url IS NOT NULL AND issued_at IS NOT NULL)
  ),
  CONSTRAINT npd_receipts_cancel_fields_check CHECK (
    status <> 'canceled'
    OR (canceled_at IS NOT NULL AND cancellation_reason IS NOT NULL)
  )
);

CREATE INDEX npd_receipts_status_due_idx
  ON npd_receipts (status, due_at, id);
CREATE INDEX npd_receipts_user_created_idx
  ON npd_receipts (user_id, created_at DESC);

CREATE TRIGGER npd_receipts_set_updated_at
BEFORE UPDATE ON npd_receipts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION sync_npd_receipt_from_checkout_order()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  resolved_service_name TEXT;
  resolved_paid_at TIMESTAMPTZ;
BEGIN
  IF NEW.provider IS DISTINCT FROM 'yookassa' THEN
    RETURN NEW;
  END IF;

  resolved_service_name := COALESCE(
    NULLIF(BTRIM(NEW.payload->>'planName'), ''),
    'Доступ к Recruiter Radar'
  );
  resolved_paid_at := COALESCE(NEW.paid_at, NOW());

  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    INSERT INTO npd_receipts (
      checkout_order_id,
      user_id,
      status,
      amount_rub,
      currency,
      customer_email,
      service_name,
      payment_received_at,
      due_at,
      delivery_status
    )
    VALUES (
      NEW.id,
      NEW.user_id,
      'pending_issue',
      NEW.amount_rub,
      UPPER(NEW.currency),
      NULLIF(BTRIM(NEW.customer_contact), ''),
      resolved_service_name,
      resolved_paid_at,
      resolved_paid_at,
      'pending'
    )
    ON CONFLICT (checkout_order_id) DO UPDATE SET
      amount_rub = EXCLUDED.amount_rub,
      currency = EXCLUDED.currency,
      customer_email = EXCLUDED.customer_email,
      service_name = EXCLUDED.service_name,
      payment_received_at = EXCLUDED.payment_received_at,
      due_at = EXCLUDED.due_at,
      last_error = NULL,
      status = CASE
        WHEN npd_receipts.status IN ('issued', 'cancellation_required', 'canceled')
          THEN npd_receipts.status
        ELSE 'pending_issue'
      END,
      delivery_status = CASE
        WHEN npd_receipts.status IN ('issued', 'cancellation_required', 'canceled')
          THEN npd_receipts.delivery_status
        ELSE 'pending'
      END;
  END IF;

  IF NEW.status = 'refunded' AND OLD.status IS DISTINCT FROM 'refunded' THEN
    UPDATE npd_receipts
    SET status = CASE
          WHEN status IN ('issued', 'cancellation_required') THEN 'cancellation_required'
          WHEN status = 'canceled' THEN 'canceled'
          ELSE 'not_required'
        END,
        cancellation_reason = 'Возврат средств',
        delivery_status = CASE
          WHEN status IN ('issued', 'cancellation_required', 'canceled') THEN delivery_status
          ELSE 'not_required'
        END,
        last_error = NULL
    WHERE checkout_order_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS checkout_orders_sync_npd_receipt ON checkout_orders;
CREATE TRIGGER checkout_orders_sync_npd_receipt
AFTER UPDATE OF status ON checkout_orders
FOR EACH ROW
EXECUTE FUNCTION sync_npd_receipt_from_checkout_order();

INSERT INTO npd_receipts (
  checkout_order_id,
  user_id,
  status,
  amount_rub,
  currency,
  customer_email,
  service_name,
  payment_received_at,
  due_at,
  delivery_status
)
SELECT
  o.id,
  o.user_id,
  'pending_issue',
  o.amount_rub,
  UPPER(o.currency),
  NULLIF(BTRIM(o.customer_contact), ''),
  COALESCE(NULLIF(BTRIM(o.payload->>'planName'), ''), 'Доступ к Recruiter Radar'),
  COALESCE(o.paid_at, o.updated_at, o.created_at),
  COALESCE(o.paid_at, o.updated_at, o.created_at),
  'pending'
FROM checkout_orders o
WHERE o.provider = 'yookassa'
  AND o.status = 'paid'
ON CONFLICT (checkout_order_id) DO NOTHING;

COMMIT;
