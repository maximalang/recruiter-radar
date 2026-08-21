BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE rf_coverage_benchmark_runs_v1 (
  id BIGSERIAL PRIMARY KEY,
  benchmark_id TEXT NOT NULL CHECK (BTRIM(benchmark_id) <> ''),
  benchmark_version INTEGER NOT NULL CHECK (benchmark_version > 0),
  manifest_hash CHAR(64) NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  passed BOOLEAN NOT NULL,
  population JSONB NOT NULL CHECK (JSONB_TYPEOF(population) = 'object'),
  metrics JSONB NOT NULL CHECK (JSONB_TYPEOF(metrics) = 'object'),
  checks JSONB NOT NULL CHECK (JSONB_TYPEOF(checks) = 'object'),
  report JSONB NOT NULL CHECK (JSONB_TYPEOF(report) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (window_end > window_start),
  UNIQUE (benchmark_id, benchmark_version, manifest_hash, window_end)
);

CREATE INDEX rf_coverage_benchmark_runs_v1_history_idx
  ON rf_coverage_benchmark_runs_v1 (benchmark_id, generated_at DESC, id DESC);

COMMIT;
