BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE rf_hiring_discovery_candidates_v2 (
  id BIGSERIAL PRIMARY KEY,
  source_family TEXT NOT NULL CHECK (BTRIM(source_family) <> ''),
  vacancy_key TEXT NOT NULL CHECK (BTRIM(vacancy_key) <> ''),
  external_vacancy_id TEXT,
  vacancy_url TEXT NOT NULL CHECK (vacancy_url ~ '^https://'),
  job_title TEXT,
  employer_name TEXT,
  employer_profile_url TEXT,
  employer_website_url TEXT,
  location TEXT,
  published_at TIMESTAMPTZ,
  first_detected_at TIMESTAMPTZ NOT NULL,
  last_detected_at TIMESTAMPTZ NOT NULL,
  acquisition_method TEXT NOT NULL CHECK (BTRIM(acquisition_method) <> ''),
  identity_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    identity_status IN ('pending', 'resolved', 'ambiguous', 'rejected')
  ),
  resolved_org_id BIGINT REFERENCES orgs(id) ON DELETE RESTRICT,
  resolution_reason TEXT,
  strong_identity_keys TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  corroboration_families TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  payload JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (JSONB_TYPEOF(payload) = 'object'),
  content_fingerprint CHAR(64) NOT NULL CHECK (content_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_family, vacancy_key),
  CHECK (last_detected_at >= first_detected_at),
  CHECK (
    (identity_status = 'resolved' AND resolved_org_id IS NOT NULL)
    OR (identity_status <> 'resolved' AND resolved_org_id IS NULL)
  )
);

CREATE INDEX rf_hiring_discovery_candidates_v2_resolution_idx
  ON rf_hiring_discovery_candidates_v2 (identity_status, last_detected_at DESC, id DESC);
CREATE INDEX rf_hiring_discovery_candidates_v2_org_idx
  ON rf_hiring_discovery_candidates_v2 (resolved_org_id, last_detected_at DESC, id DESC)
  WHERE resolved_org_id IS NOT NULL;
CREATE INDEX rf_hiring_discovery_candidates_v2_source_idx
  ON rf_hiring_discovery_candidates_v2 (source_family, last_detected_at DESC, id DESC);

COMMIT;
