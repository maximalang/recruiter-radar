BEGIN;

CREATE OR REPLACE FUNCTION opportunity_candidate_reasons_valid(items JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT COALESCE(
    JSONB_TYPEOF(items) = 'array'
    AND NOT EXISTS (
      SELECT 1
      FROM JSONB_ARRAY_ELEMENTS(
        CASE WHEN JSONB_TYPEOF(items) = 'array' THEN items ELSE '[]'::JSONB END
      ) AS item
      WHERE JSONB_TYPEOF(item) <> 'object'
         OR COALESCE(item->>'code', '') !~ '^[A-Z][A-Z0-9_]{1,63}$'
         OR BTRIM(COALESCE(item->>'message', '')) = ''
         OR COALESCE(item->>'basis', '') NOT IN (
              'evidence', 'agency_profile', 'organization_record',
              'policy', 'enrichment'
            )
         OR JSONB_TYPEOF(item->'contribution') IS DISTINCT FROM 'number'
         OR NOT agency_dna_match_json_text_array_valid(item->'evidenceIds')
         OR EXISTS (
              SELECT 1
              FROM JSONB_ARRAY_ELEMENTS(item->'evidenceIds') AS evidence_id
              WHERE evidence_id #>> '{}' !~ '^[1-9][0-9]*$'
            )
    ),
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION opportunity_candidate_components_valid(
  components JSONB,
  expected_keys TEXT[]
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT COALESCE(
    JSONB_TYPEOF(components) = 'object'
    AND ARRAY(
      SELECT key FROM JSONB_OBJECT_KEYS(components) AS key ORDER BY key
    ) = ARRAY(
      SELECT key FROM UNNEST(expected_keys) AS key ORDER BY key
    )
    AND NOT EXISTS (
      SELECT 1
      FROM JSONB_EACH(components) AS component(key, value)
      WHERE JSONB_TYPEOF(value) <> 'object'
         OR JSONB_TYPEOF(value->'score') IS DISTINCT FROM 'number'
         OR (value->>'score')::NUMERIC NOT BETWEEN 0 AND 1
         OR NOT opportunity_candidate_reasons_valid(value->'reasons')
    ),
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION opportunity_candidate_hard_gates_valid(items JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT COALESCE(
    JSONB_TYPEOF(items) = 'array'
    AND JSONB_ARRAY_LENGTH(items) = 9
    AND NOT EXISTS (
      SELECT 1
      FROM JSONB_ARRAY_ELEMENTS(items) AS item
      WHERE JSONB_TYPEOF(item) <> 'object'
         OR COALESCE(item->>'code', '') NOT IN (
              'ORGANIZATION_IDENTITY_UNVERIFIED',
              'ADMISSIBLE_EVIDENCE_MISSING',
              'COMPANY_STATE_CHANGE_UNCONFIRMED',
              'EPISODE_NOT_ACTIVE',
              'PROFILE_EXCLUSION',
              'ACCOUNT_RESTRICTION_BLOCKED',
              'AGENCY_FIT_BELOW_THRESHOLD',
              'EXTERNAL_AGENCY_PROPENSITY_BELOW_THRESHOLD',
              'ECONOMICS_CONTRADICTS_AGENCY'
            )
         OR JSONB_TYPEOF(item->'passed') IS DISTINCT FROM 'boolean'
         OR BTRIM(COALESCE(item->>'message', '')) = ''
         OR COALESCE(item->>'basis', '') NOT IN (
              'evidence', 'agency_profile', 'organization_record', 'policy'
            )
         OR NOT agency_dna_match_json_text_array_valid(item->'evidenceIds')
    )
    AND (
      SELECT COUNT(DISTINCT item->>'code')
      FROM JSONB_ARRAY_ELEMENTS(items) AS item
    ) = 9,
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION opportunity_candidate_features_valid(features JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT COALESCE(
    JSONB_TYPEOF(features) = 'object'
    AND JSONB_TYPEOF(features->'source') = 'object'
    AND JSONB_TYPEOF(features->'quality') = 'object'
    AND JSONB_TYPEOF(features->'actionability') = 'object'
    AND JSONB_TYPEOF(features->'rollout') = 'object'
    AND JSONB_TYPEOF(
      features #> '{actionability,corporateContactPathCategories}'
    ) = 'array'
    AND NOT EXISTS (
      SELECT 1
      FROM JSONB_ARRAY_ELEMENTS(
        features #> '{actionability,corporateContactPathCategories}'
      ) AS category
      WHERE JSONB_TYPEOF(category) <> 'string'
         OR category #>> '{}' NOT IN (
              'hr-email', 'careers-email', 'generic-email',
              'contact-form', 'career-page'
            )
    )
    AND agency_dna_match_json_text_array_valid(
      features #> '{actionability,decisionMakerFunctions}'
    )
    AND NOT (features->'actionability' ? 'contactValues')
    AND NOT (features->'quality' ? 'reachability')
    AND NOT (features->'quality' ? 'commercialValue')
    AND COALESCE(features #>> '{rollout,mode}', '') IN ('shadow', 'canary')
    AND COALESCE(features #>> '{rollout,fallbackScoringVersion}', '')
      ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$',
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION opportunity_candidate_evidence_snapshot_valid(
  snapshot JSONB
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT COALESCE(
    JSONB_TYPEOF(snapshot) = 'object'
    AND agency_dna_match_json_text_array_valid(snapshot->'evidenceIds')
    AND agency_dna_match_json_text_array_valid(snapshot->'evidenceSourceFamilies')
    AND COALESCE(snapshot->>'directEvidenceCount', '') ~ '^[0-9]+$'
    AND COALESCE(snapshot->>'corroborationEvidenceCount', '') ~ '^[0-9]+$',
    FALSE
  );
$$;

CREATE TABLE opportunity_candidates (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT,
  workspace_id BIGINT NOT NULL,
  owner_id BIGINT NOT NULL,
  client_profile_id BIGINT NOT NULL,
  agency_dna_match_snapshot_id BIGINT NOT NULL,
  agency_dna_match_generation INTEGER NOT NULL,
  propensity_snapshot_id BIGINT NOT NULL,
  propensity_generation INTEGER NOT NULL,
  commercial_thesis_id BIGINT NOT NULL,
  commercial_thesis_generation INTEGER NOT NULL,
  signal_episode_id BIGINT NOT NULL,
  signal_episode_generation INTEGER NOT NULL,
  company_state_snapshot_id BIGINT NOT NULL,
  candidate_identity TEXT NOT NULL,
  candidate_generation INTEGER NOT NULL,
  opportunity_mode TEXT NOT NULL,
  raw_quality_score NUMERIC(6, 5) NOT NULL,
  quality_score NUMERIC(6, 5) NOT NULL,
  actionability_score NUMERIC(6, 5) NOT NULL,
  ranking_score NUMERIC(6, 5) NOT NULL,
  status TEXT NOT NULL,
  legacy_status_projection TEXT NOT NULL,
  quality_components JSONB NOT NULL,
  actionability_components JSONB NOT NULL,
  hard_gates JSONB NOT NULL,
  reasons JSONB NOT NULL,
  feature_snapshot JSONB NOT NULL,
  evidence_snapshot JSONB NOT NULL,
  evidence_hash TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  score_version TEXT NOT NULL,
  feature_schema_version TEXT NOT NULL,
  gate_version TEXT NOT NULL,
  rollout_mode TEXT NOT NULL,
  fallback_scoring_version TEXT NOT NULL,
  model_type TEXT NOT NULL,
  calibration_status TEXT NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT opportunity_candidates_id_scope_unique
    UNIQUE (id, organization_id, workspace_id, client_profile_id),
  CONSTRAINT opportunity_candidates_profile_scope_fkey
    FOREIGN KEY (client_profile_id, owner_id, workspace_id)
    REFERENCES client_profiles(id, owner_id, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT opportunity_candidates_match_scope_fkey
    FOREIGN KEY (
      agency_dna_match_snapshot_id,
      organization_id,
      workspace_id,
      client_profile_id
    )
    REFERENCES agency_dna_match_snapshots(
      id,
      organization_id,
      workspace_id,
      client_profile_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT opportunity_candidates_propensity_scope_fkey
    FOREIGN KEY (
      propensity_snapshot_id,
      organization_id,
      workspace_id,
      client_profile_id
    )
    REFERENCES external_agency_propensity_snapshots(
      id,
      organization_id,
      workspace_id,
      client_profile_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT opportunity_candidates_thesis_fkey
    FOREIGN KEY (commercial_thesis_id, organization_id)
    REFERENCES commercial_theses(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT opportunity_candidates_episode_fkey
    FOREIGN KEY (signal_episode_id, organization_id)
    REFERENCES signal_episodes(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT opportunity_candidates_state_fkey
    FOREIGN KEY (company_state_snapshot_id, organization_id)
    REFERENCES company_state_snapshots(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT opportunity_candidates_identity_generation_unique
    UNIQUE (
      workspace_id,
      client_profile_id,
      organization_id,
      score_version,
      candidate_identity,
      candidate_generation
    ),
  CONSTRAINT opportunity_candidates_input_unique
    UNIQUE (
      workspace_id,
      client_profile_id,
      organization_id,
      score_version,
      input_hash
    ),
  CONSTRAINT opportunity_candidates_generations_check CHECK (
    agency_dna_match_generation > 0
    AND propensity_generation > 0
    AND commercial_thesis_generation > 0
    AND signal_episode_generation > 0
    AND candidate_generation > 0
  ),
  CONSTRAINT opportunity_candidates_identity_check
    CHECK (candidate_identity ~ '^[a-f0-9]{64}$'),
  CONSTRAINT opportunity_candidates_scores_check CHECK (
    raw_quality_score BETWEEN 0 AND 1
    AND quality_score BETWEEN 0 AND 1
    AND actionability_score BETWEEN 0 AND 1
    AND ranking_score BETWEEN 0 AND 1
    AND quality_score <= raw_quality_score
    AND ranking_score = quality_score
  ),
  CONSTRAINT opportunity_candidates_mode_check
    CHECK (opportunity_mode IN ('find', 'grow', 'reactivate', 'blocked')),
  CONSTRAINT opportunity_candidates_status_check CHECK (
    status IN (
      'qualified_actionable', 'qualified_needs_enrichment', 'review',
      'blocked', 'expired', 'dismissed'
    )
  ),
  CONSTRAINT opportunity_candidates_legacy_status_check
    CHECK (legacy_status_projection IN ('new', 'review', 'dismissed')),
  CONSTRAINT opportunity_candidates_legacy_projection_check CHECK (
    legacy_status_projection = CASE
      WHEN status = 'qualified_actionable' THEN 'new'
      WHEN status IN ('qualified_needs_enrichment', 'review') THEN 'review'
      ELSE 'dismissed'
    END
  ),
  CONSTRAINT opportunity_candidates_quality_components_check CHECK (
    opportunity_candidate_components_valid(
      quality_components,
      ARRAY[
        'agencyFit', 'externalAgencyPropensity', 'timing',
        'economics', 'evidenceConfidence'
      ]::TEXT[]
    )
  ),
  CONSTRAINT opportunity_candidates_actionability_components_check CHECK (
    opportunity_candidate_components_valid(
      actionability_components,
      ARRAY[
        'corporateContactPath', 'decisionMakerFunction', 'accountAccess',
        'contactPolicy', 'enrichmentCompleteness'
      ]::TEXT[]
    )
  ),
  CONSTRAINT opportunity_candidates_hard_gates_check
    CHECK (opportunity_candidate_hard_gates_valid(hard_gates)),
  CONSTRAINT opportunity_candidates_reasons_check
    CHECK (opportunity_candidate_reasons_valid(reasons)),
  CONSTRAINT opportunity_candidates_features_check
    CHECK (opportunity_candidate_features_valid(feature_snapshot)),
  CONSTRAINT opportunity_candidates_evidence_snapshot_check
    CHECK (opportunity_candidate_evidence_snapshot_valid(evidence_snapshot)),
  CONSTRAINT opportunity_candidates_hashes_check CHECK (
    evidence_hash ~ '^[a-f0-9]{64}$'
    AND input_hash ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT opportunity_candidates_score_version_check
    CHECK (score_version = 'opportunity-v3'),
  CONSTRAINT opportunity_candidates_feature_schema_check
    CHECK (feature_schema_version = 'opportunity-quality-features-v3'),
  CONSTRAINT opportunity_candidates_gate_version_check
    CHECK (gate_version = 'opportunity-quality-gates-v3'),
  CONSTRAINT opportunity_candidates_rollout_check
    CHECK (rollout_mode IN ('shadow', 'canary')),
  CONSTRAINT opportunity_candidates_fallback_check
    CHECK (fallback_scoring_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  CONSTRAINT opportunity_candidates_model_check
    CHECK (model_type = 'heuristic' AND calibration_status = 'uncalibrated')
);

CREATE TABLE opportunity_candidate_evidence (
  candidate_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  workspace_id BIGINT NOT NULL,
  client_profile_id BIGINT NOT NULL,
  evidence_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT opportunity_candidate_evidence_candidate_fkey
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
    ON DELETE CASCADE,
  CONSTRAINT opportunity_candidate_evidence_item_fkey
    FOREIGN KEY (evidence_id, organization_id)
    REFERENCES evidence_items(id, org_id)
    ON DELETE RESTRICT,
  CONSTRAINT opportunity_candidate_evidence_unique
    UNIQUE (candidate_id, evidence_id)
);

CREATE INDEX opportunity_candidates_current_idx
  ON opportunity_candidates (
    workspace_id,
    client_profile_id,
    organization_id,
    score_version,
    candidate_identity,
    candidate_generation DESC
  );
CREATE INDEX opportunity_candidates_status_idx
  ON opportunity_candidates (
    workspace_id,
    client_profile_id,
    status,
    ranking_score DESC,
    valid_until DESC
  );
CREATE INDEX opportunity_candidates_match_idx
  ON opportunity_candidates (agency_dna_match_snapshot_id, score_version);
CREATE INDEX opportunity_candidate_evidence_item_idx
  ON opportunity_candidate_evidence (
    evidence_id,
    organization_id,
    workspace_id
  );

CREATE OR REPLACE FUNCTION reject_opportunity_candidate_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'opportunity candidate records are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION validate_opportunity_candidate_generation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  expected_generation INTEGER;
BEGIN
  PERFORM PG_ADVISORY_XACT_LOCK(HASHTEXTEXTENDED(
    NEW.workspace_id::TEXT || ':' || NEW.client_profile_id::TEXT || ':' ||
    NEW.organization_id::TEXT || ':' || NEW.score_version || ':' ||
    NEW.candidate_identity,
    0
  ));

  SELECT COALESCE(MAX(candidate_generation), 0) + 1
  INTO expected_generation
  FROM opportunity_candidates
  WHERE workspace_id = NEW.workspace_id
    AND client_profile_id = NEW.client_profile_id
    AND organization_id = NEW.organization_id
    AND score_version = NEW.score_version
    AND candidate_identity = NEW.candidate_identity;

  IF NEW.candidate_generation <> expected_generation THEN
    RAISE EXCEPTION 'opportunity candidate generation must append exactly once'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_opportunity_candidate_source()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM agency_dna_match_snapshots match
    JOIN external_agency_propensity_snapshots propensity
      ON propensity.id = match.propensity_snapshot_id
     AND propensity.organization_id = match.organization_id
     AND propensity.workspace_id = match.workspace_id
     AND propensity.client_profile_id = match.client_profile_id
    JOIN commercial_theses thesis
      ON thesis.id = propensity.commercial_thesis_id
     AND thesis.organization_id = propensity.organization_id
    JOIN signal_episodes episode
      ON episode.id = thesis.signal_episode_id
     AND episode.organization_id = thesis.organization_id
    JOIN signal_episode_state_changes episode_state
      ON episode_state.signal_episode_id = episode.id
     AND episode_state.organization_id = episode.organization_id
    JOIN company_state_changes state_change
      ON state_change.id = episode_state.company_state_change_id
     AND state_change.organization_id = episode_state.organization_id
    JOIN company_state_snapshots state_snapshot
      ON state_snapshot.id = state_change.snapshot_id
     AND state_snapshot.organization_id = state_change.organization_id
    JOIN client_profiles profile
      ON profile.id = match.client_profile_id
     AND profile.owner_id = match.owner_id
     AND profile.workspace_id = match.workspace_id
    JOIN orgs org ON org.id = match.organization_id
    WHERE match.id = NEW.agency_dna_match_snapshot_id
      AND match.organization_id = NEW.organization_id
      AND match.workspace_id = NEW.workspace_id
      AND match.owner_id = NEW.owner_id
      AND match.client_profile_id = NEW.client_profile_id
      AND match.match_generation = NEW.agency_dna_match_generation
      AND match.propensity_snapshot_id = NEW.propensity_snapshot_id
      AND match.propensity_generation = NEW.propensity_generation
      AND match.evidence_hash = NEW.evidence_hash
      AND propensity.id = NEW.propensity_snapshot_id
      AND propensity.propensity_generation = NEW.propensity_generation
      AND propensity.commercial_thesis_id = NEW.commercial_thesis_id
      AND propensity.commercial_thesis_generation =
        NEW.commercial_thesis_generation
      AND thesis.id = NEW.commercial_thesis_id
      AND thesis.thesis_generation = NEW.commercial_thesis_generation
      AND thesis.signal_episode_id = NEW.signal_episode_id
      AND thesis.signal_episode_generation = NEW.signal_episode_generation
      AND episode.id = NEW.signal_episode_id
      AND episode.episode_generation = NEW.signal_episode_generation
      AND state_change.snapshot_id = NEW.company_state_snapshot_id
      AND NEW.feature_snapshot #>> '{source,agencyDnaMatchSnapshotId}' =
        match.id::TEXT
      AND (NEW.feature_snapshot #>>
        '{source,agencyDnaMatchGeneration}')::INTEGER = match.match_generation
      AND NEW.feature_snapshot #>> '{source,agencyDnaMatchIdentity}' =
        match.match_identity
      AND NEW.feature_snapshot #>> '{source,agencyDnaMatchInputHash}' =
        match.input_hash
      AND NEW.feature_snapshot #>> '{source,propensitySnapshotId}' =
        propensity.id::TEXT
      AND (NEW.feature_snapshot #>>
        '{source,propensityGeneration}')::INTEGER = propensity.propensity_generation
      AND NEW.feature_snapshot #>> '{source,commercialThesisId}' = thesis.id::TEXT
      AND (NEW.feature_snapshot #>>
        '{source,commercialThesisGeneration}')::INTEGER = thesis.thesis_generation
      AND NEW.feature_snapshot #>> '{source,signalEpisodeId}' = episode.id::TEXT
      AND (NEW.feature_snapshot #>>
        '{source,signalEpisodeGeneration}')::INTEGER = episode.episode_generation
      AND NEW.feature_snapshot #>> '{source,companyStateSnapshotId}' =
        state_snapshot.id::TEXT
      AND (NEW.feature_snapshot #>> '{source,agencyDnaVersion}')::BIGINT =
        match.agency_dna_version
      AND NEW.feature_snapshot #>> '{source,agencyDnaSnapshotHash}' =
        match.agency_dna_snapshot_hash
      AND (NEW.feature_snapshot #>>
        '{quality,organizationIdentityVerified}')::BOOLEAN = (
          NULLIF(BTRIM(org.inn), '') IS NOT NULL
          OR NULLIF(BTRIM(org.ogrn), '') IS NOT NULL
          OR NULLIF(BTRIM(org.domain), '') IS NOT NULL
          OR NULLIF(BTRIM(org.website_url), '') IS NOT NULL
          OR NULLIF(BTRIM(org.career_page_url), '') IS NOT NULL
        )
      AND (NEW.feature_snapshot #>>
        '{quality,stateChangeConfirmed}')::BOOLEAN = TRUE
      AND (NEW.feature_snapshot #>> '{quality,companyStateConfidence}')::NUMERIC =
        state_snapshot.state_confidence
      AND NEW.feature_snapshot #>> '{quality,episodeStage}' = episode.stage
      AND (NEW.feature_snapshot #>> '{quality,episodeIntensity}')::NUMERIC =
        episode.intensity
      AND (NEW.feature_snapshot #>> '{quality,episodeLastSeenAt}')::TIMESTAMPTZ =
        episode.last_seen_at
      AND (NEW.feature_snapshot #>> '{quality,episodeValidUntil}')::TIMESTAMPTZ =
        episode.valid_until
      AND NEW.valid_until = episode.valid_until
      AND (NEW.feature_snapshot #>> '{quality,agencyFitScore}')::NUMERIC =
        match.fit_score
      AND (NEW.feature_snapshot #>> '{quality,agencyFitCoverage}')::NUMERIC =
        match.coverage
      AND (NEW.feature_snapshot #>> '{quality,minimumAgencyFitScore}')::NUMERIC =
        (match.selection_policy->>'minimumFitScore')::NUMERIC
      AND (NEW.feature_snapshot #>>
        '{quality,minimumAgencyFitCoverage}')::NUMERIC =
        (match.selection_policy->>'minimumCoverage')::NUMERIC
      AND (NEW.feature_snapshot #>> '{quality,propensityScore}')::NUMERIC =
        propensity.score
      AND NEW.feature_snapshot #>> '{quality,propensityLevel}' = propensity.level
      AND NEW.feature_snapshot #>> '{quality,economicsOutcome}' =
        match.dimensions #>> '{economics,outcome}'
      AND NEW.feature_snapshot #>> '{quality,currentCapacity}' =
        match.selection_policy->>'capacity'
      AND (NEW.feature_snapshot #>> '{quality,minimumQualityScore}')::NUMERIC =
        CASE WHEN match.selection_policy->>'capacity' = 'low'
          THEN 0.75 ELSE 0.62 END
      AND NEW.feature_snapshot #>> '{actionability,contactPolicy}' =
        profile.contact_policy::TEXT
      AND NEW.feature_snapshot #> '{actionability,decisionMakerFunctions}' =
        COALESCE((
          SELECT JSONB_AGG(code ORDER BY code)
          FROM (
            SELECT DISTINCT REPLACE(
              LOWER(BTRIM(persona->>'code')), '_', '-'
            ) AS code
            FROM JSONB_ARRAY_ELEMENTS(thesis.recommended_persona) AS persona
            WHERE BTRIM(COALESCE(persona->>'code', '')) <> ''
          ) persona_codes
        ), '[]'::JSONB)
      AND NEW.feature_snapshot #>
        '{actionability,corporateContactPathCategories}' = COALESCE((
          SELECT JSONB_AGG(category ORDER BY category)
          FROM (
            SELECT DISTINCT LOWER(BTRIM(path->>'category')) AS category
            FROM signal_episode_events episode_event
            JOIN company_event_publications publication
              ON publication.company_event_id = episode_event.company_event_id
             AND publication.organization_id = episode_event.organization_id
            CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(
              CASE
                WHEN JSONB_TYPEOF(publication.source_snapshot->'contact_paths')
                  = 'array'
                THEN publication.source_snapshot->'contact_paths'
                ELSE '[]'::JSONB
              END
            ) AS path
            WHERE episode_event.signal_episode_id = episode.id
              AND episode_event.organization_id = episode.organization_id
              AND LOWER(BTRIM(path->>'category')) IN (
                'hr-email', 'careers-email', 'generic-email', 'contact-form'
              )
            UNION
            SELECT 'career-page'
            WHERE NULLIF(BTRIM(org.career_page_url), '') IS NOT NULL
          ) safe_categories
        ), '[]'::JSONB)
  ) THEN
    RAISE EXCEPTION 'opportunity candidate source lineage mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM agency_dna_match_snapshots match
    JOIN agency_dna_match_snapshots newer_match
      ON newer_match.organization_id = match.organization_id
     AND newer_match.workspace_id = match.workspace_id
     AND newer_match.client_profile_id = match.client_profile_id
     AND newer_match.feature_version = match.feature_version
     AND newer_match.match_identity = match.match_identity
     AND newer_match.match_generation > match.match_generation
    WHERE match.id = NEW.agency_dna_match_snapshot_id
  ) THEN
    RAISE EXCEPTION 'opportunity candidate uses stale Agency DNA Match source'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_opportunity_candidate_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM opportunity_candidates candidate
    JOIN agency_dna_match_evidence match_evidence
      ON match_evidence.match_snapshot_id =
        candidate.agency_dna_match_snapshot_id
     AND match_evidence.organization_id = candidate.organization_id
     AND match_evidence.workspace_id = candidate.workspace_id
     AND match_evidence.client_profile_id = candidate.client_profile_id
     AND match_evidence.evidence_id = NEW.evidence_id
    WHERE candidate.id = NEW.candidate_id
      AND candidate.organization_id = NEW.organization_id
      AND candidate.workspace_id = NEW.workspace_id
      AND candidate.client_profile_id = NEW.client_profile_id
  ) THEN
    RAISE EXCEPTION 'candidate evidence must come from its Agency DNA Match source'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION require_opportunity_candidate_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM opportunity_candidate_evidence evidence
    WHERE evidence.candidate_id = NEW.id
  ) OR EXISTS (
    (SELECT evidence_id
     FROM agency_dna_match_evidence
     WHERE match_snapshot_id = NEW.agency_dna_match_snapshot_id)
    EXCEPT
    (SELECT evidence_id
     FROM opportunity_candidate_evidence
     WHERE candidate_id = NEW.id)
  ) OR EXISTS (
    (SELECT evidence_id
     FROM opportunity_candidate_evidence
     WHERE candidate_id = NEW.id)
    EXCEPT
    (SELECT evidence_id
     FROM agency_dna_match_evidence
     WHERE match_snapshot_id = NEW.agency_dna_match_snapshot_id)
  ) OR EXISTS (
    SELECT 1
    FROM JSONB_ARRAY_ELEMENTS(NEW.reasons) AS reason
    CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(reason->'evidenceIds') AS evidence_ref
    WHERE reason->>'basis' = 'evidence'
      AND NOT EXISTS (
        SELECT 1 FROM opportunity_candidate_evidence evidence
        WHERE evidence.candidate_id = NEW.id
          AND evidence.evidence_id::TEXT = evidence_ref #>> '{}'
      )
  ) OR NEW.evidence_snapshot->'evidenceIds' <> COALESCE((
    SELECT JSONB_AGG(evidence_id::TEXT ORDER BY evidence_id)
    FROM opportunity_candidate_evidence
    WHERE candidate_id = NEW.id
  ), '[]'::JSONB) OR NEW.evidence_snapshot->'evidenceSourceFamilies' <>
    COALESCE((
      SELECT JSONB_AGG(source ORDER BY source)
      FROM (
        SELECT DISTINCT LOWER(BTRIM(item.source)) AS source
        FROM opportunity_candidate_evidence candidate_evidence
        JOIN evidence_items item ON item.id = candidate_evidence.evidence_id
        WHERE candidate_evidence.candidate_id = NEW.id
      ) source_families
    ), '[]'::JSONB) OR
    (NEW.evidence_snapshot->>'directEvidenceCount')::INTEGER <> (
      SELECT COUNT(*) FROM opportunity_candidate_evidence candidate_evidence
      JOIN evidence_items item ON item.id = candidate_evidence.evidence_id
      WHERE candidate_evidence.candidate_id = NEW.id AND item.tier = 'direct'
    ) OR (NEW.evidence_snapshot->>'corroborationEvidenceCount')::INTEGER <> (
      SELECT COUNT(*) FROM opportunity_candidate_evidence candidate_evidence
      JOIN evidence_items item ON item.id = candidate_evidence.evidence_id
      WHERE candidate_evidence.candidate_id = NEW.id
        AND item.tier = 'corroboration'
    ) THEN
    RAISE EXCEPTION 'opportunity candidate requires its complete evidence snapshot'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER opportunity_candidate_validate_generation
BEFORE INSERT ON opportunity_candidates
FOR EACH ROW
EXECUTE FUNCTION validate_opportunity_candidate_generation();

CREATE TRIGGER opportunity_candidate_validate_source
BEFORE INSERT ON opportunity_candidates
FOR EACH ROW
EXECUTE FUNCTION validate_opportunity_candidate_source();

CREATE TRIGGER opportunity_candidate_validate_evidence
BEFORE INSERT ON opportunity_candidate_evidence
FOR EACH ROW
EXECUTE FUNCTION validate_opportunity_candidate_evidence();

CREATE TRIGGER opportunity_candidates_immutable
BEFORE UPDATE OR DELETE ON opportunity_candidates
FOR EACH ROW
EXECUTE FUNCTION reject_opportunity_candidate_mutation();

CREATE TRIGGER opportunity_candidate_evidence_immutable
BEFORE UPDATE OR DELETE ON opportunity_candidate_evidence
FOR EACH ROW
EXECUTE FUNCTION reject_opportunity_candidate_mutation();

CREATE CONSTRAINT TRIGGER opportunity_candidate_requires_evidence
AFTER INSERT ON opportunity_candidates
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION require_opportunity_candidate_evidence();

COMMENT ON TABLE opportunity_candidates IS
  'Append-only tenant-scoped Opportunity Scoring v3 shadow candidates. Existing Opportunity readers and writers do not consume this table.';
COMMENT ON COLUMN opportunity_candidates.quality_score IS
  'Hard gates multiplied by the geometric mean of Agency Fit, propensity, timing, economics, and evidence confidence.';
COMMENT ON COLUMN opportunity_candidates.actionability_score IS
  'Separate enrichment and policy score; missing contact never weakens quality.';
COMMENT ON COLUMN opportunity_candidates.ranking_score IS
  'Quality-only shadow ranking so missing contact routes lead to enrichment instead of suppression.';

COMMIT;
