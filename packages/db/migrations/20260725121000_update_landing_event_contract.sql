BEGIN;

ALTER TABLE product_telemetry_events
  DROP CONSTRAINT IF EXISTS product_telemetry_events_event_name_check;

ALTER TABLE product_telemetry_events
  ADD CONSTRAINT product_telemetry_events_event_name_check
  CHECK (event_name IN (
    'landing_viewed',
    'preview_started',
    'preview_results_clicked',
    'preview_generated',
    'checkout_started',
    'checkout_viewed',
    'payment_started',
    'payment_succeeded',
    'continuation_cta_clicked',
    'continuation_requested',
    'faq_opened',
    'motion_paused',
    'motion_resumed',
    'delivery_channel_selected',
    'delivery_feedback_selected',
    'methodology_stage_selected',
    'preview_submitted',
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
    'delivery_failed',
    -- Historical landing events remain valid for already-recorded rows.
    'preview_checkout_clicked',
    'pilot_cta_clicked',
    'closing_cta_clicked'
  ));

COMMIT;
