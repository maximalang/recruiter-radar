BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE canonical_vacancies_v1 (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT,
  vacancy_fingerprint TEXT NOT NULL CHECK (vacancy_fingerprint ~ '^[a-f0-9]{64}$'),
  normalized_role TEXT NOT NULL CHECK (BTRIM(normalized_role) <> ''),
  location TEXT,
  canonical_destination_url TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  last_source_seen_at TIMESTAMPTZ NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  closed_at TIMESTAMPTZ,
  reopened_at TIMESTAMPTZ,
  reopened_count INTEGER NOT NULL DEFAULT 0 CHECK (reopened_count >= 0),
  source_families TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  source_external_ids JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (JSONB_TYPEOF(source_external_ids) = 'object'),
  evidence_ids BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
  successful_absence_observation_ids BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, vacancy_fingerprint),
  UNIQUE (id, organization_id),
  CHECK (last_seen_at >= first_seen_at),
  CHECK (last_source_seen_at >= first_seen_at),
  CHECK (active OR closed_at IS NOT NULL)
);
CREATE INDEX canonical_vacancies_v1_active_org_idx
  ON canonical_vacancies_v1 (organization_id, last_source_seen_at DESC, id DESC)
  WHERE active;

CREATE TABLE canonical_vacancy_publications_v1 (
  id BIGSERIAL PRIMARY KEY,
  canonical_vacancy_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT,
  signal_id BIGINT NOT NULL REFERENCES signals(id) ON DELETE RESTRICT,
  source_family TEXT NOT NULL CHECK (BTRIM(source_family) <> ''),
  external_vacancy_id TEXT,
  destination_url TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  evidence_ids BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (signal_id),
  CONSTRAINT canonical_vacancy_publications_v1_vacancy_org_fk
    FOREIGN KEY (canonical_vacancy_id, organization_id)
    REFERENCES canonical_vacancies_v1(id, organization_id) ON DELETE RESTRICT,
  CHECK (last_seen_at >= first_seen_at)
);
CREATE INDEX canonical_vacancy_publications_v1_vacancy_idx
  ON canonical_vacancy_publications_v1 (canonical_vacancy_id, last_seen_at DESC, id DESC);

CREATE TABLE canonical_vacancy_observations_v1 (
  id BIGSERIAL PRIMARY KEY,
  canonical_vacancy_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT,
  observed_at TIMESTAMPTZ NOT NULL,
  present BOOLEAN NOT NULL,
  source_run_observation_ids BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
  signal_ids BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
  evidence_ids BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
  basis JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (JSONB_TYPEOF(basis) = 'object'),
  observation_fingerprint TEXT NOT NULL UNIQUE
    CHECK (observation_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, canonical_vacancy_id, organization_id),
  CONSTRAINT canonical_vacancy_observations_v1_vacancy_org_fk
    FOREIGN KEY (canonical_vacancy_id, organization_id)
    REFERENCES canonical_vacancies_v1(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX canonical_vacancy_observations_v1_vacancy_idx
  ON canonical_vacancy_observations_v1
    (canonical_vacancy_id, observed_at DESC, id DESC);

CREATE TABLE canonical_vacancy_events_v1 (
  id BIGSERIAL PRIMARY KEY,
  canonical_vacancy_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('opened', 'closed', 'reopened')),
  occurred_at TIMESTAMPTZ NOT NULL,
  observation_id BIGINT NOT NULL,
  evidence_ids BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
  details JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (JSONB_TYPEOF(details) = 'object'),
  event_fingerprint TEXT NOT NULL UNIQUE CHECK (event_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT canonical_vacancy_events_v1_vacancy_org_fk
    FOREIGN KEY (canonical_vacancy_id, organization_id)
    REFERENCES canonical_vacancies_v1(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_vacancy_events_v1_observation_org_fk
    FOREIGN KEY (observation_id, canonical_vacancy_id, organization_id)
    REFERENCES canonical_vacancy_observations_v1(
      id, canonical_vacancy_id, organization_id
    ) ON DELETE RESTRICT
);
CREATE INDEX canonical_vacancy_events_v1_org_idx
  ON canonical_vacancy_events_v1 (organization_id, occurred_at DESC, id DESC);

COMMIT;
