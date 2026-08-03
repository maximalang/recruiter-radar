SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- Additive Company State v1 storage. Existing Hiring Episode and Opportunity
-- readers remain unchanged; writes are controlled separately at runtime.
CREATE TABLE company_state_snapshots (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT,
  snapshot_at TIMESTAMPTZ NOT NULL,
  observation_started_at TIMESTAMPTZ NOT NULL,
  observation_ended_at TIMESTAMPTZ NOT NULL,
  hiring_baseline JSONB NOT NULL,
  current_hiring_velocity JSONB NOT NULL,
  role_distribution JSONB NOT NULL,
  seniority_distribution JSONB NOT NULL,
  region_distribution JSONB NOT NULL,
  vacancy_lifetime JSONB NOT NULL,
  repost_rate JSONB NOT NULL,
  recruiting_capacity_signals JSONB NOT NULL,
  business_change_signals JSONB NOT NULL,
  state_classification TEXT NOT NULL,
  state_confidence DOUBLE PRECISION NOT NULL,
  feature_version TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_state_snapshots_id_organization_unique
    UNIQUE (id, organization_id),
  CONSTRAINT company_state_snapshots_input_unique
    UNIQUE (organization_id, feature_version, input_hash),
  CONSTRAINT company_state_snapshots_classification_check CHECK (
    state_classification IN (
      'insufficient_history',
      'accelerating',
      'steady',
      'slowing'
    )
  ),
  CONSTRAINT company_state_snapshots_confidence_check
    CHECK (state_confidence BETWEEN 0 AND 1),
  CONSTRAINT company_state_snapshots_feature_version_not_blank
    CHECK (BTRIM(feature_version) <> ''),
  CONSTRAINT company_state_snapshots_evidence_hash_format
    CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT company_state_snapshots_input_hash_format
    CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT company_state_snapshots_window_check CHECK (
    observation_started_at <= observation_ended_at
    AND observation_ended_at <= snapshot_at
  ),
  CONSTRAINT company_state_snapshots_hiring_baseline_object
    CHECK (JSONB_TYPEOF(hiring_baseline) = 'object'),
  CONSTRAINT company_state_snapshots_current_velocity_object
    CHECK (JSONB_TYPEOF(current_hiring_velocity) = 'object'),
  CONSTRAINT company_state_snapshots_role_distribution_object
    CHECK (JSONB_TYPEOF(role_distribution) = 'object'),
  CONSTRAINT company_state_snapshots_seniority_distribution_object
    CHECK (JSONB_TYPEOF(seniority_distribution) = 'object'),
  CONSTRAINT company_state_snapshots_region_distribution_object
    CHECK (JSONB_TYPEOF(region_distribution) = 'object'),
  CONSTRAINT company_state_snapshots_vacancy_lifetime_object
    CHECK (JSONB_TYPEOF(vacancy_lifetime) = 'object'),
  CONSTRAINT company_state_snapshots_repost_rate_object
    CHECK (JSONB_TYPEOF(repost_rate) = 'object'),
  CONSTRAINT company_state_snapshots_recruiting_capacity_object
    CHECK (JSONB_TYPEOF(recruiting_capacity_signals) = 'object'),
  CONSTRAINT company_state_snapshots_business_change_object
    CHECK (JSONB_TYPEOF(business_change_signals) = 'object')
);

CREATE TABLE company_state_snapshot_events (
  snapshot_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  company_event_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_state_snapshot_events_snapshot_fkey
    FOREIGN KEY (snapshot_id, organization_id)
    REFERENCES company_state_snapshots(id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT company_state_snapshot_events_event_fkey
    FOREIGN KEY (company_event_id, organization_id)
    REFERENCES company_events(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT company_state_snapshot_events_unique
    UNIQUE (snapshot_id, company_event_id)
);

CREATE TABLE company_state_snapshot_evidence (
  snapshot_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  evidence_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_state_snapshot_evidence_snapshot_fkey
    FOREIGN KEY (snapshot_id, organization_id)
    REFERENCES company_state_snapshots(id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT company_state_snapshot_evidence_item_fkey
    FOREIGN KEY (evidence_id, organization_id)
    REFERENCES evidence_items(id, org_id)
    ON DELETE RESTRICT,
  CONSTRAINT company_state_snapshot_evidence_unique
    UNIQUE (snapshot_id, evidence_id)
);

CREATE TABLE company_state_changes (
  id BIGSERIAL PRIMARY KEY,
  snapshot_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  change_type TEXT NOT NULL,
  direction TEXT NOT NULL,
  dimension TEXT NOT NULL,
  magnitude DOUBLE PRECISION NOT NULL,
  baseline_deviation DOUBLE PRECISION,
  confidence DOUBLE PRECISION NOT NULL,
  evidence_hash TEXT NOT NULL,
  change_fingerprint TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_state_changes_id_organization_unique
    UNIQUE (id, organization_id),
  CONSTRAINT company_state_changes_snapshot_fkey
    FOREIGN KEY (snapshot_id, organization_id)
    REFERENCES company_state_snapshots(id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT company_state_changes_fingerprint_unique
    UNIQUE (organization_id, feature_version, change_fingerprint),
  CONSTRAINT company_state_changes_type_check CHECK (
    change_type IN (
      'hiring_acceleration',
      'hiring_slowdown',
      'hiring_restart',
      'new_region',
      'role_mix_shift'
    )
  ),
  CONSTRAINT company_state_changes_direction_check
    CHECK (direction IN ('up', 'down', 'new', 'changed')),
  CONSTRAINT company_state_changes_dimension_not_blank
    CHECK (BTRIM(dimension) <> ''),
  CONSTRAINT company_state_changes_magnitude_check
    CHECK (magnitude >= 0),
  CONSTRAINT company_state_changes_confidence_check
    CHECK (confidence BETWEEN 0 AND 1),
  CONSTRAINT company_state_changes_evidence_hash_format
    CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT company_state_changes_fingerprint_format
    CHECK (change_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT company_state_changes_feature_version_not_blank
    CHECK (BTRIM(feature_version) <> ''),
  CONSTRAINT company_state_changes_payload_object
    CHECK (JSONB_TYPEOF(payload) = 'object')
);

CREATE TABLE company_state_change_events (
  change_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  company_event_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_state_change_events_change_fkey
    FOREIGN KEY (change_id, organization_id)
    REFERENCES company_state_changes(id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT company_state_change_events_event_fkey
    FOREIGN KEY (company_event_id, organization_id)
    REFERENCES company_events(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT company_state_change_events_unique
    UNIQUE (change_id, company_event_id)
);

CREATE TABLE company_state_change_evidence (
  change_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  evidence_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_state_change_evidence_change_fkey
    FOREIGN KEY (change_id, organization_id)
    REFERENCES company_state_changes(id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT company_state_change_evidence_item_fkey
    FOREIGN KEY (evidence_id, organization_id)
    REFERENCES evidence_items(id, org_id)
    ON DELETE RESTRICT,
  CONSTRAINT company_state_change_evidence_unique
    UNIQUE (change_id, evidence_id)
);

CREATE INDEX company_state_snapshots_organization_snapshot_idx
  ON company_state_snapshots (organization_id, snapshot_at DESC, id DESC);
CREATE INDEX company_state_snapshots_classification_idx
  ON company_state_snapshots (
    state_classification, snapshot_at DESC, organization_id
  );
CREATE INDEX company_state_snapshot_events_event_idx
  ON company_state_snapshot_events (company_event_id, organization_id);
CREATE INDEX company_state_snapshot_evidence_item_idx
  ON company_state_snapshot_evidence (evidence_id, organization_id);
CREATE INDEX company_state_changes_organization_created_idx
  ON company_state_changes (organization_id, created_at DESC, id DESC);
CREATE INDEX company_state_changes_type_created_idx
  ON company_state_changes (change_type, created_at DESC, organization_id);
CREATE INDEX company_state_change_events_event_idx
  ON company_state_change_events (company_event_id, organization_id);
CREATE INDEX company_state_change_evidence_item_idx
  ON company_state_change_evidence (evidence_id, organization_id);

CREATE OR REPLACE FUNCTION reject_company_state_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'company state records are append-only';
END;
$$;

CREATE OR REPLACE FUNCTION validate_company_state_snapshot_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM company_state_snapshot_events snapshot_event
    INNER JOIN company_event_evidence event_evidence
      ON event_evidence.company_event_id = snapshot_event.company_event_id
     AND event_evidence.organization_id = snapshot_event.organization_id
    WHERE snapshot_event.snapshot_id = NEW.snapshot_id
      AND snapshot_event.organization_id = NEW.organization_id
      AND event_evidence.evidence_id = NEW.evidence_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'company state snapshot evidence must come from a linked event';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_company_state_change_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM company_state_change_events change_event
    INNER JOIN company_event_evidence event_evidence
      ON event_evidence.company_event_id = change_event.company_event_id
     AND event_evidence.organization_id = change_event.organization_id
    WHERE change_event.change_id = NEW.change_id
      AND change_event.organization_id = NEW.organization_id
      AND event_evidence.evidence_id = NEW.evidence_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'company state change evidence must come from a linked event';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER company_state_snapshots_append_only
BEFORE UPDATE OR DELETE ON company_state_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_company_state_mutation();
CREATE TRIGGER company_state_snapshot_events_append_only
BEFORE UPDATE OR DELETE ON company_state_snapshot_events
FOR EACH ROW EXECUTE FUNCTION reject_company_state_mutation();
CREATE TRIGGER company_state_snapshot_evidence_append_only
BEFORE UPDATE OR DELETE ON company_state_snapshot_evidence
FOR EACH ROW EXECUTE FUNCTION reject_company_state_mutation();
CREATE TRIGGER company_state_snapshot_evidence_validate
BEFORE INSERT ON company_state_snapshot_evidence
FOR EACH ROW EXECUTE FUNCTION validate_company_state_snapshot_evidence();
CREATE TRIGGER company_state_changes_append_only
BEFORE UPDATE OR DELETE ON company_state_changes
FOR EACH ROW EXECUTE FUNCTION reject_company_state_mutation();
CREATE TRIGGER company_state_change_events_append_only
BEFORE UPDATE OR DELETE ON company_state_change_events
FOR EACH ROW EXECUTE FUNCTION reject_company_state_mutation();
CREATE TRIGGER company_state_change_evidence_append_only
BEFORE UPDATE OR DELETE ON company_state_change_evidence
FOR EACH ROW EXECUTE FUNCTION reject_company_state_mutation();
CREATE TRIGGER company_state_change_evidence_validate
BEFORE INSERT ON company_state_change_evidence
FOR EACH ROW EXECUTE FUNCTION validate_company_state_change_evidence();

COMMENT ON TABLE company_state_snapshots IS
  'Append-only company-specific baseline and as-of state snapshots derived only from Company Events.';
COMMENT ON TABLE company_state_changes IS
  'Append-only state transitions with deterministic evidence-backed provenance.';
