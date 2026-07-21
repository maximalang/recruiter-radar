BEGIN;

CREATE TABLE product_telemetry_events (
  id BIGSERIAL PRIMARY KEY,
  event_name TEXT NOT NULL CHECK (event_name IN (
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
  )),
  event_key TEXT UNIQUE,
  owner_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  client_profile_id BIGINT REFERENCES client_profiles(id) ON DELETE SET NULL,
  checkout_order_id BIGINT REFERENCES checkout_orders(id) ON DELETE SET NULL,
  provider TEXT,
  outcome TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_telemetry_event_key_not_blank
    CHECK (event_key IS NULL OR BTRIM(event_key) <> ''),
  CONSTRAINT product_telemetry_provider_not_blank
    CHECK (provider IS NULL OR BTRIM(provider) <> ''),
  CONSTRAINT product_telemetry_outcome_not_blank
    CHECK (outcome IS NULL OR BTRIM(outcome) <> ''),
  CONSTRAINT product_telemetry_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT product_telemetry_metadata_size
    CHECK (pg_column_size(metadata) <= 4096)
);

CREATE INDEX product_telemetry_event_time_idx
  ON product_telemetry_events (event_name, occurred_at DESC);
CREATE INDEX product_telemetry_profile_time_idx
  ON product_telemetry_events (client_profile_id, occurred_at DESC)
  WHERE client_profile_id IS NOT NULL;
CREATE INDEX product_telemetry_provider_time_idx
  ON product_telemetry_events (provider, occurred_at DESC)
  WHERE provider IS NOT NULL;

CREATE OR REPLACE FUNCTION product_telemetry_metadata_is_safe(value JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  item RECORD;
  element JSONB;
BEGIN
  IF value IS NULL THEN
    RETURN TRUE;
  END IF;

  IF jsonb_typeof(value) = 'object' THEN
    FOR item IN SELECT key, val FROM jsonb_each(value) AS e(key, val)
    LOOP
      IF item.key ~* '(token|secret|password|authorization|cookie|email|phone|contact|payload|evidence|body)' THEN
        RETURN FALSE;
      END IF;
      IF NOT product_telemetry_metadata_is_safe(item.val) THEN
        RETURN FALSE;
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(value) = 'array' THEN
    FOR element IN SELECT val FROM jsonb_array_elements(value) AS e(val)
    LOOP
      IF NOT product_telemetry_metadata_is_safe(element) THEN
        RETURN FALSE;
      END IF;
    END LOOP;
  END IF;

  RETURN TRUE;
END;
$$;

ALTER TABLE product_telemetry_events
  ADD CONSTRAINT product_telemetry_metadata_privacy
  CHECK (product_telemetry_metadata_is_safe(metadata));

CREATE OR REPLACE FUNCTION telemetry_checkout_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  profile_id BIGINT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO product_telemetry_events (
      event_name, event_key, owner_id, checkout_order_id, provider, outcome, metadata, occurred_at
    ) VALUES (
      'checkout_started',
      'checkout_started:' || NEW.id,
      NEW.user_id,
      NEW.id,
      NEW.provider,
      NEW.status,
      jsonb_build_object('planCode', NEW.plan_code, 'currency', NEW.currency),
      NEW.created_at
    ) ON CONFLICT (event_key) DO NOTHING;
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'paid' THEN
    INSERT INTO product_telemetry_events (
      event_name, event_key, owner_id, checkout_order_id, provider, outcome, metadata, occurred_at
    ) VALUES (
      'order_paid',
      'order_paid:' || NEW.id,
      NEW.user_id,
      NEW.id,
      NEW.provider,
      NEW.status,
      jsonb_build_object('planCode', NEW.plan_code, 'currency', NEW.currency),
      COALESCE(NEW.paid_at, NOW())
    ) ON CONFLICT (event_key) DO NOTHING;
  END IF;

  IF COALESCE(OLD.payload->>'onboardingStatus', '') <> 'completed'
     AND NEW.payload->>'onboardingStatus' = 'completed' THEN
    IF COALESCE(NEW.payload->>'clientProfileId', '') ~ '^[0-9]+$' THEN
      profile_id := (NEW.payload->>'clientProfileId')::BIGINT;
    END IF;

    INSERT INTO product_telemetry_events (
      event_name, event_key, owner_id, client_profile_id, checkout_order_id,
      provider, outcome, metadata, occurred_at
    ) VALUES (
      'profile_completed',
      'profile_completed:' || NEW.id,
      NEW.user_id,
      profile_id,
      NEW.id,
      NEW.provider,
      'completed',
      jsonb_build_object('planCode', NEW.plan_code),
      COALESCE(NULLIF(NEW.payload->>'onboardingCompletedAt', '')::TIMESTAMPTZ, NOW())
    ) ON CONFLICT (event_key) DO NOTHING;
  END IF;

  IF COALESCE(OLD.payload->>'onboardingTestDigestSentAt', '') = ''
     AND COALESCE(NEW.payload->>'onboardingTestDigestSentAt', '') <> '' THEN
    IF COALESCE(NEW.payload->>'clientProfileId', '') ~ '^[0-9]+$' THEN
      profile_id := (NEW.payload->>'clientProfileId')::BIGINT;
    END IF;

    INSERT INTO product_telemetry_events (
      event_name, event_key, owner_id, client_profile_id, checkout_order_id,
      provider, outcome, metadata, occurred_at
    ) VALUES (
      'test_notification_succeeded',
      'legacy_test_digest:' || NEW.id,
      NEW.user_id,
      profile_id,
      NEW.id,
      'telegram',
      'sent',
      jsonb_build_object('flow', 'pilot_onboarding'),
      (NEW.payload->>'onboardingTestDigestSentAt')::TIMESTAMPTZ
    ) ON CONFLICT (event_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER product_telemetry_checkout_insert
AFTER INSERT ON checkout_orders
FOR EACH ROW EXECUTE FUNCTION telemetry_checkout_transition();

CREATE TRIGGER product_telemetry_checkout_update
AFTER UPDATE ON checkout_orders
FOR EACH ROW EXECUTE FUNCTION telemetry_checkout_transition();

CREATE OR REPLACE FUNCTION telemetry_profile_created()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO product_telemetry_events (
    event_name, event_key, owner_id, client_profile_id, outcome, metadata, occurred_at
  ) VALUES (
    'profile_created',
    'profile_created:' || NEW.id,
    NEW.owner_id,
    NEW.id,
    CASE WHEN NEW.is_active THEN 'active' ELSE 'inactive' END,
    jsonb_build_object('dailyDigestLimit', NEW.daily_digest_limit),
    NEW.created_at
  ) ON CONFLICT (event_key) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER product_telemetry_profile_created
AFTER INSERT ON client_profiles
FOR EACH ROW EXECUTE FUNCTION telemetry_profile_created();

CREATE OR REPLACE FUNCTION telemetry_notification_endpoint_active()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  account_owner_id BIGINT;
  account_provider TEXT;
BEGIN
  IF NEW.status = 'active'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT owner_id, provider
      INTO account_owner_id, account_provider
    FROM notification_provider_accounts
    WHERE id = NEW.provider_account_id;

    INSERT INTO product_telemetry_events (
      event_name, event_key, owner_id, client_profile_id, provider, outcome, metadata, occurred_at
    ) VALUES (
      'notification_channel_connected',
      'notification_endpoint_active:' || NEW.id,
      account_owner_id,
      NEW.client_profile_id,
      account_provider,
      'active',
      jsonb_build_object('endpointType', NEW.endpoint_type),
      NOW()
    ) ON CONFLICT (event_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER product_telemetry_notification_endpoint_insert
AFTER INSERT ON notification_endpoints
FOR EACH ROW EXECUTE FUNCTION telemetry_notification_endpoint_active();

CREATE TRIGGER product_telemetry_notification_endpoint_update
AFTER UPDATE OF status ON notification_endpoints
FOR EACH ROW EXECUTE FUNCTION telemetry_notification_endpoint_active();

CREATE OR REPLACE FUNCTION telemetry_digest_run_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  owner BIGINT;
BEGIN
  SELECT owner_id INTO owner FROM client_profiles WHERE id = NEW.client_profile_id;

  IF NEW.status::TEXT = 'completed'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO product_telemetry_events (
      event_name, event_key, owner_id, client_profile_id, outcome, duration_ms, metadata, occurred_at
    ) VALUES (
      'digest_generated',
      'digest_generated:' || NEW.id,
      owner,
      NEW.client_profile_id,
      'completed',
      GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (COALESCE(NEW.completed_at, NOW()) - NEW.created_at)) * 1000)::INTEGER),
      jsonb_build_object('selectedCount', NEW.selected_count, 'requestedLimit', NEW.requested_limit, 'sourceKey', NEW.source_key),
      COALESCE(NEW.completed_at, NOW())
    ) ON CONFLICT (event_key) DO NOTHING;

    INSERT INTO product_telemetry_events (
      event_name, event_key, owner_id, client_profile_id, outcome, duration_ms, metadata, occurred_at
    ) VALUES (
      'digest_run_succeeded',
      'digest_run_succeeded:' || NEW.id,
      owner,
      NEW.client_profile_id,
      'completed',
      GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (COALESCE(NEW.completed_at, NOW()) - NEW.created_at)) * 1000)::INTEGER),
      jsonb_build_object('selectedCount', NEW.selected_count, 'sourceKey', NEW.source_key),
      COALESCE(NEW.completed_at, NOW())
    ) ON CONFLICT (event_key) DO NOTHING;
  ELSIF NEW.status::TEXT = 'failed'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO product_telemetry_events (
      event_name, event_key, owner_id, client_profile_id, outcome, duration_ms, metadata, occurred_at
    ) VALUES (
      'digest_run_failed',
      'digest_run_failed:' || NEW.id,
      owner,
      NEW.client_profile_id,
      'failed',
      GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - NEW.created_at)) * 1000)::INTEGER),
      jsonb_build_object('sourceKey', NEW.source_key),
      NOW()
    ) ON CONFLICT (event_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER product_telemetry_digest_run_insert
AFTER INSERT ON digest_runs
FOR EACH ROW EXECUTE FUNCTION telemetry_digest_run_transition();

CREATE TRIGGER product_telemetry_digest_run_update
AFTER UPDATE OF status ON digest_runs
FOR EACH ROW EXECUTE FUNCTION telemetry_digest_run_transition();

CREATE OR REPLACE FUNCTION telemetry_notification_attempt()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  profile_id BIGINT;
  owner BIGINT;
  provider_code TEXT;
  job_event_kind TEXT;
  normalized_event TEXT;
BEGIN
  SELECT j.client_profile_id, a.owner_id, a.provider, j.event_kind
    INTO profile_id, owner, provider_code, job_event_kind
  FROM notification_delivery_jobs j
  JOIN notification_provider_accounts a ON a.id = j.provider_account_id
  WHERE j.id = NEW.job_id;

  normalized_event := CASE WHEN NEW.status = 'sent' THEN 'delivery_succeeded' ELSE 'delivery_failed' END;

  INSERT INTO product_telemetry_events (
    event_name, event_key, owner_id, client_profile_id, provider, outcome, duration_ms, metadata, occurred_at
  ) VALUES (
    normalized_event,
    'notification_attempt:' || NEW.id || ':' || NEW.status,
    owner,
    profile_id,
    provider_code,
    NEW.status,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NEW.finished_at - NEW.started_at)) * 1000)::INTEGER),
    jsonb_build_object('eventKind', job_event_kind, 'httpStatus', NEW.http_status, 'errorCode', NEW.provider_error_code),
    NEW.finished_at
  ) ON CONFLICT (event_key) DO NOTHING;

  IF NEW.status = 'sent' THEN
    INSERT INTO product_telemetry_events (
      event_name, event_key, owner_id, client_profile_id, provider, outcome, duration_ms, metadata, occurred_at
    ) VALUES (
      CASE WHEN job_event_kind = 'test_message' THEN 'test_notification_succeeded' ELSE 'digest_delivered' END,
      'notification_delivered:' || NEW.id,
      owner,
      profile_id,
      provider_code,
      'sent',
      GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NEW.finished_at - NEW.started_at)) * 1000)::INTEGER),
      jsonb_build_object('eventKind', job_event_kind),
      NEW.finished_at
    ) ON CONFLICT (event_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER product_telemetry_notification_attempt
AFTER INSERT ON notification_delivery_attempts
FOR EACH ROW EXECUTE FUNCTION telemetry_notification_attempt();

CREATE OR REPLACE FUNCTION telemetry_legacy_delivery_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  profile_id BIGINT;
  owner BIGINT;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status OR NEW.status NOT IN ('sent', 'failed') THEN
    RETURN NEW;
  END IF;

  SELECT dc.client_profile_id, cp.owner_id
    INTO profile_id, owner
  FROM digest_candidates dc
  JOIN client_profiles cp ON cp.id = dc.client_profile_id
  WHERE dc.id = NEW.digest_candidate_id;

  INSERT INTO product_telemetry_events (
    event_name, event_key, owner_id, client_profile_id, provider, outcome, metadata, occurred_at
  ) VALUES (
    CASE WHEN NEW.status = 'sent' THEN 'delivery_succeeded' ELSE 'delivery_failed' END,
    'legacy_delivery:' || NEW.id || ':' || NEW.status,
    owner,
    profile_id,
    NEW.channel,
    NEW.status,
    jsonb_build_object('deliveryPath', 'legacy'),
    NOW()
  ) ON CONFLICT (event_key) DO NOTHING;

  IF NEW.status = 'sent' THEN
    INSERT INTO product_telemetry_events (
      event_name, event_key, owner_id, client_profile_id, provider, outcome, metadata, occurred_at
    ) VALUES (
      'digest_delivered',
      'legacy_digest_delivered:' || NEW.id,
      owner,
      profile_id,
      NEW.channel,
      'sent',
      jsonb_build_object('deliveryPath', 'legacy'),
      NOW()
    ) ON CONFLICT (event_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER product_telemetry_legacy_delivery_update
AFTER UPDATE OF status ON digest_delivery_attempts
FOR EACH ROW EXECUTE FUNCTION telemetry_legacy_delivery_transition();

CREATE OR REPLACE FUNCTION telemetry_feedback_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  owner BIGINT;
BEGIN
  IF NEW.feedback_status::TEXT = 'none'
     OR (TG_OP = 'UPDATE' AND OLD.feedback_status IS NOT DISTINCT FROM NEW.feedback_status) THEN
    RETURN NEW;
  END IF;

  SELECT owner_id INTO owner FROM client_profiles WHERE id = NEW.client_profile_id;

  INSERT INTO product_telemetry_events (
    event_name, event_key, owner_id, client_profile_id, outcome, metadata, occurred_at
  ) VALUES (
    'feedback_recorded',
    'feedback:' || NEW.client_profile_id || ':' || NEW.org_id || ':' || EXTRACT(EPOCH FROM COALESCE(NEW.feedback_at, NOW()))::BIGINT,
    owner,
    NEW.client_profile_id,
    NEW.feedback_status::TEXT,
    jsonb_build_object('hasCandidate', NEW.last_digest_candidate_id IS NOT NULL),
    COALESCE(NEW.feedback_at, NOW())
  ) ON CONFLICT (event_key) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER product_telemetry_feedback_insert
AFTER INSERT ON client_digest_org_state
FOR EACH ROW EXECUTE FUNCTION telemetry_feedback_transition();

CREATE TRIGGER product_telemetry_feedback_update
AFTER UPDATE OF feedback_status ON client_digest_org_state
FOR EACH ROW EXECUTE FUNCTION telemetry_feedback_transition();

COMMENT ON TABLE product_telemetry_events IS
  'Privacy-safe append-only product and reliability event ledger. Never store raw payloads, contacts, evidence, tokens or provider secrets.';

COMMIT;
