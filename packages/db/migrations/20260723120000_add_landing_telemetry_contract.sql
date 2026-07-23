BEGIN;

ALTER TABLE product_telemetry_events
  DROP CONSTRAINT IF EXISTS product_telemetry_events_event_name_check;

ALTER TABLE product_telemetry_events
  ADD CONSTRAINT product_telemetry_events_event_name_check
  CHECK (event_name IN (
    'landing_viewed',
    'preview_started',
    'preview_generated',
    'preview_checkout_clicked',
    'checkout_viewed',
    'payment_started',
    'payment_succeeded',
    'pilot_cta_clicked',
    'closing_cta_clicked',
    'continuation_requested',
    'faq_opened',
    'motion_paused',
    'motion_resumed',
    'delivery_channel_selected',
    'delivery_feedback_selected',
    'methodology_stage_selected',
    'preview_submitted',
    'checkout_started',
    'order_paid',
    'sales_request_accepted',
    'profile_created',
    'profile_completed',
    'notification_channel_connected',
    'test_notification_succeeded',
    'digest_generated',
    'digest_delivered',
    'feedback_recorded',
    'source_fetch_succeeded',
    'source_fetch_failed',
    'source_ingest_succeeded',
    'source_ingest_failed',
    'source_pipeline_succeeded',
    'source_pipeline_failed',
    'digest_run_succeeded',
    'digest_run_failed',
    'delivery_succeeded',
    'delivery_failed'
  ));

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
WHEN (OLD.status = 'pending' AND NEW.status = 'paid')
EXECUTE FUNCTION telemetry_payment_succeeded_transition();

COMMIT;
