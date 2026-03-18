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

CREATE TABLE subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL,
  status subscription_status NOT NULL DEFAULT 'trial',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
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

CREATE UNIQUE INDEX users_email_uidx ON users (LOWER(email));
CREATE UNIQUE INDEX users_telegram_chat_id_uidx
  ON users (telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;

CREATE INDEX orgs_name_idx ON orgs (LOWER(name));
CREATE UNIQUE INDEX orgs_domain_uidx
  ON orgs (LOWER(domain))
  WHERE domain IS NOT NULL;

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
  ON signals (source, external_id)
  WHERE external_id IS NOT NULL;

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

CREATE TRIGGER subscriptions_set_updated_at
BEFORE UPDATE ON subscriptions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER signals_set_updated_at
BEFORE UPDATE ON signals
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

COMMIT;
