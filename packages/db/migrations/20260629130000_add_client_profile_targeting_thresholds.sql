BEGIN;

-- Block 2: data-backed targeting thresholds on client_profiles.
--
-- Three NEW filters, each a pure read of a column already present on
-- digest_candidates — no new source or enrichment needed:
--   hiring_intent_min    — minimum FIUR total_score (∈ [0,4]) a lead must reach.
--   signal_freshness_days — max age (days) of the latest hiring signal.
--   min_open_roles       — minimum parsed vacancies_count on the candidate.
--
-- All nullable / zero-default so an unset filter is a NO-OP: existing profiles
-- and fresh ones keep surfacing every candidate (no leads=0 regression). The
-- matchesClientProfile gate only applies a threshold when it is explicitly set.

ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS hiring_intent_min    REAL,
  ADD COLUMN IF NOT EXISTS signal_freshness_days INTEGER,
  ADD COLUMN IF NOT EXISTS min_open_roles        INTEGER;

-- Guard rails: keep the thresholds inside the ranges the scorer can produce.
ALTER TABLE client_profiles
  DROP CONSTRAINT IF EXISTS client_profiles_hiring_intent_min_range;
ALTER TABLE client_profiles
  ADD  CONSTRAINT client_profiles_hiring_intent_min_range
    CHECK (hiring_intent_min IS NULL OR (hiring_intent_min >= 0 AND hiring_intent_min <= 4));

ALTER TABLE client_profiles
  DROP CONSTRAINT IF EXISTS client_profiles_signal_freshness_days_positive;
ALTER TABLE client_profiles
  ADD  CONSTRAINT client_profiles_signal_freshness_days_positive
    CHECK (signal_freshness_days IS NULL OR signal_freshness_days > 0);

ALTER TABLE client_profiles
  DROP CONSTRAINT IF EXISTS client_profiles_min_open_roles_nonneg;
ALTER TABLE client_profiles
  ADD  CONSTRAINT client_profiles_min_open_roles_nonneg
    CHECK (min_open_roles IS NULL OR min_open_roles >= 0);

COMMENT ON COLUMN client_profiles.hiring_intent_min IS 'Minimum FIUR total score (0..4) a candidate must reach to enter this profile''s digest. NULL = no intent threshold.';
COMMENT ON COLUMN client_profiles.signal_freshness_days IS 'Max age in days of the latest hiring signal (latest_published_at). NULL = no freshness threshold. Candidates with no date are kept (cannot prove staleness).';
COMMENT ON COLUMN client_profiles.min_open_roles IS 'Minimum parsed open-role count (vacancies_count) a candidate must have. NULL = no minimum.';

COMMIT;
