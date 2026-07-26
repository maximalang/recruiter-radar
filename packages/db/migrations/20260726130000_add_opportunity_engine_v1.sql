BEGIN;

-- Opportunity Engine v1 is additive and intentionally contains no data backfill.
-- The application remains dark unless OPPORTUNITY_ENGINE_V1_ENABLED=true.

CREATE UNIQUE INDEX signals_id_org_uidx
  ON signals (id, org_id);

CREATE UNIQUE INDEX evidence_items_id_org_uidx
  ON evidence_items (id, org_id);

CREATE UNIQUE INDEX client_profiles_id_owner_uidx
  ON client_profiles (id, owner_id);

CREATE TABLE hiring_episodes (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  episode_type TEXT NOT NULL,
  episode_key TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  signal_count INTEGER NOT NULL,
  vacancy_count INTEGER NOT NULL,
  strength_score DOUBLE PRECISION NOT NULL,
  freshness_score DOUBLE PRECISION NOT NULL,
  evidence_hash TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT hiring_episodes_id_organization_unique
    UNIQUE (id, organization_id),
  CONSTRAINT hiring_episodes_dedupe_unique
    UNIQUE (organization_id, episode_key, engine_version),
  CONSTRAINT hiring_episodes_type_check
    CHECK (
      episode_type IN (
        'vacancy_spike',
        'repeated_vacancies',
        'new_role_cluster',
        'new_region',
        'hiring_restart',
        'sustained_hiring'
      )
    ),
  CONSTRAINT hiring_episodes_status_check
    CHECK (status IN ('active', 'closed')),
  CONSTRAINT hiring_episodes_title_not_blank CHECK (BTRIM(title) <> ''),
  CONSTRAINT hiring_episodes_summary_not_blank CHECK (BTRIM(summary) <> ''),
  CONSTRAINT hiring_episodes_episode_key_not_blank CHECK (BTRIM(episode_key) <> ''),
  CONSTRAINT hiring_episodes_engine_version_not_blank CHECK (BTRIM(engine_version) <> ''),
  CONSTRAINT hiring_episodes_signal_count_check CHECK (signal_count > 0),
  CONSTRAINT hiring_episodes_vacancy_count_check CHECK (vacancy_count > 0),
  CONSTRAINT hiring_episodes_strength_score_check
    CHECK (strength_score BETWEEN 0 AND 1),
  CONSTRAINT hiring_episodes_freshness_score_check
    CHECK (freshness_score BETWEEN 0 AND 1),
  CONSTRAINT hiring_episodes_evidence_hash_format
    CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT hiring_episodes_window_check CHECK (last_seen_at >= started_at),
  CONSTRAINT hiring_episodes_closed_at_check
    CHECK (
      (status = 'closed' AND closed_at IS NOT NULL)
      OR (status = 'active' AND closed_at IS NULL)
    )
);

CREATE TABLE hiring_episode_evidence (
  id BIGSERIAL PRIMARY KEY,
  hiring_episode_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  signal_id BIGINT,
  evidence_id BIGINT,
  relation_type TEXT NOT NULL DEFAULT 'supporting',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT hiring_episode_evidence_episode_fkey
    FOREIGN KEY (hiring_episode_id, organization_id)
    REFERENCES hiring_episodes(id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT hiring_episode_evidence_signal_fkey
    FOREIGN KEY (signal_id, organization_id)
    REFERENCES signals(id, org_id)
    ON DELETE CASCADE,
  CONSTRAINT hiring_episode_evidence_item_fkey
    FOREIGN KEY (evidence_id, organization_id)
    REFERENCES evidence_items(id, org_id)
    ON DELETE CASCADE,
  CONSTRAINT hiring_episode_evidence_reference_check
    CHECK (signal_id IS NOT NULL OR evidence_id IS NOT NULL),
  CONSTRAINT hiring_episode_evidence_relation_check
    CHECK (relation_type IN ('source', 'supporting')),
  CONSTRAINT hiring_episode_evidence_signal_unique
    UNIQUE (hiring_episode_id, signal_id),
  CONSTRAINT hiring_episode_evidence_item_unique
    UNIQUE (hiring_episode_id, evidence_id)
);

CREATE TABLE opportunities (
  id BIGSERIAL PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_profile_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  hiring_episode_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  title TEXT NOT NULL,
  why_now TEXT NOT NULL,
  problem_hypothesis TEXT NOT NULL,
  recommended_angle TEXT NOT NULL,
  recommended_persona TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  agency_fit_score DOUBLE PRECISION NOT NULL,
  hiring_intent_score DOUBLE PRECISION NOT NULL,
  agency_propensity_score DOUBLE PRECISION NOT NULL,
  timing_score DOUBLE PRECISION NOT NULL,
  reachability_score DOUBLE PRECISION NOT NULL,
  confidence_score DOUBLE PRECISION NOT NULL,
  opportunity_score DOUBLE PRECISION NOT NULL,
  confidence_gate TEXT NOT NULL,
  scoring_version TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  valid_until TIMESTAMPTZ,
  snoozed_until TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT opportunities_id_owner_unique UNIQUE (id, owner_id),
  CONSTRAINT opportunities_dedupe_unique
    UNIQUE (client_profile_id, hiring_episode_id, scoring_version),
  CONSTRAINT opportunities_profile_owner_fkey
    FOREIGN KEY (client_profile_id, owner_id)
    REFERENCES client_profiles(id, owner_id)
    ON DELETE CASCADE,
  CONSTRAINT opportunities_episode_organization_fkey
    FOREIGN KEY (hiring_episode_id, organization_id)
    REFERENCES hiring_episodes(id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT opportunities_status_check
    CHECK (
      status IN (
        'new',
        'review',
        'accepted',
        'dismissed',
        'snoozed',
        'contacted',
        'expired'
      )
    ),
  CONSTRAINT opportunities_confidence_gate_check
    CHECK (confidence_gate IN ('A', 'B', 'C', 'D')),
  CONSTRAINT opportunities_title_not_blank CHECK (BTRIM(title) <> ''),
  CONSTRAINT opportunities_why_now_not_blank CHECK (BTRIM(why_now) <> ''),
  CONSTRAINT opportunities_problem_hypothesis_not_blank
    CHECK (BTRIM(problem_hypothesis) <> ''),
  CONSTRAINT opportunities_recommended_angle_not_blank
    CHECK (BTRIM(recommended_angle) <> ''),
  CONSTRAINT opportunities_recommended_persona_not_blank
    CHECK (BTRIM(recommended_persona) <> ''),
  CONSTRAINT opportunities_recommended_action_not_blank
    CHECK (BTRIM(recommended_action) <> ''),
  CONSTRAINT opportunities_scoring_version_not_blank
    CHECK (BTRIM(scoring_version) <> ''),
  CONSTRAINT opportunities_evidence_hash_format
    CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT opportunities_agency_fit_score_check
    CHECK (agency_fit_score BETWEEN 0 AND 1),
  CONSTRAINT opportunities_hiring_intent_score_check
    CHECK (hiring_intent_score BETWEEN 0 AND 1),
  CONSTRAINT opportunities_agency_propensity_score_check
    CHECK (agency_propensity_score BETWEEN 0 AND 1),
  CONSTRAINT opportunities_timing_score_check
    CHECK (timing_score BETWEEN 0 AND 1),
  CONSTRAINT opportunities_reachability_score_check
    CHECK (reachability_score BETWEEN 0 AND 1),
  CONSTRAINT opportunities_confidence_score_check
    CHECK (confidence_score BETWEEN 0 AND 1),
  CONSTRAINT opportunities_opportunity_score_check
    CHECK (opportunity_score BETWEEN 0 AND 1),
  CONSTRAINT opportunities_snoozed_until_check
    CHECK (snoozed_until IS NULL OR snoozed_until > created_at)
);

CREATE TABLE opportunity_actions (
  id BIGSERIAL PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id BIGINT NOT NULL,
  action_type TEXT NOT NULL,
  action_key TEXT NOT NULL,
  note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT opportunity_actions_opportunity_owner_fkey
    FOREIGN KEY (opportunity_id, owner_id)
    REFERENCES opportunities(id, owner_id)
    ON DELETE CASCADE,
  CONSTRAINT opportunity_actions_type_check
    CHECK (action_type IN ('accepted', 'dismissed', 'snoozed', 'contacted')),
  CONSTRAINT opportunity_actions_key_not_blank CHECK (BTRIM(action_key) <> ''),
  CONSTRAINT opportunity_actions_note_not_blank
    CHECK (note IS NULL OR BTRIM(note) <> ''),
  CONSTRAINT opportunity_actions_dedupe_unique
    UNIQUE (opportunity_id, action_key)
);

CREATE INDEX hiring_episodes_active_last_seen_idx
  ON hiring_episodes (last_seen_at DESC, id DESC)
  WHERE status = 'active';

CREATE INDEX hiring_episodes_organization_status_idx
  ON hiring_episodes (organization_id, status, last_seen_at DESC);

CREATE INDEX hiring_episode_evidence_episode_created_idx
  ON hiring_episode_evidence (hiring_episode_id, created_at ASC);

CREATE INDEX opportunities_owner_status_score_idx
  ON opportunities (
    owner_id,
    status,
    opportunity_score DESC,
    valid_until ASC,
    id DESC
  );

CREATE INDEX opportunities_profile_status_score_idx
  ON opportunities (
    client_profile_id,
    status,
    opportunity_score DESC,
    id DESC
  );

CREATE INDEX opportunities_episode_idx
  ON opportunities (hiring_episode_id, id);

CREATE INDEX opportunities_valid_until_idx
  ON opportunities (valid_until ASC)
  WHERE status IN ('new', 'review', 'snoozed');

CREATE INDEX opportunity_actions_owner_created_idx
  ON opportunity_actions (owner_id, created_at DESC, id DESC);

CREATE INDEX digest_candidates_client_profile_org_created_idx
  ON digest_candidates (
    client_profile_id,
    org_id,
    created_at DESC,
    id DESC
  );

CREATE TRIGGER hiring_episodes_set_updated_at
BEFORE UPDATE ON hiring_episodes
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER opportunities_set_updated_at
BEFORE UPDATE ON opportunities
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;
