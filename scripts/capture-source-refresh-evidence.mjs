#!/usr/bin/env node
/**
 * Daily Source Refresh Clock evidence capture runner (task t_e64a6b6e).
 *
 * Inputs (all fail-closed, no repo-file fallback):
 *   COVERAGE_DAY_UTC        YYYY-MM-DD to capture (UTC day of the producing run)
 *   REFRESH_RUNS_DIR        dir with per-run run summaries (coverage-producer format)
 *   COVERAGE_SNAPSHOT_DIR   builder output dir (<day>.json | <day>.pending.json)
 *   SOURCE_REFRESH_LOGS_DIR dir of downloaded per-run artifact dirs, one directory
 *                           per run named by run_id (github-run-manifest.json + log payload)
 *   REPO_SHA                full 40-hex git sha of THIS capture run (identity only; the
 *                           snapshot's producer identity is authority-bound by the builder)
 *   WORKFLOW_RUN_URL        github Actions run URL of the producing workflow run
 *   DATABASE_URL            Postgres connection string (required, never logged)
 *
 * Exit codes (each is an incident signal for the daily window):
 *   0 — captured (inserted / upgraded / unchanged), alerts persisted
 *   2 — invalid/missing configuration (fail closed, no DB writes)
 *   3 — snapshot artifact missing for the day (missing-snapshot alert persisted first)
 *   4 — persistence failed; store out of sync with local evidence (fail closed)
 *   5 — evidence integrity/provenance violation (tamper, mismatch, incomplete archive)
 *
 * A missing published snapshot for a PAST day is durable RED evidence: the sweep in
 * step 7 persists a missing_snapshot/late_snapshot alert carrying that day as
 * evidence_day_utc, so window math counts the absence as RED, never as blank.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';
import {
  persistSnapshot,
  persistLogArchiveIndex,
  persistAlerts,
  resolveAlertsForRecoveredDay,
  deriveAlerts,
  deriveMissingSnapshotAlert,
  verifySnapshotIntegrity,
  listOpenAlerts,
} from './lib/source-refresh-evidence-store.mjs';
import { recomputeSnapshotHash } from './lib/coverage-integrity.mjs';
import {
  readAuthorityManifest,
  computeArtifactDigest,
} from './lib/coverage-authority.mjs';

/** Byte totals for the raw payload of one run artifact dir (manifest excluded). */
function walkPayloadFiles(dir, prefix = '') {
  const totals = { bytes: 0 };
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      totals.bytes += walkPayloadFiles(p, relative).bytes;
    } else if (entry.isFile() && entry.name !== 'github-run-manifest.json') {
      totals.bytes += fs.statSync(p).size;
    }
  }
  return totals;
}


function failWith(code, message) {
  console.error(`source-refresh-evidence-capture: ${message}`);
  process.exit(code);
}

function readJson(p, failCode, what) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (error) {
    failWith(failCode, `${what} unreadable at ${p}: ${error.message}`);
  }
}

function utcOffsetDays(dayStr, delta) {
  const d = new Date(`${dayStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// ---- 1. Configuration (fail closed) ----------------------------------------
const DAY = process.env.COVERAGE_DAY_UTC?.trim() ?? '';
const RUNS_DIR = process.env.REFRESH_RUNS_DIR?.trim() ?? '';
const SNAPSHOT_DIR = process.env.COVERAGE_SNAPSHOT_DIR?.trim() ?? '';
const LOGS_DIR = process.env.SOURCE_REFRESH_LOGS_DIR?.trim() ?? '';
const REPO_SHA = process.env.REPO_SHA?.trim() ?? '';
const RUN_URL = process.env.WORKFLOW_RUN_URL?.trim() ?? '';
const DATABASE_URL = process.env.DATABASE_URL?.trim() ?? '';

if (!/^\d{4}-\d{2}-\d{2}$/.test(DAY)) failWith(2, `COVERAGE_DAY_UTC must be YYYY-MM-DD, got "${DAY}"`);
if (!RUNS_DIR) failWith(2, 'REFRESH_RUNS_DIR is required');
if (!SNAPSHOT_DIR) failWith(2, 'COVERAGE_SNAPSHOT_DIR is required');
if (!LOGS_DIR) failWith(2, 'SOURCE_REFRESH_LOGS_DIR is required');
if (!/^[0-9a-f]{40}$/.test(REPO_SHA)) failWith(2, 'REPO_SHA must be a full 40-hex SHA');
if (!/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/actions\/runs\/\d+/.test(RUN_URL)) {
  failWith(2, `WORKFLOW_RUN_URL must be a github Actions run URL, got "${RUN_URL}"`);
}
if (!DATABASE_URL) failWith(2, 'DATABASE_URL is required (never logged)');

// ---- 2. Load the builder output for the day (fail closed on absence) -------
// <day>.json is the published snapshot; <day>.pending.json is a PENDING_CLOSE draft.
// A missing artifact for a past day becomes durable missing-snapshot evidence.
const SNAP_FILE = `${DAY}.json`;
const PENDING_FILE = `${DAY}.pending.json`;
const snapPath = path.join(SNAPSHOT_DIR, SNAP_FILE);
const pendingPath = path.join(SNAPSHOT_DIR, PENDING_FILE);
const usingPending = !fs.existsSync(snapPath) && fs.existsSync(pendingPath);
const resolvedSnapPath = usingPending ? pendingPath : snapPath;
if (!fs.existsSync(resolvedSnapPath)) {
  console.error(`snapshot artifact missing for ${DAY} — recording missing-snapshot evidence for ${DAY}`);
  const alertClient = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 10000 });
  try {
    await alertClient.connect();
    await persistAlerts(alertClient, [deriveMissingSnapshotAlert(DAY, { nowMs: Date.now() })]);
  } catch (error) {
    failWith(4, `could not persist missing-snapshot alert: ${error.message}`);
  } finally {
    await alertClient.end().catch(() => {});
  }
  failWith(3, `snapshot artifact missing: expected ${SNAP_FILE} (or ${PENDING_FILE}) under ${SNAPSHOT_DIR}`);
}
const snapshot = readJson(resolvedSnapPath, 3, 'snapshot artifact');
if (snapshot?.evidence_day_utc !== DAY) {
  failWith(5, `snapshot artifact evidence_day_utc=${snapshot?.evidence_day_utc} does not match requested day ${DAY}`);
}

// ---- 3. Producer identity (form-checked here; authority-bound by builder) ---
// producer.* identifies the CLOCK runs that produced the evidence (already verified
// against the downloaded artifacts by the builder), NOT this capture run. The capture
// run's own identity travels in meta.captured_by_run_url, so backfill re-captures of
// older days never trip a false provenance mismatch.
const producerSha = snapshot.producer?.repo_sha ?? '';
if (!/^[0-9a-f]{40}$/.test(producerSha)) {
  failWith(5, `producer.repo_sha missing or not a full 40-hex SHA (got "${producerSha}")`);
}

// ---- 4. Local tamper check (before any DB write) ----------------------------
const recomputedLocal = recomputeSnapshotHash(snapshot);
if (recomputedLocal !== snapshot.snapshot_hash) {
  failWith(5, `snapshot_hash mismatch for ${DAY}: re-computed ${recomputedLocal}, stored ${snapshot.snapshot_hash}`);
}

// ---- 5. Validate per-run artifact dirs + collector summaries (fail closed) --
// Canonical protocol layout: SOURCE_REFRESH_LOGS_DIR contains one directory per run,
// NAMED by its run_id, holding github-run-manifest.json + raw log payload; the
// collector (scripts/collect-refresh-logs.mjs) has already derived
// REFRESH_RUNS_DIR/<run_id>.json summaries bound to those artifacts. The archive
// digest vocabulary is exactly the authority toolchain's (computeArtifactDigest /
// readAuthorityManifest) so DB digests are comparable with collector summaries.
const archiveEntries = [];
if (!fs.existsSync(LOGS_DIR)) failWith(2, `SOURCE_REFRESH_LOGS_DIR does not exist: ${LOGS_DIR}`);
if (!fs.existsSync(RUNS_DIR)) failWith(2, `REFRESH_RUNS_DIR does not exist: ${RUNS_DIR}`);
for (const entry of fs.readdirSync(LOGS_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = path.join(LOGS_DIR, entry.name);
  let authority;
  try {
    authority = readAuthorityManifest(dir, entry.name);
  } catch (error) {
    failWith(5, `run dir ${entry.name}: authority manifest invalid: ${error.message}`);
  }
  const artifactDigest = computeArtifactDigest(dir);
  if (!/^[0-9a-f]{64}$/.test(artifactDigest ?? '')) {
    failWith(5, `run ${authority.manifest.run_id}: downloaded artifact digest missing — fail closed`);
  }
  const summaryPath = path.join(RUNS_DIR, `${authority.manifest.run_id}.json`);
  if (!fs.existsSync(summaryPath)) {
    failWith(5, `collector summary missing for run ${authority.manifest.run_id} (${summaryPath}) — run collect-refresh-logs.mjs first`);
  }
  const summaryBytes = fs.readFileSync(summaryPath);
  const payloadBytes = walkPayloadFiles(dir);
  archiveEntries.push({
    run_id: String(authority.manifest.run_id),
    run_number: authority.manifest.run_number,
    run_attempt: authority.manifest.run_attempt,
    repository: authority.manifest.repository,
    workflow_name: authority.manifest.workflow_name,
    event_name: authority.manifest.event_name,
    scheduled_at_tick: authority.manifest.scheduled_at_tick,
    head_sha: authority.manifest.head_sha,
    artifact_name: authority.manifest.artifact_name,
    authority_manifest_sha256: authority.manifest_sha256,
    log_artifact_digest: artifactDigest,
    log_bytes: payloadBytes.bytes,
    storage_key: `source-refresh-logs/${DAY}/${authority.manifest.run_id}/`,
    summary_sha256: createHash('sha256').update(summaryBytes).digest('hex'),
    archived_by_run_url: RUN_URL,
  });
}
if (archiveEntries.length === 0) failWith(5, 'no downloadable tick artifacts found — snapshot without producer evidence is not capturable');

// ---- 6. Persist: archive index, snapshot, integrity, alerts (one tx) --------
const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 10000 });
let summary;
try {
  await client.connect();
  await client.query('BEGIN');

  for (const entry of archiveEntries) {
    await persistLogArchiveIndex(client, entry);
  }

  const snapResult = await persistSnapshot(client, snapshot, {
    snapshot_file: usingPending ? PENDING_FILE : SNAP_FILE,
    captured_by_run_url: RUN_URL,
  });
  // The day now has durable evidence: recover any open missing/late alert for it.
  await resolveAlertsForRecoveredDay(client, DAY);

  const integrity = await verifySnapshotIntegrity(client, DAY, recomputeSnapshotHash, recomputeSnapshotHash);
  if (!integrity.present) failWith(4, `snapshot for ${DAY} missing after persistSnapshot — store inconsistent`);
  if (integrity.tampered) failWith(5, `stored snapshot for ${DAY} failed hash re-computation (tamper)`);
  if (integrity.chainBroken) {
    console.error(`hash-chain problem for ${DAY}: ${integrity.chainProblem}`);
  }

  const alerts = deriveAlerts(snapshot, {
    tampered: integrity.tampered,
    chainBroken: integrity.chainBroken,
    chainProblem: integrity.chainProblem,
  });
  const alertResults = await persistAlerts(client, alerts);

  await client.query('COMMIT');
  summary = {
    ok: true,
    day: DAY,
    snapshot: snapResult.status,
    snapshot_hash: snapResult.snapshot_hash,
    day_status: snapshot.day_status,
    alerts_persisted: alertResults.length,
    runs_archived: archiveEntries.length,
  };
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  failWith(4, `capture failed: ${error.message}`);
} finally {
  await client.end().catch(() => {});
}

// ---- 7. Missing-snapshot sweep over the live 7-day window -------------------
// Any of the previous 7 days without a PUBLISHED snapshot in the store becomes a
// durable missing_snapshot/late_snapshot alert (RED evidence for the absent day).
const sweepClient = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 10000 });
try {
  await sweepClient.connect();
  for (let delta = 1; delta <= 7; delta += 1) {
    const pastDay = utcOffsetDays(DAY, -delta);
    const { rows } = await sweepClient.query(
      `SELECT 1 FROM source_refresh_evidence_snapshots
       WHERE evidence_day_utc = $1 AND snapshot_published = TRUE LIMIT 1`,
      [pastDay],
    );
    if (rows.length === 0) {
      await persistAlerts(sweepClient, [deriveMissingSnapshotAlert(pastDay, { nowMs: Date.now() })]);
    }
  }
  const open = await listOpenAlerts(sweepClient, 100);
  summary.open_alert_count = open.length;
  summary.open_alert_days = [...new Set(open.map((a) => a.evidence_day_utc))].sort();
} catch (error) {
  failWith(4, `missing-snapshot sweep failed: ${error.message}`);
} finally {
  await sweepClient.end().catch(() => {});
}

console.log(JSON.stringify(summary));
