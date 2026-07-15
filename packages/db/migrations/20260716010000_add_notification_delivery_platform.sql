CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS notification_provider_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_profile_id BIGINT NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('telegram', 'vk', 'webhook')),
  auth_mode TEXT NOT NULL CHECK (auth_mode IN ('byob', 'community_token', 'hmac')),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN ('pending_verification', 'active', 'degraded', 'paused', 'error', 'revoked')),
  external_account_id TEXT,
  external_account_name TEXT,
  secret_ciphertext TEXT NOT NULL,
  secret_version INTEGER NOT NULL DEFAULT 1,
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_verified_at TIMESTAMPTZ,
  last_healthcheck_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_provider_account_external
  ON notification_provider_accounts (owner_id, provider, external_account_id)
  WHERE external_account_id IS NOT NULL AND status <> 'revoked';

CREATE INDEX IF NOT EXISTS idx_notification_provider_accounts_profile
  ON notification_provider_accounts (client_profile_id, provider, status);

CREATE TABLE IF NOT EXISTS notification_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_account_id UUID NOT NULL REFERENCES notification_provider_accounts(id) ON DELETE CASCADE,
  client_profile_id BIGINT NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  endpoint_type TEXT NOT NULL CHECK (endpoint_type IN (
    'telegram_private_chat', 'telegram_group', 'telegram_channel',
    'vk_peer', 'generic_webhook'
  )),
  status TEXT NOT NULL DEFAULT 'pending_bind'
    CHECK (status IN ('pending_bind', 'active', 'muted', 'paused', 'unreachable', 'error', 'revoked')),
  destination_id TEXT,
  destination_label TEXT,
  bind_token_hash TEXT,
  bind_token_expires_at TIMESTAMPTZ,
  endpoint_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_inbound_at TIMESTAMPTZ,
  last_delivery_at TIMESTAMPTZ,
  last_error_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_endpoint_destination
  ON notification_endpoints (provider_account_id, endpoint_type, destination_id)
  WHERE destination_id IS NOT NULL AND status <> 'revoked';

CREATE INDEX IF NOT EXISTS idx_notification_endpoints_profile
  ON notification_endpoints (client_profile_id, status, endpoint_type);

CREATE TABLE IF NOT EXISTS notification_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id UUID NOT NULL REFERENCES notification_endpoints(id) ON DELETE CASCADE,
  client_profile_id BIGINT NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('daily_digest', 'weekly_digest', 'hot_lead', 'test_message', 'recovery')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'disabled')),
  min_score NUMERIC(6,2),
  confidence_policy TEXT NOT NULL DEFAULT 'A_OR_B' CHECK (confidence_policy IN ('A_ONLY', 'A_OR_B')),
  schedule_timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
  quiet_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  route_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  route_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (endpoint_id, event_kind)
);

CREATE INDEX IF NOT EXISTS idx_notification_routes_profile
  ON notification_routes (client_profile_id, event_kind, status);

CREATE TABLE IF NOT EXISTS notification_delivery_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_profile_id BIGINT NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  route_id UUID NOT NULL REFERENCES notification_routes(id) ON DELETE CASCADE,
  endpoint_id UUID NOT NULL REFERENCES notification_endpoints(id) ON DELETE CASCADE,
  provider_account_id UUID NOT NULL REFERENCES notification_provider_accounts(id) ON DELETE CASCADE,
  digest_run_id UUID,
  event_kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'dead_letter', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  not_before TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_jobs_queue
  ON notification_delivery_jobs (status, not_before, created_at);

CREATE TABLE IF NOT EXISTS notification_delivery_attempts (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES notification_delivery_jobs(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'retryable_error', 'permanent_error', 'rate_limited', 'auth_error')),
  provider_message_id TEXT,
  http_status INTEGER,
  provider_error_code TEXT,
  provider_error_message TEXT,
  response_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, attempt_no)
);

CREATE TABLE IF NOT EXISTS notification_inbound_events (
  id BIGSERIAL PRIMARY KEY,
  provider_account_id UUID NOT NULL REFERENCES notification_provider_accounts(id) ON DELETE CASCADE,
  endpoint_id UUID REFERENCES notification_endpoints(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  provider_event_id TEXT,
  event_type TEXT NOT NULL,
  event_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_inbound_event_hash
  ON notification_inbound_events (provider_account_id, event_hash);

CREATE TABLE IF NOT EXISTS notification_audit_log (
  id BIGSERIAL PRIMARY KEY,
  owner_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  client_profile_id BIGINT REFERENCES client_profiles(id) ON DELETE SET NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'system', 'provider')),
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE notification_provider_accounts IS 'Provider authentication identities. Secrets are stored only as AES-GCM ciphertext.';
COMMENT ON TABLE notification_endpoints IS 'Concrete destinations such as a Telegram chat, VK peer, or generic webhook URL.';
COMMENT ON TABLE notification_routes IS 'Event routing policy separated from provider authentication and destinations.';
COMMENT ON TABLE notification_delivery_jobs IS 'Durable idempotent delivery outbox used by notification dispatchers.';
