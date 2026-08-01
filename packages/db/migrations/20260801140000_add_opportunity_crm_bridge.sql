BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '1min';

CREATE TABLE opportunity_crm_integrations (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  public_reference UUID NOT NULL DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  display_name TEXT NOT NULL,
  outbound_webhook_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT opportunity_crm_integrations_id_workspace_unique
    UNIQUE (id, workspace_id),
  CONSTRAINT opportunity_crm_integrations_public_reference_unique
    UNIQUE (public_reference),
  CONSTRAINT opportunity_crm_integrations_provider_check
    CHECK (provider IN ('generic', 'n8n', 'amocrm', 'bitrix24')),
  CONSTRAINT opportunity_crm_integrations_display_name_check
    CHECK (
      BTRIM(display_name) = display_name
      AND display_name <> ''
      AND CHAR_LENGTH(display_name) <= 120
      AND display_name !~ '[[:cntrl:]]'
    ),
  CONSTRAINT opportunity_crm_integrations_url_check
    CHECK (
      outbound_webhook_url IS NULL OR (
        outbound_webhook_url ~ '^https://'
        AND CHAR_LENGTH(outbound_webhook_url) <= 2048
        AND outbound_webhook_url !~ '[[:space:][:cntrl:]]'
      )
    ),
  CONSTRAINT opportunity_crm_integrations_status_check
    CHECK (status IN ('active', 'disabled')),
  CONSTRAINT opportunity_crm_integrations_timestamp_check
    CHECK (updated_at >= created_at)
);

CREATE TABLE opportunity_crm_credentials (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL,
  integration_id BIGINT NOT NULL,
  public_reference UUID NOT NULL DEFAULT gen_random_uuid(),
  secret_hash CHAR(64) NOT NULL,
  secret_prefix CHAR(8) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  allowed_event_types TEXT[] NOT NULL,
  rate_limit_max_requests INTEGER NOT NULL DEFAULT 60,
  rate_limit_window_seconds INTEGER NOT NULL DEFAULT 60,
  replay_window_seconds INTEGER NOT NULL DEFAULT 300,
  created_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT opportunity_crm_credentials_id_workspace_unique
    UNIQUE (id, workspace_id),
  CONSTRAINT opportunity_crm_credentials_public_reference_unique
    UNIQUE (public_reference),
  CONSTRAINT opportunity_crm_credentials_integration_fkey
    FOREIGN KEY (integration_id, workspace_id)
    REFERENCES opportunity_crm_integrations(id, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT opportunity_crm_credentials_secret_hash_check
    CHECK (secret_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT opportunity_crm_credentials_secret_prefix_check
    CHECK (secret_prefix ~ '^[A-Za-z0-9_-]{8}$'),
  CONSTRAINT opportunity_crm_credentials_status_check
    CHECK (status IN ('active', 'rotated', 'revoked')),
  CONSTRAINT opportunity_crm_credentials_events_check
    CHECK (
      CARDINALITY(allowed_event_types) > 0
      AND allowed_event_types <@ ARRAY[
        'accepted', 'dismissed', 'snoozed', 'resumed', 'contacted',
        'replied', 'meeting', 'meeting_completed', 'meeting_cancelled',
        'meeting_no_show', 'proposal', 'won', 'lost'
      ]::TEXT[]
    ),
  CONSTRAINT opportunity_crm_credentials_rate_check
    CHECK (
      rate_limit_max_requests BETWEEN 1 AND 1000
      AND rate_limit_window_seconds BETWEEN 1 AND 3600
    ),
  CONSTRAINT opportunity_crm_credentials_replay_check
    CHECK (replay_window_seconds BETWEEN 30 AND 900),
  CONSTRAINT opportunity_crm_credentials_lifecycle_check
    CHECK (
      (status = 'active' AND rotated_at IS NULL AND revoked_at IS NULL)
      OR (status = 'rotated' AND rotated_at IS NOT NULL AND revoked_at IS NULL)
      OR (status = 'revoked' AND revoked_at IS NOT NULL)
    ),
  CONSTRAINT opportunity_crm_credentials_timestamp_check
    CHECK (
      (rotated_at IS NULL OR rotated_at >= created_at)
      AND (revoked_at IS NULL OR revoked_at >= created_at)
    )
);

CREATE UNIQUE INDEX opportunity_crm_credentials_one_active_uidx
  ON opportunity_crm_credentials (integration_id)
  WHERE status = 'active';

CREATE TABLE opportunity_crm_callback_receipts (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL,
  integration_id BIGINT NOT NULL,
  credential_id BIGINT NOT NULL,
  external_event_id TEXT NOT NULL,
  request_hash CHAR(64) NOT NULL,
  opportunity_reference UUID NOT NULL,
  outcome_event_id BIGINT,
  response_status INTEGER NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT opportunity_crm_callback_receipts_credential_fkey
    FOREIGN KEY (credential_id, workspace_id)
    REFERENCES opportunity_crm_credentials(id, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT opportunity_crm_callback_receipts_integration_fkey
    FOREIGN KEY (integration_id, workspace_id)
    REFERENCES opportunity_crm_integrations(id, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT opportunity_crm_callback_receipts_event_check
    CHECK (
      BTRIM(external_event_id) = external_event_id
      AND external_event_id ~ '^[A-Za-z0-9._:-]+$'
      AND CHAR_LENGTH(external_event_id) <= 120
    ),
  CONSTRAINT opportunity_crm_callback_receipts_hash_check
    CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT opportunity_crm_callback_receipts_status_check
    CHECK (response_status BETWEEN 200 AND 499),
  CONSTRAINT opportunity_crm_callback_receipts_event_unique
    UNIQUE (credential_id, external_event_id)
);

CREATE TABLE opportunity_crm_deliveries (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL,
  integration_id BIGINT NOT NULL,
  owner_id BIGINT NOT NULL,
  opportunity_id BIGINT NOT NULL,
  event_id UUID NOT NULL DEFAULT gen_random_uuid(),
  request_hash CHAR(64) NOT NULL,
  status TEXT NOT NULL,
  http_status INTEGER,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT opportunity_crm_deliveries_integration_fkey
    FOREIGN KEY (integration_id, workspace_id)
    REFERENCES opportunity_crm_integrations(id, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT opportunity_crm_deliveries_opportunity_fkey
    FOREIGN KEY (opportunity_id, owner_id, workspace_id)
    REFERENCES opportunities(id, owner_id, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT opportunity_crm_deliveries_event_unique UNIQUE (event_id),
  CONSTRAINT opportunity_crm_deliveries_hash_check
    CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT opportunity_crm_deliveries_status_check
    CHECK (status IN ('succeeded', 'failed')),
  CONSTRAINT opportunity_crm_deliveries_http_check
    CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599)
);

CREATE INDEX opportunity_crm_integrations_workspace_idx
  ON opportunity_crm_integrations (workspace_id, status, id);
CREATE INDEX opportunity_crm_credentials_workspace_idx
  ON opportunity_crm_credentials (workspace_id, integration_id, status);
CREATE INDEX opportunity_crm_callback_receipts_rate_idx
  ON opportunity_crm_callback_receipts (credential_id, received_at DESC);
CREATE INDEX opportunity_crm_deliveries_workspace_idx
  ON opportunity_crm_deliveries (workspace_id, attempted_at DESC, id DESC);

CREATE FUNCTION reject_opportunity_crm_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'opportunity CRM audit tables are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER opportunity_crm_callback_receipts_append_only
BEFORE UPDATE OR DELETE ON opportunity_crm_callback_receipts
FOR EACH ROW EXECUTE FUNCTION reject_opportunity_crm_audit_mutation();

CREATE TRIGGER opportunity_crm_deliveries_append_only
BEFORE UPDATE OR DELETE ON opportunity_crm_deliveries
FOR EACH ROW EXECUTE FUNCTION reject_opportunity_crm_audit_mutation();

COMMIT;
