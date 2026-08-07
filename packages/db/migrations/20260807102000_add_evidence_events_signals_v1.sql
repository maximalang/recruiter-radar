BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE evidence_events_v1 (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  location_id BIGINT,
  event_type TEXT NOT NULL,
  source_registry_id TEXT NOT NULL
    REFERENCES source_registry_entries_v1(id) ON DELETE RESTRICT,
  source_family TEXT NOT NULL,
  canonical_url TEXT,
  document_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL,
  facts JSONB NOT NULL,
  staffing_need JSONB,
  confidence DOUBLE PRECISION NOT NULL,
  independent_confirmations INTEGER NOT NULL DEFAULT 0,
  valid_until TIMESTAMPTZ NOT NULL,
  polarity TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'verified',
  primary_source BOOLEAN NOT NULL DEFAULT FALSE,
  content_fingerprint TEXT NOT NULL,
  event_fingerprint TEXT NOT NULL,
  supersedes_event_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT evidence_events_v1_identity_fkey
    FOREIGN KEY (workspace_id, organization_id)
    REFERENCES organization_identity_profiles_v1(workspace_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_events_v1_location_fkey
    FOREIGN KEY (location_id, workspace_id, organization_id)
    REFERENCES organization_locations_v1(id, workspace_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_events_v1_id_scope_unique
    UNIQUE (id, workspace_id, organization_id),
  CONSTRAINT evidence_events_v1_source_family_check
    CHECK (BTRIM(source_family) <> ''),
  CONSTRAINT evidence_events_v1_event_type_check
    CHECK (BTRIM(event_type) <> ''),
  CONSTRAINT evidence_events_v1_url_check
    CHECK (canonical_url IS NULL OR canonical_url ~ '^https?://'),
  CONSTRAINT evidence_events_v1_time_check CHECK (
    detected_at >= occurred_at
    AND valid_until >= detected_at
  ),
  CONSTRAINT evidence_events_v1_facts_check
    CHECK (JSONB_TYPEOF(facts) = 'object'),
  CONSTRAINT evidence_events_v1_staffing_check
    CHECK (staffing_need IS NULL OR JSONB_TYPEOF(staffing_need) = 'object'),
  CONSTRAINT evidence_events_v1_confidence_check
    CHECK (confidence BETWEEN 0 AND 1),
  CONSTRAINT evidence_events_v1_confirmations_check
    CHECK (independent_confirmations >= 0),
  CONSTRAINT evidence_events_v1_polarity_check
    CHECK (polarity IN ('positive', 'negative', 'context')),
  CONSTRAINT evidence_events_v1_verification_check
    CHECK (verification_status IN ('unverified', 'verified', 'rejected', 'expired')),
  CONSTRAINT evidence_events_v1_content_fingerprint_check
    CHECK (content_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT evidence_events_v1_event_fingerprint_check
    CHECK (event_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT evidence_events_v1_event_fingerprint_unique
    UNIQUE (workspace_id, organization_id, event_fingerprint),
  CONSTRAINT evidence_events_v1_supersedes_fkey
    FOREIGN KEY (supersedes_event_id, workspace_id, organization_id)
    REFERENCES evidence_events_v1(id, workspace_id, organization_id)
    ON DELETE RESTRICT
);

CREATE INDEX evidence_events_v1_org_time_idx
  ON evidence_events_v1 (
    workspace_id, organization_id, occurred_at DESC, id DESC
  );
CREATE INDEX evidence_events_v1_source_time_idx
  ON evidence_events_v1 (source_registry_id, detected_at DESC, id DESC);
CREATE INDEX evidence_events_v1_valid_idx
  ON evidence_events_v1 (workspace_id, valid_until DESC, id DESC)
  WHERE verification_status = 'verified';

CREATE OR REPLACE FUNCTION validate_evidence_event_source_policy_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT evidence_radar_source_allowed_v1(NEW.source_registry_id) THEN
    RAISE EXCEPTION 'source % is not approved for Evidence Radar automation', NEW.source_registry_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_events_v1_validate_source_policy
BEFORE INSERT ON evidence_events_v1
FOR EACH ROW EXECUTE FUNCTION validate_evidence_event_source_policy_v1();

CREATE TRIGGER evidence_events_v1_append_only
BEFORE UPDATE OR DELETE ON evidence_events_v1
FOR EACH ROW EXECUTE FUNCTION reject_evidence_radar_history_mutation();

CREATE TABLE normalized_signals_v1 (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  signal_type TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  strength DOUBLE PRECISION NOT NULL,
  source_families TEXT[] NOT NULL,
  affected_functions TEXT[] NOT NULL,
  region_code TEXT,
  city TEXT,
  polarity TEXT NOT NULL,
  engine_version TEXT NOT NULL DEFAULT 'evidence-radar-signal-v1',
  input_hash TEXT NOT NULL,
  signal_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT normalized_signals_v1_identity_fkey
    FOREIGN KEY (workspace_id, organization_id)
    REFERENCES organization_identity_profiles_v1(workspace_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT normalized_signals_v1_id_scope_unique
    UNIQUE (id, workspace_id, organization_id),
  CONSTRAINT normalized_signals_v1_type_check CHECK (signal_type IN (
    'hiring_growth', 'mass_hiring', 'new_region', 'new_office',
    'new_department', 'leadership_change', 'recruiter_hiring',
    'funding_received', 'major_contract', 'product_launch',
    'technology_expansion', 'production_expansion', 'international_expansion',
    'team_growth', 'talent_shortage', 'urgent_hiring', 'hiring_freeze',
    'downsizing', 'financial_risk', 'legal_risk'
  )),
  CONSTRAINT normalized_signals_v1_time_check CHECK (
    last_seen_at >= started_at AND valid_until >= last_seen_at
  ),
  CONSTRAINT normalized_signals_v1_confidence_check
    CHECK (confidence BETWEEN 0 AND 1),
  CONSTRAINT normalized_signals_v1_strength_check
    CHECK (strength BETWEEN 0 AND 1),
  CONSTRAINT normalized_signals_v1_sources_check
    CHECK (CARDINALITY(source_families) > 0),
  CONSTRAINT normalized_signals_v1_functions_check
    CHECK (CARDINALITY(affected_functions) > 0),
  CONSTRAINT normalized_signals_v1_polarity_check
    CHECK (polarity IN ('positive', 'negative', 'context')),
  CONSTRAINT normalized_signals_v1_input_hash_check
    CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT normalized_signals_v1_fingerprint_check
    CHECK (signal_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT normalized_signals_v1_fingerprint_unique
    UNIQUE (workspace_id, organization_id, signal_fingerprint)
);

CREATE INDEX normalized_signals_v1_active_idx
  ON normalized_signals_v1 (
    workspace_id, organization_id, valid_until DESC, signal_type, id DESC
  );

CREATE TRIGGER normalized_signals_v1_append_only
BEFORE UPDATE OR DELETE ON normalized_signals_v1
FOR EACH ROW EXECUTE FUNCTION reject_evidence_radar_history_mutation();

CREATE TABLE normalized_signal_event_links_v1 (
  signal_id BIGINT NOT NULL,
  evidence_event_id BIGINT NOT NULL,
  workspace_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  contribution_weight DOUBLE PRECISION NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (signal_id, evidence_event_id),
  CONSTRAINT normalized_signal_event_links_v1_signal_fkey
    FOREIGN KEY (signal_id, workspace_id, organization_id)
    REFERENCES normalized_signals_v1(id, workspace_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT normalized_signal_event_links_v1_event_fkey
    FOREIGN KEY (evidence_event_id, workspace_id, organization_id)
    REFERENCES evidence_events_v1(id, workspace_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT normalized_signal_event_links_v1_weight_check
    CHECK (contribution_weight > 0 AND contribution_weight <= 1)
);

CREATE INDEX normalized_signal_event_links_v1_event_idx
  ON normalized_signal_event_links_v1 (
    evidence_event_id, workspace_id, organization_id
  );

CREATE TRIGGER normalized_signal_event_links_v1_append_only
BEFORE UPDATE OR DELETE ON normalized_signal_event_links_v1
FOR EACH ROW EXECUTE FUNCTION reject_evidence_radar_history_mutation();

CREATE TABLE evidence_correlations_v1 (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  rule_id TEXT NOT NULL,
  signal_ids BIGINT[] NOT NULL,
  source_families TEXT[] NOT NULL,
  window_days INTEGER NOT NULL,
  intent_boost DOUBLE PRECISION NOT NULL,
  explanation TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  correlation_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ NOT NULL,
  CONSTRAINT evidence_correlations_v1_identity_fkey
    FOREIGN KEY (workspace_id, organization_id)
    REFERENCES organization_identity_profiles_v1(workspace_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_correlations_v1_id_scope_unique
    UNIQUE (id, workspace_id, organization_id),
  CONSTRAINT evidence_correlations_v1_rule_check
    CHECK (BTRIM(rule_id) <> ''),
  CONSTRAINT evidence_correlations_v1_signal_ids_check
    CHECK (CARDINALITY(signal_ids) >= 2),
  CONSTRAINT evidence_correlations_v1_source_families_check
    CHECK (CARDINALITY(source_families) >= 2),
  CONSTRAINT evidence_correlations_v1_window_check
    CHECK (window_days BETWEEN 1 AND 365),
  CONSTRAINT evidence_correlations_v1_boost_check
    CHECK (intent_boost BETWEEN 0 AND 1),
  CONSTRAINT evidence_correlations_v1_explanation_check
    CHECK (BTRIM(explanation) <> ''),
  CONSTRAINT evidence_correlations_v1_input_hash_check
    CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT evidence_correlations_v1_fingerprint_check
    CHECK (correlation_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT evidence_correlations_v1_fingerprint_unique
    UNIQUE (workspace_id, organization_id, correlation_fingerprint),
  CONSTRAINT evidence_correlations_v1_validity_check
    CHECK (valid_until >= created_at)
);

CREATE OR REPLACE FUNCTION validate_evidence_correlation_scope_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  unique_requested INTEGER;
  matched INTEGER;
  provided_families TEXT[];
  expected_families TEXT[];
BEGIN
  SELECT COUNT(DISTINCT signal_id)::INTEGER
  INTO unique_requested
  FROM UNNEST(NEW.signal_ids) AS requested(signal_id);

  IF unique_requested <> CARDINALITY(NEW.signal_ids) THEN
    RAISE EXCEPTION 'correlation signal ids must be unique';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO matched
  FROM normalized_signals_v1 AS signal
  WHERE signal.id = ANY(NEW.signal_ids)
    AND signal.workspace_id = NEW.workspace_id
    AND signal.organization_id = NEW.organization_id;

  IF matched <> CARDINALITY(NEW.signal_ids) THEN
    RAISE EXCEPTION 'correlation signals must belong to one workspace and organization';
  END IF;

  SELECT ARRAY_AGG(DISTINCT family ORDER BY family)
  INTO provided_families
  FROM UNNEST(NEW.source_families) AS supplied(family);
  IF CARDINALITY(provided_families) <> CARDINALITY(NEW.source_families) THEN
    RAISE EXCEPTION 'correlation source families must be unique';
  END IF;

  SELECT ARRAY_AGG(DISTINCT family ORDER BY family)
  INTO expected_families
  FROM normalized_signals_v1 AS signal
  CROSS JOIN LATERAL UNNEST(signal.source_families) AS expanded(family)
  WHERE signal.id = ANY(NEW.signal_ids)
    AND signal.workspace_id = NEW.workspace_id
    AND signal.organization_id = NEW.organization_id;

  IF expected_families IS DISTINCT FROM provided_families THEN
    RAISE EXCEPTION 'correlation source families must equal referenced signal provenance';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_correlations_v1_validate_scope
BEFORE INSERT ON evidence_correlations_v1
FOR EACH ROW EXECUTE FUNCTION validate_evidence_correlation_scope_v1();

CREATE TRIGGER evidence_correlations_v1_append_only
BEFORE UPDATE OR DELETE ON evidence_correlations_v1
FOR EACH ROW EXECUTE FUNCTION reject_evidence_radar_history_mutation();

COMMIT;
