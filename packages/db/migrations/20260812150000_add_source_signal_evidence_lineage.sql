BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE source_signal_evidence_lineage_v1 (
  id BIGSERIAL PRIMARY KEY,
  signal_id BIGINT NOT NULL,
  evidence_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  source TEXT NOT NULL,
  source_family TEXT NOT NULL,
  external_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  normalized_at TIMESTAMPTZ NOT NULL,
  evidence_tier TEXT NOT NULL,
  confidence JSONB NOT NULL,
  extraction_method TEXT NOT NULL,
  organization_resolution_reason TEXT NOT NULL,
  signal_payload_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT source_signal_evidence_lineage_v1_signal_fkey
    FOREIGN KEY (signal_id, organization_id)
    REFERENCES signals(id, org_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_signal_evidence_lineage_v1_evidence_fkey
    FOREIGN KEY (evidence_id, organization_id)
    REFERENCES evidence_items(id, org_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_signal_evidence_lineage_v1_signal_evidence_unique
    UNIQUE (signal_id, evidence_id),
  CONSTRAINT source_signal_evidence_lineage_v1_source_check
    CHECK (BTRIM(source) <> '' AND BTRIM(source_family) <> ''),
  CONSTRAINT source_signal_evidence_lineage_v1_external_check
    CHECK (BTRIM(external_id) <> ''),
  CONSTRAINT source_signal_evidence_lineage_v1_url_check
    CHECK (source_url ~ '^https?://'),
  CONSTRAINT source_signal_evidence_lineage_v1_tier_check
    CHECK (evidence_tier IN ('direct', 'corroboration', 'context')),
  CONSTRAINT source_signal_evidence_lineage_v1_confidence_check
    CHECK (JSONB_TYPEOF(confidence) = 'object'),
  CONSTRAINT source_signal_evidence_lineage_v1_extraction_check
    CHECK (BTRIM(extraction_method) <> ''),
  CONSTRAINT source_signal_evidence_lineage_v1_resolution_check
    CHECK (organization_resolution_reason IN ('validated-strong-key', 'source-local-key', 'new-organization')),
  CONSTRAINT source_signal_evidence_lineage_v1_payload_check
    CHECK (JSONB_TYPEOF(signal_payload_snapshot) = 'object')
);

CREATE INDEX source_signal_evidence_lineage_v1_signal_idx
  ON source_signal_evidence_lineage_v1 (signal_id, created_at DESC);
CREATE INDEX source_signal_evidence_lineage_v1_evidence_idx
  ON source_signal_evidence_lineage_v1 (evidence_id);
CREATE INDEX source_signal_evidence_lineage_v1_source_external_idx
  ON source_signal_evidence_lineage_v1 (source, external_id, created_at DESC);

CREATE OR REPLACE FUNCTION reject_source_signal_lineage_mutation_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'source signal evidence lineage is append-only';
END;
$$;

CREATE TRIGGER source_signal_evidence_lineage_v1_append_only
BEFORE UPDATE OR DELETE ON source_signal_evidence_lineage_v1
FOR EACH ROW EXECUTE FUNCTION reject_source_signal_lineage_mutation_v1();

COMMIT;
