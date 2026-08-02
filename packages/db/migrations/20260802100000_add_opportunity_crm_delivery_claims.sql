BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '1min';

CREATE TABLE opportunity_crm_delivery_claims (
  event_id UUID PRIMARY KEY,
  workspace_id BIGINT NOT NULL,
  integration_id BIGINT NOT NULL,
  credential_id BIGINT NOT NULL,
  owner_id BIGINT NOT NULL,
  opportunity_id BIGINT NOT NULL,
  request_hash CHAR(64) NOT NULL,
  request_body TEXT NOT NULL,
  request_timestamp CHAR(10) NOT NULL,
  claim_token UUID NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT opportunity_crm_delivery_claims_integration_fkey
    FOREIGN KEY (integration_id, workspace_id)
    REFERENCES opportunity_crm_integrations(id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT opportunity_crm_delivery_claims_credential_fkey
    FOREIGN KEY (credential_id, integration_id, workspace_id)
    REFERENCES opportunity_crm_credentials(id, integration_id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT opportunity_crm_delivery_claims_opportunity_fkey
    FOREIGN KEY (opportunity_id, owner_id, workspace_id)
    REFERENCES opportunities(id, owner_id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT opportunity_crm_delivery_claims_hash_check
    CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT opportunity_crm_delivery_claims_body_check
    CHECK (OCTET_LENGTH(request_body) BETWEEN 1 AND 65536),
  CONSTRAINT opportunity_crm_delivery_claims_timestamp_check
    CHECK (request_timestamp ~ '^[0-9]{10}$')
);

CREATE INDEX opportunity_crm_delivery_claims_stale_idx
  ON opportunity_crm_delivery_claims (claimed_at);

COMMENT ON TABLE opportunity_crm_delivery_claims IS
  'Short-lived idempotency claims. Network I/O happens after the claiming transaction commits.';

COMMIT;
