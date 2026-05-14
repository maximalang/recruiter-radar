BEGIN;

CREATE TYPE subscription_status AS ENUM (
  'trial',
  'active',
  'past_due',
  'canceled',
  'expired'
);

CREATE TYPE lead_state AS ENUM (
  'new',
  'saved',
  'contacted',
  'replied',
  'won',
  'badfit',
  'snooze',
  'dismissed'
);

CREATE TYPE signal_kind AS ENUM (
  'job_posting',
  'team_growth',
  'funding',
  'leadership_change',
  'other'
);

CREATE TYPE delivery_status AS ENUM (
  'queued',
  'sent',
  'failed'
);

CREATE TYPE digest_run_status AS ENUM (
  'running',
  'completed',
  'failed'
);

CREATE TYPE digest_feedback_status AS ENUM (
  'none',
  'contacted',
  'replied',
  'won',
  'badfit',
  'snooze',
  'dismissed'
);

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT,
  telegram_chat_id BIGINT,
  telegram_username TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_email_not_blank CHECK (BTRIM(email) <> ''),
  CONSTRAINT users_telegram_username_not_blank
    CHECK (telegram_username IS NULL OR BTRIM(telegram_username) <> '')
);

CREATE TABLE orgs (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT,
  website_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT orgs_name_not_blank CHECK (BTRIM(name) <> ''),
  CONSTRAINT orgs_domain_not_blank CHECK (domain IS NULL OR BTRIM(domain) <> ''),
  CONSTRAINT orgs_website_url_not_blank
    CHECK (website_url IS NULL OR BTRIM(website_url) <> '')
);

CREATE TABLE org_source_refs (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_key TEXT NOT NULL,
  external_id TEXT,
  display_name TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT org_source_refs_source_not_blank CHECK (BTRIM(source) <> ''),
  CONSTRAINT org_source_refs_source_key_not_blank CHECK (BTRIM(source_key) <> ''),
  CONSTRAINT org_source_refs_external_id_not_blank
    CHECK (external_id IS NULL OR BTRIM(external_id) <> ''),
  CONSTRAINT org_source_refs_display_name_not_blank
    CHECK (display_name IS NULL OR BTRIM(display_name) <> '')
);

CREATE TABLE subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL,
  status subscription_status NOT NULL DEFAULT 'trial',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  billing_provider TEXT,
  billing_customer_id TEXT,
  billing_subscription_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT subscriptions_plan_code_not_blank CHECK (BTRIM(plan_code) <> ''),
  CONSTRAINT subscriptions_period_window_check
    CHECK (current_period_end IS NULL OR current_period_end > started_at)
);

CREATE TABLE signals (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  signal_type signal_kind NOT NULL,
  source TEXT NOT NULL,
  external_id TEXT,
  headline TEXT NOT NULL,
  summary TEXT,
  source_url TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT signals_source_not_blank CHECK (BTRIM(source) <> ''),
  CONSTRAINT signals_headline_not_blank CHECK (BTRIM(headline) <> '')
);

CREATE TABLE hh_vacancies (
  id BIGSERIAL PRIMARY KEY,
  hh_vacancy_id TEXT NOT NULL UNIQUE,
  hh_employer_id TEXT,
  employer_name TEXT,
  vacancy_name TEXT NOT NULL,
  area_name TEXT,
  published_at TIMESTAMPTZ,
  alternate_url TEXT,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE leads (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  status lead_state NOT NULL DEFAULT 'new',
  score INTEGER,
  notes TEXT,
  last_signal_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT leads_user_org_unique UNIQUE (user_id, org_id),
  CONSTRAINT leads_id_user_unique UNIQUE (id, user_id),
  CONSTRAINT leads_score_range CHECK (score IS NULL OR score BETWEEN 0 AND 100)
);

CREATE TABLE lead_status (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  from_status lead_state,
  to_status lead_state NOT NULL,
  changed_by TEXT NOT NULL DEFAULT 'system',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_status_changed_by_check
    CHECK (changed_by IN ('system', 'user')),
  CONSTRAINT lead_status_transition_check
    CHECK (from_status IS NULL OR from_status <> to_status)
);

CREATE TABLE deliveries (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  telegram_chat_id BIGINT NOT NULL,
  telegram_message_id BIGINT,
  status delivery_status NOT NULL DEFAULT 'queued',
  error_message TEXT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT deliveries_lead_user_fkey
    FOREIGN KEY (lead_id, user_id)
    REFERENCES leads(id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT deliveries_user_fkey
    FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE,
  CONSTRAINT deliveries_delivered_at_check
    CHECK ((status = 'sent' AND delivered_at IS NOT NULL) OR status <> 'sent'),
  CONSTRAINT deliveries_failed_error_check
    CHECK ((status = 'failed' AND error_message IS NOT NULL) OR status <> 'failed')
);

CREATE TABLE client_profiles (
  id BIGSERIAL PRIMARY KEY,
  agency_name TEXT NOT NULL,
  telegram_chat_id BIGINT,
  target_city TEXT,
  specialization TEXT,
  include_keywords JSONB,
  exclude_keywords JSONB,
  daily_digest_limit INTEGER NOT NULL DEFAULT 5,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_profiles_agency_name_not_blank CHECK (BTRIM(agency_name) <> ''),
  CONSTRAINT client_profiles_telegram_chat_id_unique UNIQUE (telegram_chat_id),
  CONSTRAINT client_profiles_daily_digest_limit_check CHECK (daily_digest_limit > 0)
);

CREATE TABLE pilot_applications (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  telegram TEXT NOT NULL,
  specialization TEXT,
  city TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pilot_applications_name_not_blank CHECK (BTRIM(name) <> ''),
  CONSTRAINT pilot_applications_telegram_not_blank CHECK (BTRIM(telegram) <> '')
);

CREATE TABLE digest_runs (
  id BIGSERIAL PRIMARY KEY,
  client_profile_id BIGINT NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL DEFAULT 'default',
  status digest_run_status NOT NULL DEFAULT 'running',
  requested_limit INTEGER NOT NULL,
  selected_count INTEGER NOT NULL DEFAULT 0,
  cooldown_days INTEGER NOT NULL DEFAULT 3,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT digest_runs_source_key_not_blank CHECK (BTRIM(source_key) <> ''),
  CONSTRAINT digest_runs_requested_limit_check CHECK (requested_limit > 0),
  CONSTRAINT digest_runs_selected_count_check CHECK (selected_count >= 0),
  CONSTRAINT digest_runs_cooldown_days_check CHECK (cooldown_days > 0),
  CONSTRAINT digest_runs_completed_at_check
    CHECK ((status = 'completed' AND completed_at IS NOT NULL) OR status <> 'completed')
);

CREATE TABLE digest_candidates (
  id BIGSERIAL PRIMARY KEY,
  digest_run_id BIGINT NOT NULL REFERENCES digest_runs(id) ON DELETE CASCADE,
  client_profile_id BIGINT NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  org_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  source_external_id TEXT,
  source_display_name TEXT NOT NULL,
  source_families JSONB NOT NULL DEFAULT '[]'::JSONB,
  vacancies_count INTEGER NOT NULL,
  distinct_vacancy_names_count INTEGER NOT NULL,
  latest_published_at TIMESTAMPTZ,
  total_score INTEGER NOT NULL,
  reasons JSONB NOT NULL,
  opener TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT digest_candidates_source_display_name_not_blank CHECK (BTRIM(source_display_name) <> ''),
  CONSTRAINT digest_candidates_vacancies_count_check CHECK (vacancies_count > 0),
  CONSTRAINT digest_candidates_distinct_vacancy_names_count_check CHECK (distinct_vacancy_names_count > 0),
  CONSTRAINT digest_candidates_total_score_check CHECK (total_score >= 0),
  CONSTRAINT digest_candidates_run_org_unique UNIQUE (digest_run_id, org_id)
);

CREATE TABLE client_digest_org_state (
  client_profile_id BIGINT NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  org_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  last_digest_run_id BIGINT REFERENCES digest_runs(id) ON DELETE SET NULL,
  last_digest_candidate_id BIGINT REFERENCES digest_candidates(id) ON DELETE SET NULL,
  last_digest_at TIMESTAMPTZ,
  cooldown_until TIMESTAMPTZ,
  suppressed_until TIMESTAMPTZ,
  feedback_status digest_feedback_status NOT NULL DEFAULT 'none',
  feedback_at TIMESTAMPTZ,
  feedback_note TEXT,
  last_source_external_id TEXT,
  last_source_display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_profile_id, org_id),
  CONSTRAINT client_digest_org_state_feedback_note_check
    CHECK (feedback_status = 'none' OR feedback_note IS NULL OR BTRIM(feedback_note) <> ''),
  CONSTRAINT client_digest_org_state_last_source_display_name_not_blank
    CHECK (last_source_display_name IS NULL OR BTRIM(last_source_display_name) <> '')
);

CREATE UNIQUE INDEX users_email_uidx ON users (LOWER(email));
CREATE UNIQUE INDEX users_telegram_chat_id_uidx
  ON users (telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;

CREATE INDEX orgs_name_idx ON orgs (LOWER(name));
CREATE UNIQUE INDEX orgs_domain_uidx
  ON orgs (LOWER(domain))
  WHERE domain IS NOT NULL;

CREATE UNIQUE INDEX org_source_refs_source_key_uidx
  ON org_source_refs (source, source_key);
CREATE UNIQUE INDEX org_source_refs_source_external_id_uidx
  ON org_source_refs (source, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX org_source_refs_org_source_idx
  ON org_source_refs (org_id, source);

CREATE INDEX subscriptions_user_status_idx
  ON subscriptions (user_id, status);
CREATE INDEX subscriptions_period_end_idx
  ON subscriptions (current_period_end);
CREATE UNIQUE INDEX subscriptions_active_user_uidx
  ON subscriptions (user_id)
  WHERE status IN ('trial', 'active', 'past_due');

CREATE INDEX signals_org_occurred_at_idx
  ON signals (org_id, occurred_at DESC);
CREATE INDEX signals_type_occurred_at_idx
  ON signals (signal_type, occurred_at DESC);
CREATE UNIQUE INDEX signals_source_external_id_uidx
  ON signals (source, external_id);

CREATE INDEX hh_vacancies_hh_employer_id_idx
  ON hh_vacancies (hh_employer_id);
CREATE INDEX hh_vacancies_published_at_idx
  ON hh_vacancies (published_at DESC);

CREATE INDEX leads_user_status_idx
  ON leads (user_id, status);
CREATE INDEX leads_org_status_idx
  ON leads (org_id, status);
CREATE INDEX leads_last_signal_at_idx
  ON leads (last_signal_at DESC);

CREATE INDEX lead_status_lead_created_at_idx
  ON lead_status (lead_id, created_at DESC);

CREATE INDEX deliveries_user_status_created_at_idx
  ON deliveries (user_id, status, created_at DESC);
CREATE INDEX deliveries_lead_status_idx
  ON deliveries (lead_id, status);

CREATE INDEX client_profiles_active_updated_at_idx
  ON client_profiles (is_active, updated_at DESC);
CREATE UNIQUE INDEX client_profiles_agency_name_scope_uidx
  ON client_profiles (
    LOWER(agency_name),
    LOWER(COALESCE(target_city, '')),
    LOWER(COALESCE(specialization, ''))
  );
CREATE INDEX pilot_applications_created_at_idx
  ON pilot_applications (created_at DESC);

CREATE INDEX digest_runs_client_profile_created_at_idx
  ON digest_runs (client_profile_id, created_at DESC);
CREATE INDEX digest_runs_status_created_at_idx
  ON digest_runs (status, created_at DESC);

CREATE INDEX digest_candidates_client_profile_created_at_idx
  ON digest_candidates (client_profile_id, created_at DESC);
CREATE INDEX digest_candidates_org_created_at_idx
  ON digest_candidates (org_id, created_at DESC);

CREATE INDEX client_digest_org_state_feedback_status_idx
  ON client_digest_org_state (client_profile_id, feedback_status);
CREATE INDEX client_digest_org_state_cooldown_idx
  ON client_digest_org_state (client_profile_id, cooldown_until);
CREATE INDEX client_digest_org_state_suppressed_idx
  ON client_digest_org_state (client_profile_id, suppressed_until);

CREATE TYPE pilot_status AS ENUM (
  'requested',
  'active',
  'expired',
  'converted',
  'canceled'
);

CREATE TABLE webhook_events (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  error_message TEXT,
  processed_at TIMESTAMPTZ,
  processing_claimed_at TIMESTAMPTZ,
  processing_claim_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT webhook_events_provider_not_blank CHECK (BTRIM(provider) <> ''),
  CONSTRAINT webhook_events_event_type_not_blank CHECK (BTRIM(event_type) <> ''),
  CONSTRAINT webhook_events_external_event_id_not_blank CHECK (BTRIM(external_event_id) <> ''),
  CONSTRAINT webhook_events_idempotency_key_not_blank CHECK (BTRIM(idempotency_key) <> '')
);
CREATE UNIQUE INDEX webhook_events_provider_idempotency_uidx
  ON webhook_events (provider, idempotency_key);
CREATE INDEX webhook_events_provider_event_type_idx
  ON webhook_events (provider, event_type, created_at DESC);

CREATE TABLE digest_delivery_attempts (
  id BIGSERIAL PRIMARY KEY,
  digest_candidate_id BIGINT NOT NULL REFERENCES digest_candidates(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'telegram',
  status TEXT NOT NULL,
  error_message TEXT,
  processing_claimed_at TIMESTAMPTZ,
  processing_claim_token TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT digest_delivery_attempts_idempotency_key_not_blank CHECK (BTRIM(idempotency_key) <> ''),
  CONSTRAINT digest_delivery_attempts_channel_not_blank CHECK (BTRIM(channel) <> '')
);
CREATE UNIQUE INDEX digest_delivery_attempts_candidate_idempotency_uidx
  ON digest_delivery_attempts (digest_candidate_id, idempotency_key);

CREATE TABLE billing_webhook_events (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  error_message TEXT,
  processed_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  claim_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_webhook_provider_not_blank CHECK (BTRIM(provider) <> ''),
  CONSTRAINT billing_webhook_external_event_id_not_blank CHECK (BTRIM(external_event_id) <> ''),
  CONSTRAINT billing_webhook_idempotency_key_not_blank CHECK (BTRIM(idempotency_key) <> '')
);
CREATE UNIQUE INDEX billing_webhook_provider_idempotency_uidx
  ON billing_webhook_events (provider, idempotency_key);

CREATE TABLE checkout_orders (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL,
  amount_rub INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RUB',
  status TEXT NOT NULL DEFAULT 'created',
  customer_name TEXT,
  customer_contact TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  provider TEXT,
  provider_payment_id TEXT,
  paid_at TIMESTAMPTZ,
  external_order_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT checkout_orders_plan_code_not_blank CHECK (BTRIM(plan_code) <> ''),
  CONSTRAINT checkout_orders_amount_positive CHECK (amount_rub > 0),
  CONSTRAINT checkout_orders_currency_not_blank CHECK (BTRIM(currency) <> '')
);

CREATE TABLE pilot_enrollments (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status pilot_status NOT NULL DEFAULT 'requested',
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  activated_by TEXT NOT NULL DEFAULT 'system',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pilot_enrollments_activated_by_not_blank CHECK (BTRIM(activated_by) <> ''),
  CONSTRAINT pilot_enrollments_window_check CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE UNIQUE INDEX pilot_enrollments_active_user_uidx
  ON pilot_enrollments (user_id)
  WHERE status = 'active';

CREATE TABLE telegram_connect_tokens (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  order_id BIGINT NOT NULL REFERENCES checkout_orders(id) ON DELETE CASCADE,
  client_profile_id BIGINT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT telegram_connect_tokens_token_not_blank CHECK (BTRIM(token) <> '')
);
CREATE INDEX telegram_connect_tokens_order_created_idx
  ON telegram_connect_tokens (order_id, created_at DESC);

CREATE INDEX subscriptions_billing_provider_customer_idx
  ON subscriptions (billing_provider, billing_customer_id)
  WHERE billing_provider IS NOT NULL AND billing_customer_id IS NOT NULL;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER orgs_set_updated_at
BEFORE UPDATE ON orgs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER org_source_refs_set_updated_at
BEFORE UPDATE ON org_source_refs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER subscriptions_set_updated_at
BEFORE UPDATE ON subscriptions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER signals_set_updated_at
BEFORE UPDATE ON signals
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER hh_vacancies_set_updated_at
BEFORE UPDATE ON hh_vacancies
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER leads_set_updated_at
BEFORE UPDATE ON leads
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER deliveries_set_updated_at
BEFORE UPDATE ON deliveries
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER client_profiles_set_updated_at
BEFORE UPDATE ON client_profiles
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER client_digest_org_state_set_updated_at
BEFORE UPDATE ON client_digest_org_state
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER checkout_orders_set_updated_at
BEFORE UPDATE ON checkout_orders
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER pilot_enrollments_set_updated_at
BEFORE UPDATE ON pilot_enrollments
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;
