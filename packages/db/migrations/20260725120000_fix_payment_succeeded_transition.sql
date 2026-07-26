BEGIN;

CREATE OR REPLACE FUNCTION telemetry_payment_succeeded_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO product_telemetry_events (
    event_name,
    event_key,
    owner_id,
    checkout_order_id,
    provider,
    outcome,
    metadata,
    occurred_at
  ) VALUES (
    'payment_succeeded',
    'payment-succeeded:' || NEW.id,
    NEW.user_id,
    NEW.id,
    NEW.provider,
    NEW.status,
    jsonb_build_object('planCode', NEW.plan_code, 'currency', NEW.currency),
    COALESCE(NEW.paid_at, NOW())
  )
  ON CONFLICT (event_key) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_telemetry_payment_succeeded ON checkout_orders;

CREATE TRIGGER product_telemetry_payment_succeeded
AFTER UPDATE OF status ON checkout_orders
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM 'paid' AND NEW.status = 'paid')
EXECUTE FUNCTION telemetry_payment_succeeded_transition();

COMMIT;
