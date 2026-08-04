BEGIN;

-- Additive Commercial Thesis v1 storage. The layer is company-level and
-- remains disconnected from legacy Hiring Episode, Opportunity, and readers.
CREATE OR REPLACE FUNCTION commercial_thesis_section_valid(section JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT
    JSONB_TYPEOF(section) = 'array'
    AND JSONB_ARRAY_LENGTH(section) > 0
    AND NOT EXISTS (
      SELECT 1
      FROM JSONB_ARRAY_ELEMENTS(section) AS item
      WHERE JSONB_TYPEOF(item) <> 'object'
         OR item->>'classification' NOT IN (
           'confirmed_fact',
           'rule_based_inference',
           'heuristic_hypothesis',
           'unknown'
         )
         OR COALESCE(item->>'code', '') !~ '^[a-z][a-z0-9_]{1,63}$'
         OR BTRIM(COALESCE(item->>'text', '')) = ''
         OR JSONB_TYPEOF(item->'evidenceRefs') IS DISTINCT FROM 'array'
    );
$$;

CREATE TABLE commercial_theses (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT,
  signal_episode_id BIGINT NOT NULL,
  signal_episode_generation INTEGER NOT NULL,
  thesis_identity TEXT NOT NULL,
  thesis_generation INTEGER NOT NULL,
  what_changed JSONB NOT NULL,
  why_it_matters JSONB NOT NULL,
  probable_hiring_problem JSONB NOT NULL,
  why_external_agency_may_be_needed JSONB NOT NULL,
  why_this_agency_fits JSONB NOT NULL,
  why_now JSONB NOT NULL,
  recommended_service JSONB NOT NULL,
  recommended_persona JSONB NOT NULL,
  recommended_angle JSONB NOT NULL,
  risks JSONB NOT NULL,
  limitations JSONB NOT NULL,
  evidence_hash TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT commercial_theses_id_organization_unique
    UNIQUE (id, organization_id),
  CONSTRAINT commercial_theses_episode_fkey
    FOREIGN KEY (signal_episode_id, organization_id)
    REFERENCES signal_episodes(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT commercial_theses_identity_generation_unique
    UNIQUE (organization_id, engine_version, thesis_identity, thesis_generation),
  CONSTRAINT commercial_theses_input_unique
    UNIQUE (organization_id, engine_version, input_hash),
  CONSTRAINT commercial_theses_identity_check
    CHECK (thesis_identity ~ '^[a-f0-9]{64}$'),
  CONSTRAINT commercial_theses_generation_check
    CHECK (thesis_generation > 0),
  CONSTRAINT commercial_theses_episode_generation_check
    CHECK (signal_episode_generation > 0),
  CONSTRAINT commercial_theses_what_changed_check
    CHECK (commercial_thesis_section_valid(what_changed)),
  CONSTRAINT commercial_theses_why_it_matters_check
    CHECK (commercial_thesis_section_valid(why_it_matters)),
  CONSTRAINT commercial_theses_probable_problem_check
    CHECK (commercial_thesis_section_valid(probable_hiring_problem)),
  CONSTRAINT commercial_theses_external_agency_check
    CHECK (commercial_thesis_section_valid(why_external_agency_may_be_needed)),
  CONSTRAINT commercial_theses_agency_fit_check
    CHECK (commercial_thesis_section_valid(why_this_agency_fits)),
  CONSTRAINT commercial_theses_why_now_check
    CHECK (commercial_thesis_section_valid(why_now)),
  CONSTRAINT commercial_theses_service_check
    CHECK (commercial_thesis_section_valid(recommended_service)),
  CONSTRAINT commercial_theses_persona_check
    CHECK (commercial_thesis_section_valid(recommended_persona)),
  CONSTRAINT commercial_theses_angle_check
    CHECK (commercial_thesis_section_valid(recommended_angle)),
  CONSTRAINT commercial_theses_risks_check
    CHECK (commercial_thesis_section_valid(risks)),
  CONSTRAINT commercial_theses_limitations_check
    CHECK (commercial_thesis_section_valid(limitations)),
  CONSTRAINT commercial_theses_evidence_hash_check
    CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT commercial_theses_input_hash_check
    CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT commercial_theses_engine_version_check
    CHECK (BTRIM(engine_version) <> '')
);

CREATE TABLE commercial_thesis_evidence (
  commercial_thesis_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  evidence_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT commercial_thesis_evidence_thesis_fkey
    FOREIGN KEY (commercial_thesis_id, organization_id)
    REFERENCES commercial_theses(id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT commercial_thesis_evidence_item_fkey
    FOREIGN KEY (evidence_id, organization_id)
    REFERENCES evidence_items(id, org_id)
    ON DELETE RESTRICT,
  CONSTRAINT commercial_thesis_evidence_unique
    UNIQUE (commercial_thesis_id, evidence_id)
);

CREATE INDEX commercial_theses_episode_idx
  ON commercial_theses (signal_episode_id, engine_version, thesis_generation DESC);
CREATE INDEX commercial_theses_current_idx
  ON commercial_theses (
    organization_id,
    engine_version,
    thesis_identity,
    thesis_generation DESC
  );
CREATE INDEX commercial_thesis_evidence_item_idx
  ON commercial_thesis_evidence (evidence_id, organization_id);

CREATE OR REPLACE FUNCTION reject_commercial_thesis_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'commercial thesis records are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION validate_commercial_thesis_source()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM signal_episodes episode
    WHERE episode.id = NEW.signal_episode_id
      AND episode.organization_id = NEW.organization_id
      AND episode.episode_generation = NEW.signal_episode_generation
      AND episode.evidence_hash = NEW.evidence_hash
  ) THEN
    RAISE EXCEPTION 'commercial thesis source episode or evidence hash mismatch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_commercial_thesis_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM commercial_theses thesis
    JOIN signal_episode_evidence episode_evidence
      ON episode_evidence.signal_episode_id = thesis.signal_episode_id
     AND episode_evidence.organization_id = thesis.organization_id
     AND episode_evidence.evidence_id = NEW.evidence_id
    WHERE thesis.id = NEW.commercial_thesis_id
      AND thesis.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'commercial thesis evidence must come from its Signal Episode'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION require_commercial_thesis_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM commercial_thesis_evidence evidence
    WHERE evidence.commercial_thesis_id = NEW.id
      AND evidence.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'commercial thesis requires linked evidence'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER commercial_theses_source_validate
BEFORE INSERT ON commercial_theses
FOR EACH ROW EXECUTE FUNCTION validate_commercial_thesis_source();
CREATE CONSTRAINT TRIGGER commercial_theses_evidence_required
AFTER INSERT ON commercial_theses
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_commercial_thesis_evidence();
CREATE TRIGGER commercial_thesis_evidence_validate
BEFORE INSERT ON commercial_thesis_evidence
FOR EACH ROW EXECUTE FUNCTION validate_commercial_thesis_evidence();
CREATE TRIGGER commercial_theses_append_only
BEFORE UPDATE OR DELETE ON commercial_theses
FOR EACH ROW EXECUTE FUNCTION reject_commercial_thesis_mutation();
CREATE TRIGGER commercial_thesis_evidence_append_only
BEFORE UPDATE OR DELETE ON commercial_thesis_evidence
FOR EACH ROW EXECUTE FUNCTION reject_commercial_thesis_mutation();

COMMIT;
