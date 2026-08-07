BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- ---------------------------------------------------------------------------
-- Query Planner v2 source execution provenance.
-- A physical request may be shared, but every consumer remains profile scoped.
-- ---------------------------------------------------------------------------
CREATE TABLE query_plan_source_executions (
  id BIGSERIAL PRIMARY KEY,
  shared_request_id BIGINT NOT NULL
    REFERENCES query_plan_shared_requests(id) ON DELETE RESTRICT,
  source TEXT NOT NULL,
  shared_request_hash TEXT NOT NULL,
  execution_identity TEXT NOT NULL,
  execution_generation INTEGER NOT NULL,
  request_snapshot JSONB NOT NULL,
  status TEXT NOT NULL,
  fetched_records INTEGER NOT NULL DEFAULT 0,
  unique_companies INTEGER NOT NULL DEFAULT 0,
  signal_upserts INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT query_plan_source_executions_identity_unique
    UNIQUE (shared_request_id, execution_identity, execution_generation),
  CONSTRAINT query_plan_source_executions_identity_check
    CHECK (execution_identity ~ '^[a-f0-9]{64}$'),
  CONSTRAINT query_plan_source_executions_generation_check
    CHECK (execution_generation > 0),
  CONSTRAINT query_plan_source_executions_source_check
    CHECK (source IN ('hh', 'superjob', 'habr-career', 'rabota-rossii')),
  CONSTRAINT query_plan_source_executions_request_hash_check
    CHECK (shared_request_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT query_plan_source_executions_request_snapshot_check
    CHECK (
      JSONB_TYPEOF(request_snapshot) = 'object'
      AND NOT (request_snapshot ? 'contactValues')
      AND NOT (request_snapshot ? 'personalContacts')
    ),
  CONSTRAINT query_plan_source_executions_status_check
    CHECK (status IN ('running', 'succeeded', 'failed')),
  CONSTRAINT query_plan_source_executions_counts_check CHECK (
    fetched_records >= 0
    AND unique_companies >= 0
    AND signal_upserts >= 0
  ),
  CONSTRAINT query_plan_source_executions_window_check CHECK (
    completed_at IS NULL OR completed_at >= started_at
  ),
  CONSTRAINT query_plan_source_executions_error_check CHECK (
    (status = 'failed' AND error_code IS NOT NULL AND BTRIM(error_code) <> '')
    OR (status <> 'failed' AND error_code IS NULL)
  )
);

CREATE TABLE query_plan_source_execution_consumers (
  execution_id BIGINT NOT NULL
    REFERENCES query_plan_source_executions(id) ON DELETE CASCADE,
  plan_snapshot_id BIGINT NOT NULL,
  workspace_id BIGINT NOT NULL,
  client_profile_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT query_plan_source_execution_consumers_plan_fkey
    FOREIGN KEY (plan_snapshot_id, workspace_id, client_profile_id)
    REFERENCES query_plan_snapshots(id, workspace_id, client_profile_id)
    ON DELETE RESTRICT,
  CONSTRAINT query_plan_source_execution_consumers_unique
    UNIQUE (execution_id, plan_snapshot_id, workspace_id, client_profile_id)
);

CREATE TABLE query_plan_source_execution_signals (
  execution_id BIGINT NOT NULL
    REFERENCES query_plan_source_executions(id) ON DELETE CASCADE,
  signal_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT query_plan_source_execution_signals_signal_fkey
    FOREIGN KEY (signal_id, organization_id)
    REFERENCES signals(id, org_id)
    ON DELETE RESTRICT,
  CONSTRAINT query_plan_source_execution_signals_source_check
    CHECK (source IN ('hh', 'superjob', 'habr-career', 'rabota-rossii')),
  CONSTRAINT query_plan_source_execution_signals_external_check
    CHECK (BTRIM(external_id) <> ''),
  CONSTRAINT query_plan_source_execution_signals_unique
    UNIQUE (execution_id, signal_id),
  CONSTRAINT query_plan_source_execution_signal_identity_unique
    UNIQUE (execution_id, source, external_id)
);

CREATE INDEX query_plan_source_execution_consumers_profile_idx
  ON query_plan_source_execution_consumers (
    workspace_id, client_profile_id, plan_snapshot_id, execution_id
  );
CREATE INDEX query_plan_source_execution_signals_signal_idx
  ON query_plan_source_execution_signals (signal_id, organization_id, execution_id);

-- ---------------------------------------------------------------------------
-- Exact v3 candidate -> legacy compatibility episode -> opportunity lineage.
-- The compatibility episode exists only so the established workflow/outcome
-- surface can be reused during canary. It is never rediscovered by similarity.
-- ---------------------------------------------------------------------------
CREATE TABLE commercial_signal_opportunity_lineage (
  id BIGSERIAL PRIMARY KEY,
  lineage_key TEXT NOT NULL,
  opportunity_id BIGINT NOT NULL,
  candidate_id BIGINT NOT NULL,
  compatibility_hiring_episode_id BIGINT NOT NULL,
  workspace_id BIGINT NOT NULL,
  owner_id BIGINT NOT NULL,
  client_profile_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  candidate_identity TEXT NOT NULL,
  candidate_generation INTEGER NOT NULL,
  signal_episode_id BIGINT NOT NULL,
  signal_episode_identity TEXT NOT NULL,
  signal_episode_generation INTEGER NOT NULL,
  score_version TEXT NOT NULL,
  score_snapshot JSONB NOT NULL,
  commercial_signal_card JSONB NOT NULL,
  evidence_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT commercial_signal_opportunity_lineage_key_unique
    UNIQUE (lineage_key),
  CONSTRAINT commercial_signal_opportunity_lineage_opportunity_unique
    UNIQUE (opportunity_id),
  CONSTRAINT commercial_signal_opportunity_lineage_candidate_unique
    UNIQUE (candidate_id),
  CONSTRAINT commercial_signal_opportunity_lineage_compat_episode_unique
    UNIQUE (compatibility_hiring_episode_id),
  CONSTRAINT commercial_signal_opportunity_lineage_opportunity_fkey
    FOREIGN KEY (opportunity_id, owner_id, workspace_id)
    REFERENCES opportunities(id, owner_id, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT commercial_signal_opportunity_lineage_candidate_fkey
    FOREIGN KEY (
      candidate_id,
      organization_id,
      workspace_id,
      client_profile_id
    )
    REFERENCES opportunity_candidates(
      id,
      organization_id,
      workspace_id,
      client_profile_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT commercial_signal_opportunity_lineage_compat_episode_fkey
    FOREIGN KEY (compatibility_hiring_episode_id, organization_id)
    REFERENCES hiring_episodes(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT commercial_signal_opportunity_lineage_episode_fkey
    FOREIGN KEY (signal_episode_id, organization_id)
    REFERENCES signal_episodes(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT commercial_signal_opportunity_lineage_hash_checks CHECK (
    lineage_key ~ '^[a-f0-9]{64}$'
    AND candidate_identity ~ '^[a-f0-9]{64}$'
    AND signal_episode_identity ~ '^[a-f0-9]{64}$'
    AND evidence_hash ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT commercial_signal_opportunity_lineage_generations_check CHECK (
    candidate_generation > 0 AND signal_episode_generation > 0
  ),
  CONSTRAINT commercial_signal_opportunity_lineage_score_version_check
    CHECK (score_version = 'opportunity-v3'),
  CONSTRAINT commercial_signal_opportunity_lineage_score_snapshot_check
    CHECK (JSONB_TYPEOF(score_snapshot) = 'object'),
  CONSTRAINT commercial_signal_opportunity_lineage_card_check
    CHECK (
      JSONB_TYPEOF(commercial_signal_card) = 'object'
      AND commercial_signal_card->>'version' = 'commercial-signal-card-v1'
      AND commercial_signal_card->>'scoreVersion' = 'opportunity-v3'
    )
);

CREATE TABLE commercial_signal_opportunity_query_plans (
  lineage_id BIGINT NOT NULL
    REFERENCES commercial_signal_opportunity_lineage(id) ON DELETE CASCADE,
  execution_id BIGINT NOT NULL
    REFERENCES query_plan_source_executions(id) ON DELETE RESTRICT,
  plan_snapshot_id BIGINT NOT NULL,
  workspace_id BIGINT NOT NULL,
  client_profile_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT commercial_signal_opportunity_query_plans_plan_fkey
    FOREIGN KEY (plan_snapshot_id, workspace_id, client_profile_id)
    REFERENCES query_plan_snapshots(id, workspace_id, client_profile_id)
    ON DELETE RESTRICT,
  CONSTRAINT commercial_signal_opportunity_query_plans_unique
    UNIQUE (lineage_id, execution_id, plan_snapshot_id)
);

CREATE INDEX commercial_signal_opportunity_lineage_scope_idx
  ON commercial_signal_opportunity_lineage (
    workspace_id, client_profile_id, organization_id, created_at DESC
  );
CREATE INDEX commercial_signal_opportunity_query_plans_plan_idx
  ON commercial_signal_opportunity_query_plans (
    workspace_id, client_profile_id, plan_snapshot_id, lineage_id
  );

CREATE OR REPLACE FUNCTION validate_commercial_signal_lineage()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  candidate_row opportunity_candidates%ROWTYPE;
  episode_row signal_episodes%ROWTYPE;
  opportunity_workspace BIGINT;
  opportunity_owner BIGINT;
  opportunity_profile BIGINT;
  opportunity_org BIGINT;
  opportunity_episode BIGINT;
BEGIN
  SELECT * INTO candidate_row
  FROM opportunity_candidates
  WHERE id = NEW.candidate_id;

  IF candidate_row.id IS NULL
     OR candidate_row.workspace_id <> NEW.workspace_id
     OR candidate_row.owner_id <> NEW.owner_id
     OR candidate_row.client_profile_id <> NEW.client_profile_id
     OR candidate_row.organization_id <> NEW.organization_id
     OR candidate_row.candidate_identity <> NEW.candidate_identity
     OR candidate_row.candidate_generation <> NEW.candidate_generation
     OR candidate_row.signal_episode_id <> NEW.signal_episode_id
     OR candidate_row.signal_episode_generation <> NEW.signal_episode_generation
     OR candidate_row.score_version <> NEW.score_version
     OR candidate_row.evidence_hash <> NEW.evidence_hash
     OR candidate_row.rollout_mode <> 'canary'
     OR candidate_row.status NOT IN (
       'qualified_actionable', 'qualified_needs_enrichment'
     ) THEN
    RAISE EXCEPTION 'commercial signal candidate lineage mismatch'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO episode_row
  FROM signal_episodes
  WHERE id = NEW.signal_episode_id
    AND organization_id = NEW.organization_id;

  IF episode_row.id IS NULL
     OR episode_row.episode_identity <> NEW.signal_episode_identity
     OR episode_row.episode_generation <> NEW.signal_episode_generation THEN
    RAISE EXCEPTION 'commercial signal episode lineage mismatch'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    workspace_id, owner_id, client_profile_id, organization_id, hiring_episode_id
  INTO
    opportunity_workspace, opportunity_owner, opportunity_profile,
    opportunity_org, opportunity_episode
  FROM opportunities
  WHERE id = NEW.opportunity_id;

  IF opportunity_workspace IS DISTINCT FROM NEW.workspace_id
     OR opportunity_owner IS DISTINCT FROM NEW.owner_id
     OR opportunity_profile IS DISTINCT FROM NEW.client_profile_id
     OR opportunity_org IS DISTINCT FROM NEW.organization_id
     OR opportunity_episode IS DISTINCT FROM NEW.compatibility_hiring_episode_id THEN
    RAISE EXCEPTION 'commercial signal opportunity lineage mismatch'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_commercial_signal_query_plan_lineage()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  lineage commercial_signal_opportunity_lineage%ROWTYPE;
BEGIN
  SELECT * INTO lineage
  FROM commercial_signal_opportunity_lineage
  WHERE id = NEW.lineage_id;

  IF lineage.id IS NULL
     OR lineage.workspace_id <> NEW.workspace_id
     OR lineage.client_profile_id <> NEW.client_profile_id THEN
    RAISE EXCEPTION 'commercial signal query-plan tenant mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM query_plan_source_execution_consumers consumer
    WHERE consumer.execution_id = NEW.execution_id
      AND consumer.plan_snapshot_id = NEW.plan_snapshot_id
      AND consumer.workspace_id = NEW.workspace_id
      AND consumer.client_profile_id = NEW.client_profile_id
  ) THEN
    RAISE EXCEPTION 'query-plan execution is not a consumer for this profile'
      USING ERRCODE = '23514';
  END IF;

  -- Exact proof: at least one signal produced by this execution must be a
  -- publication of a Company Event that belongs to the exact Signal Episode.
  IF NOT EXISTS (
    SELECT 1
    FROM query_plan_source_execution_signals execution_signal
    JOIN company_event_publications publication
      ON publication.signal_id = execution_signal.signal_id
     AND publication.organization_id = execution_signal.organization_id
    JOIN signal_episode_events episode_event
      ON episode_event.company_event_id = publication.company_event_id
     AND episode_event.organization_id = publication.organization_id
    WHERE execution_signal.execution_id = NEW.execution_id
      AND episode_event.signal_episode_id = lineage.signal_episode_id
      AND episode_event.organization_id = lineage.organization_id
  ) THEN
    RAISE EXCEPTION 'query-plan execution has no exact signal in opportunity episode'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION reject_commercial_signal_lineage_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER commercial_signal_opportunity_lineage_validate
BEFORE INSERT ON commercial_signal_opportunity_lineage
FOR EACH ROW EXECUTE FUNCTION validate_commercial_signal_lineage();
CREATE TRIGGER commercial_signal_opportunity_lineage_append_only
BEFORE UPDATE OR DELETE ON commercial_signal_opportunity_lineage
FOR EACH ROW EXECUTE FUNCTION reject_commercial_signal_lineage_mutation();
CREATE TRIGGER commercial_signal_opportunity_query_plans_validate
BEFORE INSERT ON commercial_signal_opportunity_query_plans
FOR EACH ROW EXECUTE FUNCTION validate_commercial_signal_query_plan_lineage();
CREATE TRIGGER commercial_signal_opportunity_query_plans_append_only
BEFORE UPDATE OR DELETE ON commercial_signal_opportunity_query_plans
FOR EACH ROW EXECUTE FUNCTION reject_commercial_signal_lineage_mutation();
CREATE TRIGGER query_plan_source_execution_consumers_append_only
BEFORE UPDATE OR DELETE ON query_plan_source_execution_consumers
FOR EACH ROW EXECUTE FUNCTION reject_commercial_signal_lineage_mutation();
CREATE TRIGGER query_plan_source_execution_signals_append_only
BEFORE UPDATE OR DELETE ON query_plan_source_execution_signals
FOR EACH ROW EXECUTE FUNCTION reject_commercial_signal_lineage_mutation();

-- ---------------------------------------------------------------------------
-- Safe enrichment queue. It stores corporate-surface categories, never scraped
-- personal contact values.
-- ---------------------------------------------------------------------------
CREATE TABLE commercial_signal_enrichment_queue (
  id BIGSERIAL PRIMARY KEY,
  lineage_id BIGINT NOT NULL UNIQUE
    REFERENCES commercial_signal_opportunity_lineage(id) ON DELETE CASCADE,
  workspace_id BIGINT NOT NULL,
  client_profile_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending',
  allowed_surface_types TEXT[] NOT NULL DEFAULT ARRAY[
    'careers_page',
    'corporate_contact_page',
    'hr_recruitment_function',
    'company_email',
    'generic_corporate_contact',
    'corporate_social_surface'
  ]::TEXT[],
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT commercial_signal_enrichment_queue_status_check
    CHECK (status IN ('pending', 'running', 'completed', 'blocked', 'expired')),
  CONSTRAINT commercial_signal_enrichment_queue_surfaces_check CHECK (
    allowed_surface_types <@ ARRAY[
      'careers_page',
      'corporate_contact_page',
      'hr_recruitment_function',
      'company_email',
      'generic_corporate_contact',
      'corporate_social_surface'
    ]::TEXT[]
    AND CARDINALITY(allowed_surface_types) > 0
  ),
  CONSTRAINT commercial_signal_enrichment_queue_attempt_check
    CHECK (attempt_count >= 0),
  CONSTRAINT commercial_signal_enrichment_queue_result_check CHECK (
    JSONB_TYPEOF(result_snapshot) = 'object'
    AND NOT result_snapshot ?| ARRAY[
      'personalEmail', 'personalPhone', 'privateProfile', 'contactValues'
    ]
  )
);

CREATE INDEX commercial_signal_enrichment_queue_ready_idx
  ON commercial_signal_enrichment_queue (
    status, next_attempt_at, workspace_id, client_profile_id
  )
  WHERE status IN ('pending', 'running');

CREATE OR REPLACE FUNCTION validate_commercial_signal_enrichment_queue()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  lineage commercial_signal_opportunity_lineage%ROWTYPE;
  candidate_status TEXT;
BEGIN
  SELECT * INTO lineage
  FROM commercial_signal_opportunity_lineage
  WHERE id = NEW.lineage_id;

  IF lineage.id IS NULL
     OR lineage.workspace_id <> NEW.workspace_id
     OR lineage.client_profile_id <> NEW.client_profile_id
     OR lineage.organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'enrichment queue lineage mismatch'
      USING ERRCODE = '23514';
  END IF;

  SELECT status INTO candidate_status
  FROM opportunity_candidates
  WHERE id = lineage.candidate_id;

  IF candidate_status <> 'qualified_needs_enrichment' THEN
    RAISE EXCEPTION 'only qualified_needs_enrichment may enter enrichment queue'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER commercial_signal_enrichment_queue_validate
BEFORE INSERT OR UPDATE OF lineage_id, workspace_id, client_profile_id, organization_id
ON commercial_signal_enrichment_queue
FOR EACH ROW EXECUTE FUNCTION validate_commercial_signal_enrichment_queue();

-- ---------------------------------------------------------------------------
-- Operator annotations and explicit validation state.
-- ---------------------------------------------------------------------------
CREATE TABLE commercial_signal_annotations (
  id BIGSERIAL PRIMARY KEY,
  lineage_id BIGINT NOT NULL
    REFERENCES commercial_signal_opportunity_lineage(id) ON DELETE RESTRICT,
  workspace_id BIGINT NOT NULL,
  client_profile_id BIGINT NOT NULL,
  reviewer_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  annotation_generation INTEGER NOT NULL,
  label TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  review_set TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT commercial_signal_annotations_unique
    UNIQUE (lineage_id, reviewer_user_id, annotation_generation),
  CONSTRAINT commercial_signal_annotations_generation_check
    CHECK (annotation_generation > 0),
  CONSTRAINT commercial_signal_annotations_label_check
    CHECK (label IN ('strong', 'acceptable', 'weak', 'not_a_lead')),
  CONSTRAINT commercial_signal_annotations_reason_check CHECK (
    reason_code IN (
      'ordinary_hiring', 'wrong_role', 'wrong_region', 'wrong_company_size',
      'weak_external_need', 'internal_only', 'bad_timing', 'bad_economics',
      'duplicate', 'stale', 'wrong_persona', 'no_safe_contact', 'other'
    )
  ),
  CONSTRAINT commercial_signal_annotations_review_set_check
    CHECK (review_set IN ('training', 'holdout', 'production_shadow', 'canary')),
  CONSTRAINT commercial_signal_annotations_note_check CHECK (
    (note IS NULL OR BTRIM(note) <> '')
    AND (reason_code <> 'other' OR note IS NOT NULL)
  )
);

CREATE INDEX commercial_signal_annotations_evaluation_idx
  ON commercial_signal_annotations (
    workspace_id, review_set, label, created_at DESC
  );

CREATE OR REPLACE FUNCTION validate_commercial_signal_annotation_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  lineage commercial_signal_opportunity_lineage%ROWTYPE;
BEGIN
  SELECT * INTO lineage
  FROM commercial_signal_opportunity_lineage
  WHERE id = NEW.lineage_id;

  IF lineage.id IS NULL
     OR lineage.workspace_id <> NEW.workspace_id
     OR lineage.client_profile_id <> NEW.client_profile_id THEN
    RAISE EXCEPTION 'annotation tenant scope mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM workspace_members membership
    WHERE membership.workspace_id = NEW.workspace_id
      AND membership.user_id = NEW.reviewer_user_id
      AND membership.status = 'active'
  ) THEN
    RAISE EXCEPTION 'annotation reviewer is not an active workspace member'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER commercial_signal_annotations_validate
BEFORE INSERT ON commercial_signal_annotations
FOR EACH ROW EXECUTE FUNCTION validate_commercial_signal_annotation_scope();
CREATE TRIGGER commercial_signal_annotations_append_only
BEFORE UPDATE OR DELETE ON commercial_signal_annotations
FOR EACH ROW EXECUTE FUNCTION reject_commercial_signal_lineage_mutation();

CREATE TABLE commercial_signal_validation_states (
  workspace_id BIGINT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  validation_status TEXT NOT NULL DEFAULT 'uncalibrated',
  changed_by_user_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note TEXT,
  CONSTRAINT commercial_signal_validation_states_status_check
    CHECK (validation_status IN (
      'uncalibrated', 'insufficient_sample', 'shadow_validated', 'canary_validated'
    )),
  CONSTRAINT commercial_signal_validation_states_note_check
    CHECK (note IS NULL OR BTRIM(note) <> '')
);

CREATE OR REPLACE FUNCTION guard_commercial_signal_validation_state()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  reviewed_count INTEGER;
  actionable_count INTEGER;
  holdout_count INTEGER;
  canary_outcome_count INTEGER;
BEGIN
  IF NEW.validation_status IN ('shadow_validated', 'canary_validated') THEN
    SELECT
      COUNT(*)::INTEGER,
      COUNT(*) FILTER (
        WHERE annotation.label IN ('strong', 'acceptable')
          AND candidate.status = 'qualified_actionable'
      )::INTEGER,
      COUNT(*) FILTER (WHERE annotation.review_set = 'holdout')::INTEGER
    INTO reviewed_count, actionable_count, holdout_count
    FROM commercial_signal_annotations annotation
    JOIN commercial_signal_opportunity_lineage lineage
      ON lineage.id = annotation.lineage_id
    JOIN opportunity_candidates candidate
      ON candidate.id = lineage.candidate_id
    WHERE annotation.workspace_id = NEW.workspace_id;

    IF reviewed_count < 100 OR actionable_count < 30 OR holdout_count = 0 THEN
      RAISE EXCEPTION
        'validation requires >=100 reviewed, >=30 acceptable/strong actionable and a holdout'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.validation_status = 'canary_validated' THEN
    SELECT COUNT(*)::INTEGER INTO canary_outcome_count
    FROM opportunity_outcome_events outcome
    JOIN commercial_signal_opportunity_lineage lineage
      ON lineage.opportunity_id = outcome.opportunity_id
    WHERE lineage.workspace_id = NEW.workspace_id
      AND outcome.event_type IN ('accepted', 'contacted', 'replied', 'meeting', 'won');

    IF canary_outcome_count = 0 THEN
      RAISE EXCEPTION 'canary validation requires at least one real canary outcome'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER commercial_signal_validation_states_guard
BEFORE INSERT OR UPDATE ON commercial_signal_validation_states
FOR EACH ROW EXECUTE FUNCTION guard_commercial_signal_validation_state();

-- ---------------------------------------------------------------------------
-- Outcome Ledger: freeze exact Commercial Signal lineage on every future event.
-- ---------------------------------------------------------------------------
ALTER TABLE opportunity_outcome_events
  ADD COLUMN commercial_signal_lineage_id BIGINT
    REFERENCES commercial_signal_opportunity_lineage(id) ON DELETE RESTRICT,
  ADD COLUMN commercial_signal_candidate_id BIGINT,
  ADD COLUMN commercial_signal_candidate_generation INTEGER,
  ADD COLUMN commercial_signal_episode_id BIGINT,
  ADD COLUMN commercial_signal_episode_generation INTEGER,
  ADD COLUMN commercial_signal_query_plan_snapshot_ids BIGINT[],
  ADD COLUMN commercial_signal_score_snapshot JSONB;

ALTER TABLE opportunity_outcome_events
  ADD CONSTRAINT opportunity_outcome_events_commercial_signal_generation_check CHECK (
    (commercial_signal_lineage_id IS NULL
      AND commercial_signal_candidate_id IS NULL
      AND commercial_signal_candidate_generation IS NULL
      AND commercial_signal_episode_id IS NULL
      AND commercial_signal_episode_generation IS NULL
      AND commercial_signal_query_plan_snapshot_ids IS NULL
      AND commercial_signal_score_snapshot IS NULL)
    OR
    (commercial_signal_lineage_id IS NOT NULL
      AND commercial_signal_candidate_id IS NOT NULL
      AND commercial_signal_candidate_generation > 0
      AND commercial_signal_episode_id IS NOT NULL
      AND commercial_signal_episode_generation > 0
      AND commercial_signal_query_plan_snapshot_ids IS NOT NULL
      AND commercial_signal_score_snapshot IS NOT NULL
      AND JSONB_TYPEOF(commercial_signal_score_snapshot) = 'object')
  );

CREATE OR REPLACE FUNCTION snapshot_commercial_signal_outcome_lineage()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  lineage commercial_signal_opportunity_lineage%ROWTYPE;
BEGIN
  SELECT * INTO lineage
  FROM commercial_signal_opportunity_lineage
  WHERE opportunity_id = NEW.opportunity_id;

  IF lineage.id IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.commercial_signal_lineage_id := lineage.id;
  NEW.commercial_signal_candidate_id := lineage.candidate_id;
  NEW.commercial_signal_candidate_generation := lineage.candidate_generation;
  NEW.commercial_signal_episode_id := lineage.signal_episode_id;
  NEW.commercial_signal_episode_generation := lineage.signal_episode_generation;
  NEW.commercial_signal_score_snapshot := lineage.score_snapshot;
  SELECT COALESCE(
    ARRAY_AGG(link.plan_snapshot_id ORDER BY link.plan_snapshot_id),
    ARRAY[]::BIGINT[]
  )
  INTO NEW.commercial_signal_query_plan_snapshot_ids
  FROM commercial_signal_opportunity_query_plans link
  WHERE link.lineage_id = lineage.id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER opportunity_outcome_events_snapshot_commercial_signal_lineage
BEFORE INSERT ON opportunity_outcome_events
FOR EACH ROW EXECUTE FUNCTION snapshot_commercial_signal_outcome_lineage();

-- Expand dismissal reasons without deleting the legacy vocabulary. The event
-- remains tenant scoped through its opportunity context.
ALTER TABLE opportunity_outcome_events
  DROP CONSTRAINT opportunity_outcome_events_reason_check;
ALTER TABLE opportunity_outcome_events
  ADD CONSTRAINT opportunity_outcome_events_reason_check
    CHECK (
      (
        event_type = 'dismissed'
        AND reason_code IS NOT NULL
        AND reason_code IN (
          'bad_fit', 'wrong_roles', 'wrong_industry', 'wrong_region',
          'company_too_small', 'company_too_large', 'low_commercial_value',
          'internal_recruitment_only', 'no_external_need_signal',
          'weak_evidence', 'duplicate', 'existing_client', 'do_not_contact',
          'wrong_timing',
          'ordinary_hiring', 'wrong_role', 'wrong_company_size',
          'weak_external_need', 'internal_only', 'bad_timing', 'bad_economics',
          'stale', 'wrong_persona', 'no_safe_contact', 'other'
        )
      )
      OR (
        event_type = 'lost'
        AND reason_code IS NOT NULL
        AND reason_code IN (
          'no_response', 'not_interested', 'wrong_timing', 'internal_team',
          'existing_supplier', 'price', 'no_budget', 'procurement_block',
          'requirements_changed', 'position_closed', 'competitor_won',
          'contact_unreachable', 'other'
        )
      )
      OR (event_type NOT IN ('dismissed', 'lost') AND reason_code IS NULL)
    );

COMMENT ON TABLE commercial_signal_opportunity_lineage IS
  'Immutable exact bridge from one Opportunity Scoring v3 candidate generation to the one workflow opportunity shown to a workspace.';
COMMENT ON TABLE commercial_signal_opportunity_query_plans IS
  'Exact source-query lineage; inserts are rejected unless an attributed execution signal participates in the exact Signal Episode.';
COMMENT ON TABLE commercial_signal_enrichment_queue IS
  'Corporate-surface-only enrichment queue for qualified opportunities missing a safe contact path.';
COMMENT ON TABLE commercial_signal_annotations IS
  'Tenant-scoped human review labels used for real evaluation and holdout comparisons.';

COMMIT;
