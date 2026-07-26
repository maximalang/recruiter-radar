BEGIN;

CREATE OR REPLACE FUNCTION telemetry_payment_succeeded_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM 'paid'
     AND NEW.status = 'paid'
  THEN
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
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING
        'Payment telemetry insert failed for checkout order %: %',
        NEW.id,
        SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
