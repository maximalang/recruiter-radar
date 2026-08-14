BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE source_scheduler_state (
  source_id TEXT PRIMARY KEY,
  host_key TEXT NOT NULL CHECK (BTRIM(host_key) <> ''),
  expected_refresh_interval_seconds INTEGER NOT NULL
    CHECK (expected_refresh_interval_seconds > 0),
  next_eligible_run_at TIMESTAMPTZ NOT NULL,
  cooldown_until TIMESTAMPTZ,
  last_scheduler_outcome TEXT NOT NULL CHECK (
    last_scheduler_outcome IN (
      'succeeded', 'failed', 'rate_limited', 'credential_gated'
    )
  ),
  last_attempt_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0
    CHECK (consecutive_failures >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (cooldown_until IS NULL OR cooldown_until >= COALESCE(last_attempt_at, '-infinity'::TIMESTAMPTZ))
);
CREATE INDEX source_scheduler_state_next_eligible_idx
  ON source_scheduler_state (next_eligible_run_at, source_id);

COMMIT;
