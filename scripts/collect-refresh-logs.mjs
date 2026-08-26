#!/usr/bin/env node
/**
 * Source Refresh Clock run-log collector (protocol §4-§6, §8; blocker B4).
 *
 * Reads sequentially-numbered GitHub Actions run logs of the `Source Refresh Clock` workflow,
 * re-parses each run's HTTP response JSON (the route never prints per-source lines), and emits
 * one deterministic per-run summary file <REFRESH_RUNS_DIR>/<run_id>.json.
 *
 * Sources of truth:
 *   - response `data.details[]`: IngestResult rows { source, success, outcome, fetchedCount,
 *     upsertedCount, diagnostics };
 *   - diagnostic outcome classification: (source-criticality column documented in docs/source-registry.md).
 *
 * Outcome -> coverage status mapping (per refresh contract + protocol §5):
 *   ingested | ingested-with-duplicates | idempotent-replay | expected-zero
 *       with upsertedCount/normalizedCount > 0 OR expected-zero ...
 *         -> 'success' when records accepted > 0 or outcome is expected-zero;
 *   deferred                     -> 'deferred' (scheduler overlap; may resolve next run)
 *   rate-limited                 -> red for required sources, red-marker for optional degradation
 *   credential-gated | failed | missing-summary | invalid-summary | unexpected-zero |
 *   normalization-zero | ingestion-zero  -> red (fail closed)
 *
 * Usage: REFRESH_RUNS_DIR=... SOURCE_REFRESH_LOGS_DIR=... node scripts/collect-refresh-logs.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const logsDir = process.env.SOURCE_REFRESH_LOGS_DIR ?? '';
const runsDir = process.env.REFRESH_RUNS_DIR ?? '';
const workflowName = process.env.SOURCE_REFRESH_WORKFLOW_NAME ?? 'Source Refresh Clock';
const CRITICALITY_MAP_PATH = process.env.CONFIG_MANIFEST ?? '';

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (!logsDir) fail('SOURCE_REFRESH_LOGS_DIR must point to downloaded run log directories');
if (!runsDir) fail('REFRESH_RUNS_DIR must point to the output directory');

/** ------- §5 pass/fail taxonomy -------------------------------------------------------- */
/**
 * status ∈ green | green_noop | deferred | red.
 * - green:      failure-free run with actually processed records (evidence-bearing);
 * - green_noop: failure-free auditable no-op (idempotent-replay / expected-zero / zero-upsert);
 *               must stay distinguishable from green per §5, and is caught by the rolling
 *               7-day acceptance-recency check rather than painted red here;
 * - deferred:   scheduler overlap, may resolve against a sibling/next run;
 * - red:        everything else fails closed (rate-limited, credential-gated, failed,
 *               *-zero, missing-summary, invalid-summary).
 */
function classifySourceRow(row) {
  const outcome = row.outcome;
  const accepted = row.upsertedCount ?? row.diagnostics?.normalizedCount ?? 0;
  switch (outcome) {
    case 'ingested':
    case 'ingested-with-duplicates':
      return accepted > 0 ? 'green' : 'green_noop';
    case 'idempotent-replay':
    case 'expected-zero':
      return 'green_noop';
    case 'deferred':
      return 'deferred';
    default:
      return 'red';
  }
}

/** Fetch a GitHub run-jobs/logs artifact list via REST using GH_TOKEN (optional convenience). */
async function gh(pathname) {
  const token = process.env.GH_TOKEN;
  if (!token) fail('GH_TOKEN required for remote listing');
  const res = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) fail(`GitHub API ${res.status} for ${pathname}`);
  return res.json();
}

// --------- input loading --------------------------------------------------------------
fs.mkdirSync(runsDir, { recursive: true });

/**
 * Local mode: read already-downloaded run-log directories from SOURCE_REFRESH_LOGS_DIR.
 * Expected layout: <logsDir>/<run_id>/0_setup.txt .. N_sources.txt (gh run download layout)
 * A run directory qualifies when at least one .txt file embeds the source-refresh JSON payload.
 */
const runDirs = fs.readdirSync(logsDir).filter((d) => fs.statSync(path.join(logsDir, d)).isDirectory());
let processed = 0;
for (const runId of runDirs) {
  const outPath = path.join(runsDir, `${runId}.json`);
  if (fs.existsSync(outPath)) continue; // idempotent re-run of collector
  const files = fs.readdirSync(path.join(logsDir, runId)).filter((f) => f.endsWith('.txt'));
  let found = null;
  for (const f of files) {
    const text = fs.readFileSync(path.join(logsDir, runId, f), 'utf8');
    // The workflow stores the FULL raw HTTP body via $GITHUB_STEP_SUMMARY and echoes it to the job log.
    // Try direct parse first (body printed verbatim), then extract bracketed substring as fallback.
    const candidates = [];
    if (text.includes('"data"') && text.includes('"details"')) {
      try {
        candidates.push(JSON.parse(text));
      } catch {
        /* fall through to extraction below */
      }
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start !== -1 && end > start) {
        try {
          candidates.push(JSON.parse(text.slice(start, end + 1)));
        } catch {
          /* keep null */
        }
      }
    }
    for (const parsed of candidates.filter(Boolean)) {
      const details = parsed?.data?.details;
      if (!Array.isArray(details)) continue;
      found = { details, startedAt: parsed?.data?.startedAt ?? null };
      break;
    }
    if (found) break;
    // Also capture workflow metadata lines for provenance.
  }
  if (!found) continue; // unrelated run dir — skip silently
  processed += 1;
  /** derive run window metadata from response body or fallback to directory mtime */
  const anyFile = path.join(logsDir, runId);
  const stat = fs.statSync(anyFile);
  const rawStartedAt = found.startedAt ?? null;
  let startedAtMs = rawStartedAt == null ? Number.NaN : Date.parse(rawStartedAt);
  if (Number.isNaN(startedAtMs) && rawStartedAt != null) startedAtMs = Date.parse(`${rawStartedAt}Z`);
  const startedAtIso =
    !Number.isNaN(startedAtMs)
      ? new Date(startedAtMs).toISOString()
      : new Date(stat.mtimeMs).toISOString();
  fs.writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        schema_version: 1,
        run_id: runId,
        run_started_at: startedAtIso,
        sources: Object.fromEntries(
          found.details.map((row) => [
            row.source,
            {
              outcome: row.outcome,
              success: row.success === true,
              records_fetched: row.fetchedCount ?? null,
              records_accepted: row.upsertedCount ?? row.diagnostics?.normalizedCount ?? 0,
              duplicate_records: row.diagnostics?.duplicateCount ?? null,
              latency_ms: null,
              error_code: row.error ?? row.diagnostics?.zeroReason ?? null,
              status: classifySourceRow(row),
            },
          ]),
        ),
        _meta: { derived_from_log_dir: runId, processed_at: new Date().toISOString() },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}
console.log(`OK collected ${processed} new run summaries into ${runsDir} (${runDirs.length} dirs scanned)`);
if (processed === 0 && runDirs.length > 0) {
  console.error(
    'WARN: no run directories contained a source-refresh JSON payload — ' +
      'check that downloaded logs are from the Source Refresh Clock workflow',
  );
}

if (processed === 0 && runDirs.length === 0) {
  fail('no run directories found under SOURCE_REFRESH_LOGS_DIR');
}
