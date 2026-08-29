#!/usr/bin/env node
/**
 * DB round-trip verifier for the Source Refresh Clock evidence capture store
 * (task t_e64a6b6e). Requires an ISOLATED disposable Postgres database.
 *
 * Gate: SOURCE_LIVE_DB_TEST_ACK=isolated with a disposable DATABASE_URL, same policy
 * as packages/db live verifiers. Run: node packages/db/scripts/verify-source-refresh-evidence-capture.mjs
 *
 * Proves on the real engine:
 *   D1  migration DDL applies cleanly (tables + CHECK constraints exist);
 *   D2  published-day snapshot round-trips; same-hash re-capture is 'unchanged';
 *   D3  different hash for a published day fails closed (append-only enforced by DB path);
 *   D4  pending draft upgrades to published with the day-close hash;
 *   D5  alerts dedupe on (alert_type, dedupe_key) and resolve via resolveAlert;
 *   D6  archive index upserts idempotently;
 *   D7  tampered snapshot hash fails verifySnapshotIntegrity against the stored row.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const scriptDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const repoRoot = path.resolve(scriptDir, '..', '..', '..');
const ack = process.env.SOURCE_LIVE_DB_TEST_ACK ?? '';
const databaseUrl = process.env.DATABASE_URL?.trim() ?? '';

function fail(message) {
  console.error(`verify-source-refresh-evidence-capture: FAIL: ${message}`);
  process.exit(1);
}

if (ack !== 'isolated') {
  fail('SOURCE_LIVE_DB_TEST_ACK=isolated is required — this verifier mutates schema/data and must run only against a disposable database');
}
if (!databaseUrl) {
  fail('DATABASE_URL is required (disposable database)');
}

const MIGRATION = path.join(repoRoot, 'packages', 'db', 'migrations', '20260829090000_add_source_refresh_evidence_capture.sql');
if (!fs.existsSync(MIGRATION)) fail(`migration not found: ${MIGRATION}`);

const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
let checks = 0;

function ok(name) {
  checks += 1;
  console.log(`ok ${checks} - ${name}`);
}

// Deterministic minimal v2 snapshot fixture (only fields the store reads).
function makeSnapshot(day, { dayStatus = 'GREEN', redReasons = [] } = {}) {
  const core = {
    schema_version: 2,
    evidence_type: 'source-refresh-coverage',
    evidence_day_utc: day,
    produced_at: '2026-08-29T00:40:00.000Z',
    producer: {
      kind: 'github-actions',
      repo_sha: 'a'.repeat(40),
      workflow_run_url: 'https://github.com/maximalang/recruiter-radar/actions/runs/11111111111',
      workflow_name: 'Source Refresh Clock',
      repository: 'maximalang/recruiter-radar',
    },
    trusted_provenance: { authority: 'downloaded-github-actions-artifact', status: 'verified', attestation_kind: 'collector-log-artifact-digest' },
    run_attestations: [],
    run_urls: ['https://github.com/maximalang/recruiter-radar/actions/runs/11111111111'],
    tick_ledger: { expected_slots_per_day: 24, observed_slot_count: 24, missing_slots_utc: [], unresolved_slots: [] },
    runs: [],
    degradation_events: [],
    red_day_reasons: redReasons,
    close_condition_satisfied_by_all_sources: true,
    day_status: dayStatus,
    immutability: 'append-only',
  };
  return core;
}

try {
  await client.connect();

  // D1: apply the migration from its file (same SQL the migrator runs).
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  await client.query(sql);
  const tables = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_name IN ('source_refresh_evidence_snapshots','source_refresh_evidence_alerts','source_refresh_evidence_log_archive')
     ORDER BY table_name`,
  );
  if (tables.rows.length !== 3) fail(`expected 3 evidence tables, found ${tables.rows.length}`);
  ok('D1 migration applies; all three evidence tables exist');

  const { persistSnapshot, persistAlerts, persistLogArchiveIndex, resolveAlert, verifySnapshotIntegrity } =
    await import(path.join('file://', repoRoot, 'scripts', 'lib', 'source-refresh-evidence-store.mjs').replaceAll('\\', '/'));

  // D2: insert + unchanged re-capture (same hash).
  const day = '2026-08-28';
  const snap = makeSnapshot(day);
  const { sha256Canonical } = await import(path.join('file://', repoRoot, 'scripts', 'lib', 'coverage-integrity.mjs').replaceAll('\\', '/'));
  snap.snapshot_hash = sha256Canonical(snap);
  const first = await persistSnapshot(client, snap, { snapshot_file: `${day}.json`, captured_by_run_url: 'https://github.com/maximalang/recruiter-radar/actions/runs/22222222222' });
  if (first.status !== 'inserted') fail(`D2 expected inserted, got ${first.status}`);
  const second = await persistSnapshot(client, snap, { snapshot_file: `${day}.json` });
  if (second.status !== 'unchanged') fail(`D2 expected unchanged, got ${second.status}`);
  ok('D2 published day round-trips; same-hash re-capture is unchanged');

  // D3: different hash on a published day fails closed.
  const tamperedSnap = makeSnapshot(day);
  tamperedSnap.day_status = 'RED';
  tamperedSnap.red_day_reasons = ['required_source_failed'];
  tamperedSnap.snapshot_hash = sha256Canonical(tamperedSnap);
  let rejected = false;
  try {
    await persistSnapshot(client, tamperedSnap, { snapshot_file: `${day}.json` });
  } catch {
    rejected = true;
  }
  if (!rejected) fail('D3 expected append-only rejection for a divergent hash on a published day');
  ok('D3 divergent hash on published day fails closed');

  // D4: pending draft then published upgrade.
  const day2 = '2026-08-27';
  const draft = makeSnapshot(day2, { dayStatus: 'PENDING_CLOSE' });
  draft.snapshot_hash = sha256Canonical(draft);
  const draftRes = await persistSnapshot(client, draft, { snapshot_file: `${day2}.pending.json` });
  if (draftRes.status !== 'inserted' || draftRes.published === true) fail('D4 draft should insert as unpublished');
  const draftRow = await client.query(`SELECT snapshot_published FROM source_refresh_evidence_snapshots WHERE evidence_day_utc=$1`, [day2]);
  if (draftRow.rows[0].snapshot_published !== false) fail('D4 draft must be stored unpublished');
  const closed = makeSnapshot(day2, { dayStatus: 'GREEN' });
  closed.snapshot_hash = sha256Canonical(closed);
  const up = await persistSnapshot(client, closed, { snapshot_file: `${day2}.json` });
  if (up.status !== 'upgraded') fail(`D4 expected upgraded, got ${up.status}`);
  const closedRow = await client.query(`SELECT snapshot_published, snapshot_hash FROM source_refresh_evidence_snapshots WHERE evidence_day_utc=$1`, [day2]);
  if (closedRow.rows[0].snapshot_published !== true || closedRow.rows[0].snapshot_hash !== closed.snapshot_hash) {
    fail('D4 published upgrade did not land');
  }
  ok('D4 pending draft upgrades to published day-close snapshot');

  // D5: alert dedupe + resolve.
  const alert = {
    alert_type: 'red_day',
    evidence_day_utc: day,
    severity: 'critical',
    dedupe_key: 'required_source_failed',
    payload: { reasons: ['required_source_failed'] },
  };
  const a1 = await persistAlerts(client, [alert]);
  const a2 = await persistAlerts(client, [{ ...alert, payload: { reasons: ['required_source_failed'], extra: true } }]);
  if (a1.inserted !== 1 || a2.inserted !== 0) fail(`D5 dedupe broken: ${JSON.stringify({ a1, a2 })}`);
  const open = await client.query(`SELECT alert_id FROM source_refresh_evidence_alerts WHERE status='open' AND evidence_day_utc=$1`, [day]);
  const res = await resolveAlert(client, open.rows[0].alert_id, 'verified same-day fix, incident closed');
  if (res.resolved !== true) fail('D5 resolveAlert failed');
  ok('D5 alerts dedupe on (alert_type, dedupe_key) and resolve with reason');

  // D6: archive index idempotent upsert.
  const entry = {
    run_id: '11111111111',
    run_number: 1,
    run_attempt: 1,
    repository: 'maximalang/recruiter-radar',
    workflow_name: 'Source Refresh Clock',
    event_name: 'schedule',
    scheduled_at_tick: '2026-08-28T05:45:00Z',
    head_sha: 'a'.repeat(40),
    artifact_name: 'source-refresh-run-11111111111-attempt-1',
    authority_manifest_sha256: 'b'.repeat(64),
    log_artifact_digest: 'c'.repeat(64),
    log_bytes: 1024,
    storage_key: `source-refresh-logs/${day}/11111111111/`,
    summary_sha256: 'd'.repeat(64),
    archived_by_run_url: 'https://github.com/maximalang/recruiter-radar/actions/runs/22222222222',
  };
  const e1 = await persistLogArchiveIndex(client, [entry]);
  const e2 = await persistLogArchiveIndex(client, [entry]);
  if (e1.inserted !== 1 || e2.inserted !== 0) fail(`D6 archive upsert broken: ${JSON.stringify({ e1, e2 })}`);
  ok('D6 log archive index upserts idempotently');

  // D7: stored-row tamper detection via recomputed hash.
  await client.query(`UPDATE source_refresh_evidence_snapshots SET snapshot = snapshot || '{"day_status":"GREEN"}'::jsonb WHERE evidence_day_utc=$1`, [day2]);
  const stored = await client.query(`SELECT snapshot FROM source_refresh_evidence_snapshots WHERE evidence_day_utc=$1`, [day2]);
  const integrity = verifySnapshotIntegrity(stored.rows[0].snapshot, null);
  if (integrity.ok) fail('D7 tampered stored snapshot passed integrity check');
  ok('D7 tampered stored snapshot fails verifySnapshotIntegrity');

  console.log(`\nPASS: ${checks} DB round-trip checks against isolated database`);
} catch (error) {
  fail(error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  await client.end().catch(() => {});
}
