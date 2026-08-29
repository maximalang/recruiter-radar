-- Source Refresh Clock: durable daily evidence capture (task t_e64a6b6e).
--
-- Protocol v2 daily-capture instrumentation (§9, §16):
--   source_refresh_evidence_snapshots — one row per published daily coverage snapshot
--     (immutable evidence object, append-only by construction; re-capture is idempotent
--     via snapshot_hash and rejected on hash divergence).
--   source_refresh_evidence_log_archive — raw downloaded artifact index per run_id
--     (digest + size + archive location reference; content stays in artifact storage).
--   source_refresh_evidence_alerts — derived alerts for red days, missing/late snapshots,
--     tick-ledger defects and tamper-detected snapshots; idempotent by (alert_type,
--     evidence_day_utc, dedupe_key), re-open within the quiet window instead of duplicating.
--
-- Fail-closed: snapshot rows require a re-computable snapshot_hash and producer identity;
-- alerts are derived by application code from the snapshot object, never trusted from input.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE source_refresh_evidence_snapshots (
  evidence_day_utc DATE PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 2),
  window_id TEXT,
  day_status TEXT NOT NULL CHECK (
    day_status IN ('GREEN_DAY', 'RED_DAY', 'PENDING_CLOSE')
  ),
  snapshot_hash TEXT NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  predecessor_snapshot_hash TEXT CHECK (
    predecessor_snapshot_hash IS NULL
    OR predecessor_snapshot_hash ~ '^[0-9a-f]{64}$'
  ),
  producer_repo_sha TEXT NOT NULL CHECK (producer_repo_sha ~ '^[0-9a-f]{40}$'),
  producer_workflow_run_url TEXT NOT NULL CHECK (
    producer_workflow_run_url ~ '^https://github\.com/[^/\s]+/[^/\s]+/actions/runs/[0-9]+'
  ),
  producer_repository TEXT NOT NULL CHECK (BTRIM(producer_repository) <> ''),
  run_attestation_count INTEGER NOT NULL CHECK (run_attestation_count >= 0),
  red_day_reasons JSONB NOT NULL CHECK (JSONB_TYPEOF(red_day_reasons) = 'array'),
  close_condition_satisfied_by_all_sources BOOLEAN NOT NULL,
  tick_ledger JSONB NOT NULL CHECK (
    JSONB_TYPEOF(tick_ledger) = 'object'
    AND JSONB_TYPEOF(tick_ledger -> 'missing_slots_utc') = 'array'
    AND JSONB_TYPEOF(tick_ledger -> 'duplicate_slots') = 'array'
    AND JSONB_TYPEOF(tick_ledger -> 'unresolved_slots') = 'array'
  ),
  runs JSONB NOT NULL CHECK (JSONB_TYPEOF(runs) = 'array'),
  degradation_events JSONB NOT NULL CHECK (JSONB_TYPEOF(degradation_events) = 'array'),
  provenance_status TEXT NOT NULL CHECK (
    provenance_status IN ('verified', 'unverified')
  ),
  provenance_problems JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (JSONB_TYPEOF(provenance_problems) = 'array'),
  snapshot_published BOOLEAN NOT NULL,
  snapshot_file TEXT NOT NULL CHECK (BTRIM(snapshot_file) <> ''),
  snapshot JSONB NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  captured_by_run_url TEXT
);

COMMENT ON TABLE source_refresh_evidence_snapshots IS
  'Source Refresh Clock daily coverage snapshots (schema v2), append-only by day; re-capture only with identical snapshot_hash.';

CREATE TABLE source_refresh_evidence_log_archive (
  run_id TEXT PRIMARY KEY CHECK (run_id ~ '^[0-9]+$'),
  run_number INTEGER NOT NULL CHECK (run_number > 0),
  run_attempt INTEGER NOT NULL CHECK (run_attempt > 0),
  repository TEXT NOT NULL CHECK (BTRIM(repository) <> ''),
  workflow_name TEXT NOT NULL CHECK (BTRIM(workflow_name) <> ''),
  event_name TEXT NOT NULL CHECK (BTRIM(event_name) <> ''),
  scheduled_at_tick TEXT NOT NULL CHECK (BTRIM(scheduled_at_tick) <> ''),
  head_sha TEXT NOT NULL CHECK (head_sha ~ '^[0-9a-f]{40}$'),
  artifact_name TEXT NOT NULL CHECK (BTRIM(artifact_name) <> ''),
  authority_manifest_sha256 TEXT NOT NULL CHECK (authority_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  log_artifact_digest TEXT NOT NULL CHECK (log_artifact_digest ~ '^[0-9a-f]{64}$'),
  log_bytes BIGINT NOT NULL CHECK (log_bytes >= 0),
  storage_key TEXT NOT NULL CHECK (BTRIM(storage_key) <> ''),
  summary_sha256 TEXT NOT NULL CHECK (summary_sha256 ~ '^[0-9a-f]{64}$'),
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_by_run_url TEXT
);

COMMENT ON TABLE source_refresh_evidence_log_archive IS
  'Raw Source Refresh Clock artifact index: per-run digest/size plus storage reference; content remains in artifact storage.';

CREATE TABLE source_refresh_evidence_alerts (
  alert_uid TEXT PRIMARY KEY,
  alert_type TEXT NOT NULL CHECK (
    alert_type IN (
      'red_day',
      'missing_snapshot',
      'late_snapshot',
      'tick_ledger_defect',
      'tamper_detected',
      'hash_chain_broken',
      'provenance_unverified'
    )
  ),
  evidence_day_utc DATE NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('warning', 'critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  dedupe_key TEXT NOT NULL,
  payload JSONB NOT NULL CHECK (JSONB_TYPEOF(payload) = 'object'),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX source_refresh_evidence_alerts_day_idx
  ON source_refresh_evidence_alerts (evidence_day_utc, status);
CREATE INDEX source_refresh_evidence_alerts_open_idx
  ON source_refresh_evidence_alerts (status, alert_type)
  WHERE status = 'open';
CREATE UNIQUE INDEX source_refresh_evidence_alerts_dedupe_uidx
  ON source_refresh_evidence_alerts (alert_type, evidence_day_utc, dedupe_key);

COMMENT ON TABLE source_refresh_evidence_alerts IS
  'Derived Source Refresh Clock alerts (red/missing/late snapshot, tick-ledger, tamper, chain); idempotent by (alert_type, evidence_day_utc, dedupe_key).';

COMMIT;
