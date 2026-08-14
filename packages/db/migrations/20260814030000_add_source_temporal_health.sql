BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE source_run_observations (
  id BIGSERIAL PRIMARY KEY,
  source_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('fetch', 'ingest', 'pipeline')),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'blocked', 'rate_limited', 'failure')),
  records_fetched INTEGER NOT NULL DEFAULT 0 CHECK (records_fetched >= 0),
  records_accepted INTEGER NOT NULL DEFAULT 0 CHECK (records_accepted >= 0),
  duplicate_records INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_records >= 0),
  organization_resolution_rejects INTEGER NOT NULL DEFAULT 0 CHECK (organization_resolution_rejects >= 0),
  extraction_methods JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (JSONB_TYPEOF(extraction_methods) = 'object'),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (completed_at >= started_at)
);
CREATE INDEX source_run_observations_source_completed_idx ON source_run_observations (source_id, completed_at DESC, id DESC);

CREATE TABLE source_health_state (
  source_id TEXT PRIMARY KEY,
  last_attempt_at TIMESTAMPTZ NOT NULL,
  last_successful_fetch_at TIMESTAMPTZ,
  last_successful_normalization_at TIMESTAMPTZ,
  records_fetched BIGINT NOT NULL DEFAULT 0,
  records_accepted BIGINT NOT NULL DEFAULT 0,
  duplicate_records BIGINT NOT NULL DEFAULT 0,
  organization_resolution_rejects BIGINT NOT NULL DEFAULT 0,
  blocked_count BIGINT NOT NULL DEFAULT 0,
  rate_limited_count BIGINT NOT NULL DEFAULT 0,
  extraction_methods JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (JSONB_TYPEOF(extraction_methods) = 'object'),
  last_latency_ms INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE source_temporal_observations (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT,
  source_family TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('vacancies', 'fns_company', 'government_procurement', 'rospatent')),
  subject_key TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  metrics JSONB NOT NULL CHECK (JSONB_TYPEOF(metrics) = 'object'),
  evidence_ids BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
  observation_fingerprint TEXT NOT NULL UNIQUE CHECK (observation_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX source_temporal_observations_lookup_idx ON source_temporal_observations (organization_id, subject_type, observed_at DESC, id DESC);

CREATE TABLE source_temporal_derived_events (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT,
  subject_type TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  window_days INTEGER CHECK (window_days IN (7, 14, 30)),
  previous_observation_id BIGINT REFERENCES source_temporal_observations(id) ON DELETE RESTRICT,
  current_observation_id BIGINT NOT NULL REFERENCES source_temporal_observations(id) ON DELETE RESTRICT,
  delta JSONB NOT NULL CHECK (JSONB_TYPEOF(delta) = 'object'),
  evidence_ids BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
  event_fingerprint TEXT NOT NULL UNIQUE CHECK (event_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX source_temporal_derived_events_org_idx ON source_temporal_derived_events (organization_id, occurred_at DESC, id DESC);

COMMIT;
