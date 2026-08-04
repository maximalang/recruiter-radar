BEGIN;

CREATE OR REPLACE FUNCTION enforce_checkout_order_payment_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  provider_amount_text TEXT;
  provider_currency TEXT;
  provider_amount_minor BIGINT;
  order_amount_minor BIGINT;
  signature_verified BOOLEAN;
  verification_source TEXT;
BEGIN
  IF OLD.status = 'refunded' AND NEW.status <> 'refunded' THEN
    RAISE EXCEPTION 'refunded checkout order % is terminal', OLD.id;
  END IF;

  IF OLD.status = 'paid' AND NEW.status NOT IN ('paid', 'refunded') THEN
    RAISE EXCEPTION 'paid checkout order % cannot be downgraded to %', OLD.id, NEW.status;
  END IF;

  IF NEW.provider = 'robokassa' AND NEW.status IN ('paid', 'refunded') THEN
    provider_amount_text := NEW.payload->'paymentProviderPayload'->'amount'->>'value';
    provider_currency := upper(COALESCE(NEW.payload->'paymentProviderPayload'->'amount'->>'currency', ''));
    signature_verified := COALESCE((NEW.payload->'paymentProviderPayload'->>'signatureVerified')::boolean, false);
    verification_source := COALESCE(NEW.payload->'paymentProviderPayload'->>'verifiedBy', '');

    IF provider_amount_text IS NULL OR provider_amount_text !~ '^\d+(\.\d{1,6})?$' THEN
      RAISE EXCEPTION 'verified Robokassa amount is absent for checkout order %', NEW.id;
    END IF;

    provider_amount_minor := round(provider_amount_text::numeric * 100)::bigint;
    order_amount_minor := NEW.amount_rub::bigint * 100;

    IF provider_amount_minor <> order_amount_minor THEN
      RAISE EXCEPTION 'Robokassa amount mismatch for checkout order %: % <> %', NEW.id, provider_amount_minor, order_amount_minor;
    END IF;

    IF provider_currency <> upper(NEW.currency) OR provider_currency <> 'RUB' THEN
      RAISE EXCEPTION 'Robokassa currency mismatch for checkout order %: % <> %', NEW.id, provider_currency, upper(NEW.currency);
    END IF;

    IF NOT signature_verified AND verification_source <> 'OpStateExt' THEN
      RAISE EXCEPTION 'Robokassa payment verification evidence is absent for checkout order %', NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS checkout_orders_enforce_payment_transition ON checkout_orders;
CREATE TRIGGER checkout_orders_enforce_payment_transition
BEFORE UPDATE OF status ON checkout_orders
FOR EACH ROW
EXECUTE FUNCTION enforce_checkout_order_payment_transition();

-- ResultURL may be retried by Robokassa. Replay protection belongs to
-- billing_webhook_events, where the provider event is claimed idempotently;
-- checkout_orders must remain reconcilable when the same external operation is
-- delivered again.

COMMIT;
