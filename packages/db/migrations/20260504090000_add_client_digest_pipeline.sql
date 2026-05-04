BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'digest_run_status') THEN
    CREATE TYPE digest_run_status AS ENUM ('running', 'completed', 'failed');
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'digest_feedback_status') THEN
    CREATE TYPE digest_feedback_status AS ENUM (
      'none',
      'contacted',
      'replied',
      'won',
      'badfit',
      'snooze',
      'dismissed'
    );
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS client_profiles (
  id BIGSERIAL PRIMARY KEY,
  agency_name TEXT NOT NULL,
  telegram_chat_id BIGINT,
  target_city TEXT,
  specialization TEXT,
  include_keywords JSONB,
  exclude_keywords JSONB,
  daily_digest_limit INTEGER NOT NULL DEFAULT 5,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_profiles_agency_name_not_blank CHECK (BTRIM(agency_name) <> ''),
  CONSTRAINT client_profiles_telegram_chat_id_unique UNIQUE (telegram_chat_id),
  CONSTRAINT client_profiles_daily_digest_limit_check CHECK (daily_digest_limit > 0)
);

CREATE TABLE IF NOT EXISTS pilot_applications (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  telegram TEXT NOT NULL,
  specialization TEXT,
  city TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pilot_applications_name_not_blank CHECK (BTRIM(name) <> ''),
  CONSTRAINT pilot_applications_telegram_not_blank CHECK (BTRIM(telegram) <> '')
);

CREATE TABLE IF NOT EXISTS digest_runs (
  id BIGSERIAL PRIMARY KEY,
  client_profile_id BIGINT NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL DEFAULT 'default',
  status digest_run_status NOT NULL DEFAULT 'running',
  requested_limit INTEGER NOT NULL,
  selected_count INTEGER NOT NULL DEFAULT 0,
  cooldown_days INTEGER NOT NULL DEFAULT 3,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT digest_runs_source_key_not_blank CHECK (BTRIM(source_key) <> ''),
  CONSTRAINT digest_runs_requested_limit_check CHECK (requested_limit > 0),
  CONSTRAINT digest_runs_selected_count_check CHECK (selected_count >= 0),
  CONSTRAINT digest_runs_cooldown_days_check CHECK (cooldown_days > 0),
  CONSTRAINT digest_runs_completed_at_check
    CHECK ((status = 'completed' AND completed_at IS NOT NULL) OR status <> 'completed')
);

CREATE TABLE IF NOT EXISTS digest_candidates (
  id BIGSERIAL PRIMARY KEY,
  digest_run_id BIGINT NOT NULL REFERENCES digest_runs(id) ON DELETE CASCADE,
  client_profile_id BIGINT NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  org_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  source_external_id TEXT,
  source_display_name TEXT NOT NULL,
  source_families JSONB NOT NULL DEFAULT '[]'::JSONB,
  vacancies_count INTEGER NOT NULL,
  distinct_vacancy_names_count INTEGER NOT NULL,
  latest_published_at TIMESTAMPTZ,
  total_score INTEGER NOT NULL,
  reasons JSONB NOT NULL,
  opener TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT digest_candidates_source_display_name_not_blank CHECK (BTRIM(source_display_name) <> ''),
  CONSTRAINT digest_candidates_vacancies_count_check CHECK (vacancies_count > 0),
  CONSTRAINT digest_candidates_distinct_vacancy_names_count_check CHECK (distinct_vacancy_names_count > 0),
  CONSTRAINT digest_candidates_total_score_check CHECK (total_score >= 0),
  CONSTRAINT digest_candidates_run_org_unique UNIQUE (digest_run_id, org_id)
);

CREATE TABLE IF NOT EXISTS client_digest_org_state (
  client_profile_id BIGINT NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  org_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  last_digest_run_id BIGINT REFERENCES digest_runs(id) ON DELETE SET NULL,
  last_digest_candidate_id BIGINT REFERENCES digest_candidates(id) ON DELETE SET NULL,
  last_digest_at TIMESTAMPTZ,
  cooldown_until TIMESTAMPTZ,
  suppressed_until TIMESTAMPTZ,
  feedback_status digest_feedback_status NOT NULL DEFAULT 'none',
  feedback_at TIMESTAMPTZ,
  feedback_note TEXT,
  last_source_external_id TEXT,
  last_source_display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_profile_id, org_id),
  CONSTRAINT client_digest_org_state_feedback_note_check
    CHECK (feedback_status = 'none' OR feedback_note IS NULL OR BTRIM(feedback_note) <> ''),
  CONSTRAINT client_digest_org_state_last_source_display_name_not_blank
    CHECK (last_source_display_name IS NULL OR BTRIM(last_source_display_name) <> '')
);

CREATE INDEX IF NOT EXISTS client_profiles_active_updated_at_idx
  ON client_profiles (is_active, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS client_profiles_agency_name_scope_uidx
  ON client_profiles (
    LOWER(agency_name),
    LOWER(COALESCE(target_city, '')),
    LOWER(COALESCE(specialization, ''))
  );
CREATE INDEX IF NOT EXISTS pilot_applications_created_at_idx
  ON pilot_applications (created_at DESC);

CREATE INDEX IF NOT EXISTS digest_runs_client_profile_created_at_idx
  ON digest_runs (client_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS digest_runs_status_created_at_idx
  ON digest_runs (status, created_at DESC);

CREATE INDEX IF NOT EXISTS digest_candidates_client_profile_created_at_idx
  ON digest_candidates (client_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS digest_candidates_org_created_at_idx
  ON digest_candidates (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS client_digest_org_state_feedback_status_idx
  ON client_digest_org_state (client_profile_id, feedback_status);
CREATE INDEX IF NOT EXISTS client_digest_org_state_cooldown_idx
  ON client_digest_org_state (client_profile_id, cooldown_until);
CREATE INDEX IF NOT EXISTS client_digest_org_state_suppressed_idx
  ON client_digest_org_state (client_profile_id, suppressed_until);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trg
    JOIN pg_class AS cls
      ON cls.oid = trg.tgrelid
    WHERE trg.tgname = 'client_profiles_set_updated_at'
      AND cls.relname = 'client_profiles'
  ) THEN
    CREATE TRIGGER client_profiles_set_updated_at
    BEFORE UPDATE ON client_profiles
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trg
    JOIN pg_class AS cls
      ON cls.oid = trg.tgrelid
    WHERE trg.tgname = 'client_digest_org_state_set_updated_at'
      AND cls.relname = 'client_digest_org_state'
  ) THEN
    CREATE TRIGGER client_digest_org_state_set_updated_at
    BEFORE UPDATE ON client_digest_org_state
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

COMMIT;
