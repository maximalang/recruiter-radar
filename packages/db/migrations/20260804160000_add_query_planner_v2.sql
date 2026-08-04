BEGIN;

CREATE OR REPLACE FUNCTION reject_query_planner_v2_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION query_plan_text_array_valid(
  items TEXT[],
  maximum_items INTEGER,
  allow_empty BOOLEAN DEFAULT TRUE
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT
    items IS NOT NULL
    AND (allow_empty OR CARDINALITY(items) > 0)
    AND CARDINALITY(items) <= maximum_items
    AND NOT EXISTS (
      SELECT 1
      FROM UNNEST(items) AS item
      WHERE BTRIM(item) = '' OR LENGTH(item) > 200
    )
    AND CARDINALITY(items) = (
      SELECT COUNT(DISTINCT LOWER(BTRIM(item)))
      FROM UNNEST(items) AS item
    );
$$;

CREATE OR REPLACE FUNCTION query_plan_json_text_array_valid(
  items JSONB,
  maximum_items INTEGER
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT
    JSONB_TYPEOF(items) = 'array'
    AND JSONB_ARRAY_LENGTH(items) <= maximum_items
    AND NOT EXISTS (
      SELECT 1
      FROM JSONB_ARRAY_ELEMENTS(items) AS item
      WHERE JSONB_TYPEOF(item) <> 'string'
         OR BTRIM(item #>> '{}') = ''
         OR LENGTH(item #>> '{}') > 200
    );
$$;

CREATE OR REPLACE FUNCTION query_plan_historical_yield_valid(yield JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT
    JSONB_TYPEOF(yield) = 'object'
    AND ARRAY(SELECT JSONB_OBJECT_KEYS(yield) ORDER BY 1) = ARRAY[
      'accepted', 'contacted', 'episodes', 'fetchedRecords', 'meetings',
      'qualifiedOpportunities', 'replied', 'uniqueCompanies', 'uniqueEvents'
    ]::TEXT[]
    AND NOT EXISTS (
      SELECT 1
      FROM JSONB_EACH(yield) AS item(key, value)
      WHERE JSONB_TYPEOF(value) NOT IN ('number', 'null')
         OR (
           JSONB_TYPEOF(value) = 'number'
           AND ((value #>> '{}')::NUMERIC < 0 OR (value #>> '{}') !~ '^\d+$')
         )
    );
$$;

CREATE OR REPLACE FUNCTION query_plan_region_snapshot_valid(region JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT
    JSONB_TYPEOF(region) = 'object'
    AND region->>'resolution' IN ('federal', 'resolved', 'unresolved', 'excluded')
    AND region->>'remoteRelation' IN (
      'region_only', 'region_or_remote', 'remote_anywhere', 'unspecified'
    )
    AND BTRIM(COALESCE(region->>'mappingVersion', '')) <> ''
    AND query_plan_json_text_array_valid(region->'hhAreaIds', 10)
    AND query_plan_json_text_array_valid(
      region->'rabotaRossiiRegionCodes',
      10
    )
    AND query_plan_json_text_array_valid(region->'aliases', 30)
    AND NOT (region ? 'contactValues');
$$;

CREATE OR REPLACE FUNCTION query_plan_feedback_adjustments_valid(
  adjustments JSONB
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT
    JSONB_TYPEOF(adjustments) = 'object'
    AND ARRAY(SELECT JSONB_OBJECT_KEYS(adjustments) ORDER BY 1) =
      ARRAY['boost', 'demote']::TEXT[]
    AND JSONB_TYPEOF(adjustments->'boost') = 'array'
    AND JSONB_TYPEOF(adjustments->'demote') = 'array'
    AND JSONB_ARRAY_LENGTH(adjustments->'boost') <= 100
    AND JSONB_ARRAY_LENGTH(adjustments->'demote') <= 100
    AND NOT EXISTS (
      SELECT 1
      FROM JSONB_ARRAY_ELEMENTS(
        (adjustments->'boost') || (adjustments->'demote')
      ) AS item
      WHERE JSONB_TYPEOF(item) <> 'object'
         OR item->>'axis' NOT IN ('industry', 'role')
         OR item->>'direction' NOT IN ('boost', 'demote')
         OR BTRIM(COALESCE(item->>'value', '')) = ''
         OR COALESCE((item->>'sampleCount') ~ '^\d+$', FALSE) = FALSE
         OR COALESCE((item->>'netScore') ~ '^-?\d+$', FALSE) = FALSE
    )
    AND NOT (adjustments ? 'contactValues');
$$;

CREATE OR REPLACE FUNCTION query_plan_query_env_valid(
  plan_source TEXT,
  environment JSONB
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT
    JSONB_TYPEOF(environment) = 'object'
    AND (
      SELECT COUNT(*)
      FROM JSONB_OBJECT_KEYS(environment)
    ) BETWEEN 1 AND 20
    AND NOT EXISTS (
      SELECT 1
      FROM JSONB_EACH(environment) AS item(key, value)
      WHERE JSONB_TYPEOF(value) <> 'string'
         OR BTRIM(value #>> '{}') = ''
         OR LENGTH(value #>> '{}') > 4000
         OR CASE plan_source
           WHEN 'hh' THEN key !~ '^HH_'
           WHEN 'superjob' THEN key !~ '^SUPERJOB_'
           WHEN 'habr-career' THEN key !~ '^HABR_CAREER_'
           WHEN 'rabota-rossii' THEN key !~ '^RABOTA_ROSSII_'
           ELSE TRUE
         END
    );
$$;

CREATE OR REPLACE FUNCTION query_plan_metric_rates_valid(
  duplicate_rate NUMERIC,
  zero_result_rate NUMERIC,
  qualified_rate NUMERIC,
  accepted_rate NUMERIC,
  contacted_rate NUMERIC,
  reply_rate NUMERIC,
  meeting_rate NUMERIC
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM UNNEST(ARRAY[
      duplicate_rate, zero_result_rate, qualified_rate, accepted_rate,
      contacted_rate, reply_rate, meeting_rate
    ]) AS rate
    WHERE rate IS NOT NULL AND (rate < 0 OR rate > 1)
  );
$$;

CREATE TABLE query_plan_snapshots (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL,
  owner_id BIGINT NOT NULL,
  client_profile_id BIGINT NOT NULL,
  plan_identity TEXT NOT NULL,
  plan_generation INTEGER NOT NULL,
  planner_version TEXT NOT NULL,
  geography_version TEXT NOT NULL,
  source TEXT NOT NULL,
  role_family TEXT NOT NULL,
  role_synonyms TEXT[] NOT NULL,
  specializations TEXT[] NOT NULL,
  canonical_region TEXT,
  region_snapshot JSONB NOT NULL,
  seniorities TEXT[] NOT NULL,
  keyword_cluster TEXT[] NOT NULL,
  negative_terms TEXT[] NOT NULL,
  page_budget INTEGER NOT NULL,
  frequency TEXT NOT NULL,
  profile_consumers BIGINT[] NOT NULL,
  historical_yield JSONB NOT NULL,
  feedback_adjustments JSONB NOT NULL,
  query_env JSONB NOT NULL,
  status TEXT NOT NULL,
  reason_codes TEXT[] NOT NULL,
  profile_snapshot_hash TEXT NOT NULL,
  feedback_hash TEXT NOT NULL,
  shared_request_hash TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT query_plan_snapshots_id_scope_unique
    UNIQUE (id, workspace_id, client_profile_id),
  CONSTRAINT query_plan_snapshots_profile_scope_fkey
    FOREIGN KEY (client_profile_id, owner_id, workspace_id)
    REFERENCES client_profiles(id, owner_id, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT query_plan_snapshots_identity_generation_unique
    UNIQUE (
      workspace_id,
      client_profile_id,
      planner_version,
      plan_identity,
      plan_generation
    ),
  CONSTRAINT query_plan_snapshots_input_unique
    UNIQUE (
      workspace_id,
      client_profile_id,
      planner_version,
      input_hash
    ),
  CONSTRAINT query_plan_snapshots_identity_check
    CHECK (plan_identity ~ '^[a-f0-9]{64}$'),
  CONSTRAINT query_plan_snapshots_generation_check
    CHECK (plan_generation > 0),
  CONSTRAINT query_plan_snapshots_version_check CHECK (
    planner_version = 'query-planner-v2'
    AND geography_version = 'rf-source-geography-v2-2026-08-04'
  ),
  CONSTRAINT query_plan_snapshots_source_check CHECK (
    source IN ('hh', 'superjob', 'habr-career', 'rabota-rossii')
  ),
  CONSTRAINT query_plan_snapshots_role_check
    CHECK (BTRIM(role_family) <> '' AND LENGTH(role_family) <= 100),
  CONSTRAINT query_plan_snapshots_role_synonyms_check
    CHECK (query_plan_text_array_valid(role_synonyms, 50)),
  CONSTRAINT query_plan_snapshots_specializations_check
    CHECK (query_plan_text_array_valid(specializations, 50)),
  CONSTRAINT query_plan_snapshots_region_check
    CHECK (query_plan_region_snapshot_valid(region_snapshot)),
  CONSTRAINT query_plan_snapshots_seniorities_check
    CHECK (query_plan_text_array_valid(seniorities, 20)),
  CONSTRAINT query_plan_snapshots_keyword_cluster_check
    CHECK (query_plan_text_array_valid(keyword_cluster, 100)),
  CONSTRAINT query_plan_snapshots_negative_terms_check
    CHECK (query_plan_text_array_valid(negative_terms, 100)),
  CONSTRAINT query_plan_snapshots_budget_frequency_check
    CHECK (page_budget BETWEEN 1 AND 50 AND frequency = 'daily'),
  CONSTRAINT query_plan_snapshots_profile_consumers_check CHECK (
    profile_consumers = ARRAY[client_profile_id]::BIGINT[]
  ),
  CONSTRAINT query_plan_snapshots_historical_yield_check
    CHECK (query_plan_historical_yield_valid(historical_yield)),
  CONSTRAINT query_plan_snapshots_feedback_check
    CHECK (query_plan_feedback_adjustments_valid(feedback_adjustments)),
  CONSTRAINT query_plan_snapshots_query_env_check
    CHECK (query_plan_query_env_valid(source, query_env)),
  CONSTRAINT query_plan_snapshots_status_check
    CHECK (status IN ('ready', 'review', 'blocked')),
  CONSTRAINT query_plan_snapshots_reasons_check
    CHECK (query_plan_text_array_valid(reason_codes, 20)),
  CONSTRAINT query_plan_snapshots_hashes_check CHECK (
    profile_snapshot_hash ~ '^[a-f0-9]{64}$'
    AND feedback_hash ~ '^[a-f0-9]{64}$'
    AND shared_request_hash ~ '^[a-f0-9]{64}$'
    AND input_hash ~ '^[a-f0-9]{64}$'
  )
);

CREATE TABLE query_plan_shared_requests (
  id BIGSERIAL PRIMARY KEY,
  planner_version TEXT NOT NULL,
  source TEXT NOT NULL,
  shared_request_hash TEXT NOT NULL,
  query_env JSONB NOT NULL,
  page_budget INTEGER NOT NULL,
  frequency TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT query_plan_shared_requests_unique
    UNIQUE (planner_version, source, shared_request_hash),
  CONSTRAINT query_plan_shared_requests_version_check
    CHECK (planner_version = 'query-planner-v2'),
  CONSTRAINT query_plan_shared_requests_source_check CHECK (
    source IN ('hh', 'superjob', 'habr-career', 'rabota-rossii')
  ),
  CONSTRAINT query_plan_shared_requests_hash_check
    CHECK (shared_request_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT query_plan_shared_requests_env_check
    CHECK (query_plan_query_env_valid(source, query_env)),
  CONSTRAINT query_plan_shared_requests_budget_frequency_check
    CHECK (page_budget BETWEEN 1 AND 50 AND frequency = 'daily')
);

CREATE TABLE query_plan_request_consumers (
  shared_request_id BIGINT NOT NULL
    REFERENCES query_plan_shared_requests(id) ON DELETE RESTRICT,
  plan_snapshot_id BIGINT NOT NULL,
  workspace_id BIGINT NOT NULL,
  client_profile_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT query_plan_request_consumers_plan_scope_fkey
    FOREIGN KEY (plan_snapshot_id, workspace_id, client_profile_id)
    REFERENCES query_plan_snapshots(id, workspace_id, client_profile_id)
    ON DELETE RESTRICT,
  CONSTRAINT query_plan_request_consumers_profile_unique
    UNIQUE (shared_request_id, workspace_id, client_profile_id, plan_snapshot_id)
);

CREATE TABLE query_plan_metric_snapshots (
  id BIGSERIAL PRIMARY KEY,
  plan_snapshot_id BIGINT NOT NULL,
  workspace_id BIGINT NOT NULL,
  client_profile_id BIGINT NOT NULL,
  metric_version TEXT NOT NULL,
  measurement_window_start TIMESTAMPTZ NOT NULL,
  measurement_window_end TIMESTAMPTZ NOT NULL,
  execution_count INTEGER NOT NULL,
  zero_result_executions INTEGER NOT NULL,
  fetched_records BIGINT,
  unique_events BIGINT,
  unique_companies BIGINT,
  episodes BIGINT,
  qualified_opportunities BIGINT,
  accepted BIGINT,
  contacted BIGINT,
  replied BIGINT,
  meetings BIGINT,
  duplicate_rate NUMERIC(8, 7),
  zero_result_rate NUMERIC(8, 7),
  qualified_rate NUMERIC(8, 7),
  accepted_rate NUMERIC(8, 7),
  contacted_rate NUMERIC(8, 7),
  reply_rate NUMERIC(8, 7),
  meeting_rate NUMERIC(8, 7),
  input_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT query_plan_metric_snapshots_plan_scope_fkey
    FOREIGN KEY (plan_snapshot_id, workspace_id, client_profile_id)
    REFERENCES query_plan_snapshots(id, workspace_id, client_profile_id)
    ON DELETE RESTRICT,
  CONSTRAINT query_plan_metric_snapshots_input_unique
    UNIQUE (plan_snapshot_id, metric_version, input_hash),
  CONSTRAINT query_plan_metric_snapshots_version_check
    CHECK (metric_version = 'query-plan-yield-v2'),
  CONSTRAINT query_plan_metric_snapshots_window_check
    CHECK (measurement_window_end > measurement_window_start),
  CONSTRAINT query_plan_metric_snapshots_execution_check CHECK (
    execution_count >= 0
    AND zero_result_executions BETWEEN 0 AND execution_count
  ),
  CONSTRAINT query_plan_metric_snapshots_counts_check CHECK (
    (fetched_records IS NULL OR fetched_records >= 0)
    AND (unique_events IS NULL OR unique_events >= 0)
    AND (unique_companies IS NULL OR unique_companies >= 0)
    AND (episodes IS NULL OR episodes >= 0)
    AND (qualified_opportunities IS NULL OR qualified_opportunities >= 0)
    AND (accepted IS NULL OR accepted >= 0)
    AND (contacted IS NULL OR contacted >= 0)
    AND (replied IS NULL OR replied >= 0)
    AND (meetings IS NULL OR meetings >= 0)
  ),
  CONSTRAINT query_plan_metric_snapshots_rates_check CHECK (
    query_plan_metric_rates_valid(
      duplicate_rate,
      zero_result_rate,
      qualified_rate,
      accepted_rate,
      contacted_rate,
      reply_rate,
      meeting_rate
    )
  ),
  CONSTRAINT query_plan_metric_snapshots_hash_check
    CHECK (input_hash ~ '^[a-f0-9]{64}$')
);

CREATE OR REPLACE FUNCTION validate_query_plan_generation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  expected_generation INTEGER;
BEGIN
  PERFORM PG_ADVISORY_XACT_LOCK(HASHTEXTENDED(
    CONCAT_WS(
      ':',
      NEW.workspace_id,
      NEW.client_profile_id,
      NEW.planner_version,
      NEW.plan_identity
    ),
    0
  ));
  SELECT COALESCE(MAX(plan_generation), 0) + 1
  INTO expected_generation
  FROM query_plan_snapshots
  WHERE workspace_id = NEW.workspace_id
    AND client_profile_id = NEW.client_profile_id
    AND planner_version = NEW.planner_version
    AND plan_identity = NEW.plan_identity;
  IF NEW.plan_generation <> expected_generation THEN
    RAISE EXCEPTION 'query plan generation must append exactly once'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_query_plan_profile_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM client_profiles profile
    WHERE profile.id = NEW.client_profile_id
      AND profile.owner_id = NEW.owner_id
      AND profile.workspace_id = NEW.workspace_id
      AND ENCODE(
        DIGEST(agency_dna_full_snapshot(profile)::TEXT, 'sha256'),
        'hex'
      ) = NEW.profile_snapshot_hash
  ) THEN
    RAISE EXCEPTION 'query plan profile snapshot is stale or cross-tenant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_query_plan_consumer_request()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM query_plan_snapshots plan
    JOIN query_plan_shared_requests request
      ON request.id = NEW.shared_request_id
     AND request.planner_version = plan.planner_version
     AND request.source = plan.source
     AND request.shared_request_hash = plan.shared_request_hash
     AND request.query_env = plan.query_env
     AND request.page_budget = plan.page_budget
     AND request.frequency = plan.frequency
    WHERE plan.id = NEW.plan_snapshot_id
      AND plan.workspace_id = NEW.workspace_id
      AND plan.client_profile_id = NEW.client_profile_id
      AND plan.status = 'ready'
  ) THEN
    RAISE EXCEPTION 'shared query request does not match profile plan'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER query_plan_snapshots_validate_generation
BEFORE INSERT ON query_plan_snapshots
FOR EACH ROW
EXECUTE FUNCTION validate_query_plan_generation();

CREATE TRIGGER query_plan_snapshots_validate_profile
BEFORE INSERT ON query_plan_snapshots
FOR EACH ROW
EXECUTE FUNCTION validate_query_plan_profile_snapshot();

CREATE TRIGGER query_plan_request_consumers_validate_request
BEFORE INSERT ON query_plan_request_consumers
FOR EACH ROW
EXECUTE FUNCTION validate_query_plan_consumer_request();

CREATE TRIGGER query_plan_snapshots_immutable
BEFORE UPDATE OR DELETE ON query_plan_snapshots
FOR EACH ROW
EXECUTE FUNCTION reject_query_planner_v2_mutation();

CREATE TRIGGER query_plan_shared_requests_immutable
BEFORE UPDATE OR DELETE ON query_plan_shared_requests
FOR EACH ROW
EXECUTE FUNCTION reject_query_planner_v2_mutation();

CREATE TRIGGER query_plan_request_consumers_immutable
BEFORE UPDATE OR DELETE ON query_plan_request_consumers
FOR EACH ROW
EXECUTE FUNCTION reject_query_planner_v2_mutation();

CREATE TRIGGER query_plan_metric_snapshots_immutable
BEFORE UPDATE OR DELETE ON query_plan_metric_snapshots
FOR EACH ROW
EXECUTE FUNCTION reject_query_planner_v2_mutation();

CREATE INDEX query_plan_snapshots_profile_latest_idx
  ON query_plan_snapshots (
    workspace_id,
    client_profile_id,
    source,
    created_at DESC,
    id DESC
  );
CREATE INDEX query_plan_snapshots_shared_request_idx
  ON query_plan_snapshots (shared_request_hash, source)
  WHERE status = 'ready';
CREATE INDEX query_plan_request_consumers_profile_idx
  ON query_plan_request_consumers (
    workspace_id,
    client_profile_id,
    created_at DESC
  );
CREATE INDEX query_plan_metric_snapshots_profile_window_idx
  ON query_plan_metric_snapshots (
    workspace_id,
    client_profile_id,
    measurement_window_end DESC
  );

COMMENT ON TABLE query_plan_snapshots IS
  'Append-only profile-scoped Query Planner v2 snapshots. Existing ingestion remains unchanged unless a separate dark flag is enabled.';
COMMENT ON TABLE query_plan_shared_requests IS
  'Tenant-neutral source request identities that may be fetched once while consumers and ranking remain profile scoped.';
COMMENT ON COLUMN query_plan_snapshots.negative_terms IS
  'Per-profile exclusions only; never a union of exclusions from other profiles.';
COMMENT ON TABLE query_plan_metric_snapshots IS
  'Append-only per-profile plan yield metrics. NULL means unavailable, never inferred zero.';

COMMIT;
