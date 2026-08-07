BEGIN;

-- Additive Signal Episodes v2 storage. Legacy Hiring Episode and Opportunity
-- readers remain unchanged; the new writer is guarded by an independent flag.
CREATE TABLE signal_episodes (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT,
  episode_identity TEXT NOT NULL,
  episode_generation INTEGER NOT NULL,
  episode_type TEXT NOT NULL,
  stage TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  intensity DOUBLE PRECISION NOT NULL,
  direction TEXT NOT NULL,
  baseline_deviation DOUBLE PRECISION,
  role_families TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  regions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  seniority_distribution JSONB NOT NULL DEFAULT '{}'::JSONB,
  problem_hypotheses TEXT[] NOT NULL,
  evidence_hash TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT signal_episodes_id_organization_unique
    UNIQUE (id, organization_id),
  CONSTRAINT signal_episodes_identity_generation_unique
    UNIQUE (organization_id, engine_version, episode_identity, episode_generation),
  CONSTRAINT signal_episodes_input_unique
    UNIQUE (organization_id, engine_version, input_hash),
  CONSTRAINT signal_episodes_identity_check
    CHECK (episode_identity ~ '^[a-f0-9]{64}$'),
  CONSTRAINT signal_episodes_generation_check
    CHECK (episode_generation > 0),
  CONSTRAINT signal_episodes_type_check CHECK (
    episode_type IN (
      'vacancy_acceleration',
      'persistent_hiring_problem',
      'role_cluster',
      'new_region_expansion',
      'hiring_restart',
      'sustained_hiring',
      'leadership_led_expansion',
      'recruiting_capacity_gap',
      'new_unit_buildout',
      'business_expansion',
      'reactivation_window'
    )
  ),
  CONSTRAINT signal_episodes_stage_check
    CHECK (stage IN ('active', 'cooling', 'expired')),
  CONSTRAINT signal_episodes_window_check
    CHECK (started_at <= last_seen_at AND last_seen_at < valid_until),
  CONSTRAINT signal_episodes_intensity_check
    CHECK (intensity BETWEEN 0 AND 1),
  CONSTRAINT signal_episodes_direction_check
    CHECK (direction IN ('up', 'down', 'new', 'changed')),
  CONSTRAINT signal_episodes_deviation_check CHECK (
    baseline_deviation IS NULL OR baseline_deviation BETWEEN -1000000 AND 1000000
  ),
  CONSTRAINT signal_episodes_role_families_check
    CHECK (ARRAY_POSITION(role_families, NULL) IS NULL),
  CONSTRAINT signal_episodes_regions_check
    CHECK (ARRAY_POSITION(regions, NULL) IS NULL),
  CONSTRAINT signal_episodes_seniority_check
    CHECK (JSONB_TYPEOF(seniority_distribution) = 'object'),
  CONSTRAINT signal_episodes_hypotheses_check CHECK (
    CARDINALITY(problem_hypotheses) > 0 AND
    ARRAY_POSITION(problem_hypotheses, NULL) IS NULL
  ),
  CONSTRAINT signal_episodes_evidence_hash_check
    CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT signal_episodes_input_hash_check
    CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT signal_episodes_engine_version_check
    CHECK (LENGTH(BTRIM(engine_version)) > 0)
);

CREATE TABLE signal_episode_state_changes (
  signal_episode_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  company_state_change_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT signal_episode_state_changes_episode_fkey
    FOREIGN KEY (signal_episode_id, organization_id)
    REFERENCES signal_episodes(id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT signal_episode_state_changes_change_fkey
    FOREIGN KEY (company_state_change_id, organization_id)
    REFERENCES company_state_changes(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT signal_episode_state_changes_unique
    UNIQUE (signal_episode_id, company_state_change_id)
);

CREATE TABLE signal_episode_events (
  signal_episode_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  company_event_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT signal_episode_events_episode_fkey
    FOREIGN KEY (signal_episode_id, organization_id)
    REFERENCES signal_episodes(id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT signal_episode_events_event_fkey
    FOREIGN KEY (company_event_id, organization_id)
    REFERENCES company_events(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT signal_episode_events_unique
    UNIQUE (signal_episode_id, company_event_id)
);

CREATE TABLE signal_episode_evidence (
  signal_episode_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  evidence_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT signal_episode_evidence_episode_fkey
    FOREIGN KEY (signal_episode_id, organization_id)
    REFERENCES signal_episodes(id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT signal_episode_evidence_item_fkey
    FOREIGN KEY (evidence_id, organization_id)
    REFERENCES evidence_items(id, org_id)
    ON DELETE RESTRICT,
  CONSTRAINT signal_episode_evidence_unique
    UNIQUE (signal_episode_id, evidence_id)
);

CREATE INDEX signal_episodes_current_idx
  ON signal_episodes (
    organization_id,
    engine_version,
    episode_identity,
    episode_generation DESC
  );
CREATE INDEX signal_episodes_stage_validity_idx
  ON signal_episodes (stage, valid_until, organization_id);
CREATE INDEX signal_episode_state_changes_change_idx
  ON signal_episode_state_changes (company_state_change_id, organization_id);
CREATE INDEX signal_episode_events_event_idx
  ON signal_episode_events (company_event_id, organization_id);
CREATE INDEX signal_episode_evidence_item_idx
  ON signal_episode_evidence (evidence_id, organization_id);

CREATE FUNCTION reject_signal_episode_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'signal episode records are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION validate_signal_episode_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM signal_episode_state_changes episode_change
    JOIN company_state_change_evidence change_evidence
      ON change_evidence.change_id = episode_change.company_state_change_id
     AND change_evidence.organization_id = episode_change.organization_id
    WHERE episode_change.signal_episode_id = NEW.signal_episode_id
      AND episode_change.organization_id = NEW.organization_id
      AND change_evidence.evidence_id = NEW.evidence_id
  ) AND NOT EXISTS (
    SELECT 1
    FROM signal_episode_events episode_event
    JOIN company_event_evidence event_evidence
      ON event_evidence.company_event_id = episode_event.company_event_id
     AND event_evidence.organization_id = episode_event.organization_id
    WHERE episode_event.signal_episode_id = NEW.signal_episode_id
      AND episode_event.organization_id = NEW.organization_id
      AND event_evidence.evidence_id = NEW.evidence_id
  ) THEN
    RAISE EXCEPTION
      'signal episode evidence % is not linked to episode % provenance',
      NEW.evidence_id,
      NEW.signal_episode_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER signal_episodes_append_only
BEFORE UPDATE OR DELETE ON signal_episodes
FOR EACH ROW EXECUTE FUNCTION reject_signal_episode_mutation();
CREATE TRIGGER signal_episode_state_changes_append_only
BEFORE UPDATE OR DELETE ON signal_episode_state_changes
FOR EACH ROW EXECUTE FUNCTION reject_signal_episode_mutation();
CREATE TRIGGER signal_episode_events_append_only
BEFORE UPDATE OR DELETE ON signal_episode_events
FOR EACH ROW EXECUTE FUNCTION reject_signal_episode_mutation();
CREATE TRIGGER signal_episode_evidence_append_only
BEFORE UPDATE OR DELETE ON signal_episode_evidence
FOR EACH ROW EXECUTE FUNCTION reject_signal_episode_mutation();
CREATE TRIGGER signal_episode_evidence_validate
BEFORE INSERT ON signal_episode_evidence
FOR EACH ROW EXECUTE FUNCTION validate_signal_episode_evidence();

COMMIT;
