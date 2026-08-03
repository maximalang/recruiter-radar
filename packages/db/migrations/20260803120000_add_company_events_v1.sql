BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- Company Events is an additive company/evidence layer. No existing reader is
-- switched by this migration; runtime normalization remains fail-closed behind
-- COMPANY_EVENTS_V1_ENABLED.
CREATE INDEX signals_company_events_job_posting_idx
  ON signals (id, org_id, updated_at)
  INCLUDE (source_url)
  WHERE signal_type = 'job_posting';

CREATE INDEX evidence_items_company_events_url_idx
  ON evidence_items (org_id, url, id)
  WHERE org_id IS NOT NULL;

CREATE TABLE company_events (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  source_family TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  evidence_ids BIGINT[] NOT NULL,
  event_fingerprint TEXT NOT NULL,
  confidence DOUBLE PRECISION,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  normalizer_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_events_id_organization_unique
    UNIQUE (id, organization_id),
  CONSTRAINT company_events_fingerprint_unique UNIQUE (event_fingerprint),
  CONSTRAINT company_events_type_check CHECK (
    event_type IN (
      'job_posting',
      'vacancy_repost',
      'vacancy_salary_change',
      'vacancy_cluster',
      'recruiter_vacancy',
      'leadership_change',
      'new_business_unit',
      'new_region',
      'office_opening',
      'product_launch',
      'funding_or_investment',
      'major_contract',
      'career_page_change',
      'hiring_restart',
      'hiring_slowdown'
    )
  ),
  CONSTRAINT company_events_source_family_not_blank
    CHECK (BTRIM(source_family) <> ''),
  CONSTRAINT company_events_source_record_not_blank
    CHECK (BTRIM(source_record_id) <> ''),
  CONSTRAINT company_events_evidence_required
    CHECK (CARDINALITY(evidence_ids) > 0),
  CONSTRAINT company_events_fingerprint_format
    CHECK (event_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT company_events_confidence_check
    CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  CONSTRAINT company_events_payload_object_check
    CHECK (JSONB_TYPEOF(payload) = 'object'),
  CONSTRAINT company_events_normalizer_not_blank
    CHECK (BTRIM(normalizer_version) <> ''),
  CONSTRAINT company_events_observation_window_check
    CHECK (
      last_seen_at >= first_seen_at
      AND first_seen_at >= occurred_at
    )
);

CREATE TABLE company_event_publications (
  id BIGSERIAL PRIMARY KEY,
  company_event_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  signal_id BIGINT,
  source_family TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  source_url TEXT,
  external_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  evidence_ids BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
  publication_fingerprint TEXT NOT NULL,
  source_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_event_publications_event_fkey
    FOREIGN KEY (company_event_id, organization_id)
    REFERENCES company_events(id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT company_event_publications_signal_fkey
    FOREIGN KEY (signal_id, organization_id)
    REFERENCES signals(id, org_id)
    ON DELETE RESTRICT,
  CONSTRAINT company_event_publications_source_not_blank
    CHECK (BTRIM(source_family) <> ''),
  CONSTRAINT company_event_publications_record_not_blank
    CHECK (BTRIM(source_record_id) <> ''),
  CONSTRAINT company_event_publications_fingerprint_format
    CHECK (publication_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT company_event_publications_snapshot_object_check
    CHECK (JSONB_TYPEOF(source_snapshot) = 'object'),
  CONSTRAINT company_event_publications_window_check
    CHECK (
      last_seen_at >= first_seen_at
      AND first_seen_at >= occurred_at
    ),
  CONSTRAINT company_event_publications_fingerprint_unique
    UNIQUE (publication_fingerprint)
);

CREATE TABLE company_event_evidence (
  id BIGSERIAL PRIMARY KEY,
  company_event_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  evidence_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_event_evidence_event_fkey
    FOREIGN KEY (company_event_id, organization_id)
    REFERENCES company_events(id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT company_event_evidence_item_fkey
    FOREIGN KEY (evidence_id, organization_id)
    REFERENCES evidence_items(id, org_id)
    ON DELETE RESTRICT,
  CONSTRAINT company_event_evidence_unique
    UNIQUE (company_event_id, evidence_id)
);

CREATE INDEX company_events_organization_occurred_idx
  ON company_events (organization_id, occurred_at DESC, id DESC);

CREATE INDEX company_events_type_last_seen_idx
  ON company_events (event_type, last_seen_at DESC, id DESC);

CREATE INDEX company_event_publications_event_idx
  ON company_event_publications (company_event_id, created_at ASC, id ASC);

CREATE INDEX company_event_publications_signal_idx
  ON company_event_publications (signal_id, organization_id)
  WHERE signal_id IS NOT NULL;

CREATE INDEX company_event_publications_source_record_idx
  ON company_event_publications (
    organization_id, source_family, source_record_id, created_at DESC
  );

CREATE INDEX company_event_evidence_event_idx
  ON company_event_evidence (company_event_id, created_at ASC, id ASC);

CREATE INDEX company_event_evidence_item_idx
  ON company_event_evidence (evidence_id, organization_id);

CREATE OR REPLACE FUNCTION guard_company_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'company events are immutable';
  END IF;

  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
     OR NEW.first_seen_at IS DISTINCT FROM OLD.first_seen_at
     OR NEW.source_family IS DISTINCT FROM OLD.source_family
     OR NEW.source_record_id IS DISTINCT FROM OLD.source_record_id
     OR NEW.event_fingerprint IS DISTINCT FROM OLD.event_fingerprint
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.normalizer_version IS DISTINCT FROM OLD.normalizer_version
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'company event canonical fields are immutable';
  END IF;

  IF NEW.last_seen_at < OLD.last_seen_at THEN
    RAISE EXCEPTION 'company event last_seen_at cannot move backwards';
  END IF;

  IF NOT OLD.evidence_ids <@ NEW.evidence_ids THEN
    RAISE EXCEPTION 'company event evidence cannot be removed';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_company_event_evidence_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM UNNEST(NEW.evidence_ids) AS requested(evidence_id)
    LEFT JOIN evidence_items evidence
      ON evidence.id = requested.evidence_id
     AND evidence.org_id = NEW.organization_id
    WHERE evidence.id IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'company event evidence must belong to its organization';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION reject_company_event_provenance_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'company event provenance is append-only';
END;
$$;

CREATE OR REPLACE FUNCTION validate_company_event_publication_evidence_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM UNNEST(NEW.evidence_ids) AS requested(evidence_id)
    LEFT JOIN evidence_items evidence
      ON evidence.id = requested.evidence_id
     AND evidence.org_id = NEW.organization_id
    WHERE evidence.id IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'company event publication evidence must belong to its organization';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER company_events_guard_mutation
BEFORE UPDATE OR DELETE ON company_events
FOR EACH ROW
EXECUTE FUNCTION guard_company_event_mutation();

CREATE TRIGGER company_events_validate_evidence_scope
BEFORE INSERT OR UPDATE OF organization_id, evidence_ids ON company_events
FOR EACH ROW
EXECUTE FUNCTION validate_company_event_evidence_scope();

CREATE TRIGGER company_event_publications_append_only
BEFORE UPDATE OR DELETE ON company_event_publications
FOR EACH ROW
EXECUTE FUNCTION reject_company_event_provenance_mutation();

CREATE TRIGGER company_event_publications_validate_evidence_scope
BEFORE INSERT OR UPDATE OF organization_id, evidence_ids
ON company_event_publications
FOR EACH ROW
EXECUTE FUNCTION validate_company_event_publication_evidence_scope();

CREATE TRIGGER company_event_evidence_append_only
BEFORE UPDATE OR DELETE ON company_event_evidence
FOR EACH ROW
EXECUTE FUNCTION reject_company_event_provenance_mutation();

COMMENT ON TABLE company_events IS
  'Canonical company facts. Event identity and payload are immutable; only observation freshness, confidence and additive evidence may advance.';
COMMENT ON TABLE company_event_publications IS
  'Append-only provenance for every source publication attached to a canonical company event.';
COMMENT ON TABLE company_event_evidence IS
  'Append-only, organization-safe evidence links for company events.';

COMMIT;
