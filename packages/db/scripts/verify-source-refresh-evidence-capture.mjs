#!/usr/bin/env node
/**
 * DB round-trip verifier for the Source Refresh Clock evidence capture store.
 * Requires SOURCE_LIVE_DB_TEST_ACK=isolated and a disposable DATABASE_URL.
 *
 * D1 migration up/down/up applies and exposes the append-only/alert schema.
 * D2 published snapshot inserts then same-hash re-capture is unchanged.
 * D3 DB and application paths reject rewrites of a published snapshot.
 * D4 PENDING_CLOSE draft upgrades exactly once to a published snapshot.
 * D5 alerts dedupe and preserve a resolution reason.
 * D6 concurrent archive capture is idempotent; a divergent digest fails closed.
 * D7 integrity verification detects a stored-row corruption when integrity controls
 *    are deliberately bypassed in this isolated verifier.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
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
if (!databaseUrl) fail('DATABASE_URL is required (disposable database)');

const migrationPath = path.join(repoRoot, 'packages', 'db', 'migrations', '20260829090000_add_source_refresh_evidence_capture.sql');
const downMigrationPath = path.join(repoRoot, 'packages', 'db', 'migrations', '20260829090000_add_source_refresh_evidence_capture.down.sql');
if (!fs.existsSync(migrationPath) || !fs.existsSync(downMigrationPath)) {
  fail('source-refresh evidence migration up/down files are required');
}

const store = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'lib', 'source-refresh-evidence-store.mjs')).href);
const integrity = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'lib', 'coverage-integrity.mjs')).href);
const {
  persistSnapshot,
  persistAlerts,
  persistLogArchiveIndex,
  resolveAlert,
  verifySnapshotIntegrity,
} = store;
const { sha256Canonical, recomputeSnapshotHash } = integrity;

let checks = 0;
function ok(name) {
  checks += 1;
  console.log(`ok ${checks} - ${name}`);
}

function makeSnapshot(day, { dayStatus = 'GREEN_DAY', redReasons = [] } = {}) {
  const snapshot = {
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
    trusted_provenance: {
      authority: 'downloaded-github-actions-artifact',
      status: 'verified',
      attestation_kind: 'collector-log-artifact-digest',
    },
    run_attestations: [],
    run_urls: ['https://github.com/maximalang/recruiter-radar/actions/runs/11111111111'],
    tick_ledger: {
      expected_slots_per_day: 24,
      observed_slot_count: 24,
      missing_slots_utc: [],
      duplicate_slots: [],
      unresolved_slots: [],
    },
    runs: [],
    degradation_events: [],
    red_day_reasons: redReasons,
    close_condition_satisfied_by_all_sources: dayStatus !== 'PENDING_CLOSE',
    day_status: dayStatus,
    immutability: 'append-only',
  };
  snapshot.snapshot_hash = sha256Canonical(snapshot);
  return snapshot;
}

function archiveEntry(day, runId = '11111111111') {
  return {
    run_id: runId,
    run_number: 1,
    run_attempt: 1,
    repository: 'maximalang/recruiter-radar',
    workflow_name: 'Source Refresh Clock',
    event_name: 'schedule',
    scheduled_at_tick: `${day}T05:45:00Z`,
    head_sha: 'a'.repeat(40),
    artifact_name: `source-refresh-run-${runId}-attempt-1`,
    authority_manifest_sha256: 'b'.repeat(64),
    log_artifact_digest: 'c'.repeat(64),
    log_bytes: 1024,
    storage_key: `source-refresh-logs/${day}/${runId}/`,
    summary_sha256: 'd'.repeat(64),
    archived_by_run_url: 'https://github.com/maximalang/recruiter-radar/actions/runs/22222222222',
  };
}

async function rejects(action) {
  try {
    await action();
    return false;
  } catch {
    return true;
  }
}

const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
try {
  await client.connect();

  // D1: use exactly the migration files that the migrator applies, including rollback.
  const upSql = fs.readFileSync(migrationPath, 'utf8');
  const downSql = fs.readFileSync(downMigrationPath, 'utf8');
  await client.query(upSql);
  const tables = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = current_schema()
       AND table_name IN ('source_refresh_evidence_snapshots', 'source_refresh_evidence_alerts', 'source_refresh_evidence_log_archive')
     ORDER BY table_name`,
  );
  const resolutionColumn = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'source_refresh_evidence_alerts'
       AND column_name = 'resolution_reason'`,
  );
  if (tables.rows.length !== 3 || resolutionColumn.rows.length !== 1) {
    fail('D1 migration did not create all evidence tables and resolution_reason');
  }
  await client.query(downSql);
  const removed = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = current_schema()
       AND table_name LIKE 'source_refresh_evidence_%'`,
  );
  if (removed.rows.length !== 0) fail('D1 down migration left evidence tables behind');
  await client.query(upSql);
  ok('D1 migration up/down/up applies with evidence tables, append-only triggers, and alert reason schema');

  const day = '2026-08-28';
  const snap = makeSnapshot(day);

  // D2: published snapshot is independently readable and same content is idempotent.
  const first = await persistSnapshot(client, snap, {
    snapshot_file: `${day}.json`,
    captured_by_run_url: 'https://github.com/maximalang/recruiter-radar/actions/runs/22222222222',
  });
  const second = await persistSnapshot(client, snap, { snapshot_file: `${day}.json` });
  if (first.status !== 'inserted' || first.published !== true || second.status !== 'unchanged') {
    fail(`D2 published idempotency failed: ${JSON.stringify({ first, second })}`);
  }
  ok('D2 published snapshot inserts and same-hash re-capture is unchanged');

  // D3: application conflict logic and direct SQL both reject published evidence rewrites.
  const divergent = makeSnapshot(day, { dayStatus: 'RED_DAY', redReasons: ['required_source_failed'] });
  if (!(await rejects(() => persistSnapshot(client, divergent, { snapshot_file: `${day}.json` })))) {
    fail('D3 application path accepted a divergent published snapshot');
  }
  if (!(await rejects(() => client.query(
    `UPDATE source_refresh_evidence_snapshots
     SET snapshot = snapshot || '{"day_status":"RED_DAY"}'::jsonb
     WHERE evidence_day_utc = $1`,
    [day],
  )))) {
    fail('D3 database append-only trigger accepted a published snapshot rewrite');
  }
  ok('D3 divergent published snapshot fails closed in application and database paths');

  // D4: a draft may transition once, and only to a published closing snapshot.
  const draftDay = '2026-08-27';
  const draft = makeSnapshot(draftDay, { dayStatus: 'PENDING_CLOSE' });
  const draftResult = await persistSnapshot(client, draft, { snapshot_file: `${draftDay}.pending.json` });
  const closed = makeSnapshot(draftDay);
  const closeResult = await persistSnapshot(client, closed, { snapshot_file: `${draftDay}.json` });
  const storedDraft = await client.query(
    `SELECT snapshot_published, snapshot_hash FROM source_refresh_evidence_snapshots WHERE evidence_day_utc = $1`,
    [draftDay],
  );
  if (draftResult.status !== 'inserted' || draftResult.published !== false
      || closeResult.status !== 'upgraded' || closeResult.published !== true
      || storedDraft.rows[0]?.snapshot_published !== true
      || storedDraft.rows[0]?.snapshot_hash !== closed.snapshot_hash) {
    fail(`D4 draft->published transition failed: ${JSON.stringify({ draftResult, closeResult })}`);
  }
  ok('D4 pending draft transitions once to the published day-close snapshot');

  // D5: unique alert identity is idempotent and closure persists an audit reason.
  const alert = {
    alert_type: 'red_day',
    evidence_day_utc: day,
    severity: 'critical',
    dedupe_key: 'required_source_failed',
    payload: { reasons: ['required_source_failed'] },
  };
  const [a1] = await persistAlerts(client, [alert]);
  const [a2] = await persistAlerts(client, [{ ...alert, payload: { reasons: ['required_source_failed'], refreshed: true } }]);
  if (a1.status !== 'inserted' || a2.status !== 'refreshed') {
    fail(`D5 alert dedupe failed: ${JSON.stringify({ a1, a2 })}`);
  }
  const open = await client.query(
    `SELECT alert_uid FROM source_refresh_evidence_alerts WHERE status = 'open' AND evidence_day_utc = $1`,
    [day],
  );
  const reason = 'verified same-day fix, incident closed';
  const resolved = await resolveAlert(client, open.rows[0]?.alert_uid, reason);
  const alertState = await client.query(
    `SELECT status, resolution_reason FROM source_refresh_evidence_alerts WHERE alert_uid = $1`,
    [open.rows[0]?.alert_uid],
  );
  if (resolved.resolved !== true || alertState.rows[0]?.status !== 'resolved' || alertState.rows[0]?.resolution_reason !== reason) {
    fail('D5 resolution did not preserve the audit reason');
  }
  ok('D5 alerts dedupe and resolution preserves its reason');

  // D6: the unique insert occurs before comparison, so two capture workers race safely.
  const concurrentEntry = archiveEntry(day, '22222222222');
  const archiveA = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  const archiveB = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  try {
    await Promise.all([archiveA.connect(), archiveB.connect()]);
    const results = await Promise.all([
      persistLogArchiveIndex(archiveA, concurrentEntry),
      persistLogArchiveIndex(archiveB, concurrentEntry),
    ]);
    const statuses = results.map((result) => result.status).sort();
    if (statuses.join(',') !== 'inserted,unchanged') fail(`D6 concurrent idempotency failed: ${JSON.stringify(results)}`);
    if (!(await rejects(() => persistLogArchiveIndex(client, {
      ...concurrentEntry,
      log_artifact_digest: 'e'.repeat(64),
    })))) {
      fail('D6 divergent archive digest was accepted');
    }
  } finally {
    await Promise.all([archiveA.end().catch(() => {}), archiveB.end().catch(() => {})]);
  }
  ok('D6 concurrent archive capture is idempotent and a divergent digest fails closed');

  // D7: corruption must remain observable even if a privileged actor bypasses the guard.
  await client.query('ALTER TABLE source_refresh_evidence_snapshots DISABLE TRIGGER source_refresh_evidence_snapshot_append_only_trg');
  try {
    await client.query(
      `UPDATE source_refresh_evidence_snapshots
       SET snapshot = snapshot || '{"day_status":"RED_DAY"}'::jsonb
       WHERE evidence_day_utc = $1`,
      [draftDay],
    );
  } finally {
    await client.query('ALTER TABLE source_refresh_evidence_snapshots ENABLE TRIGGER source_refresh_evidence_snapshot_append_only_trg');
  }
  const integrityResult = await verifySnapshotIntegrity(client, draftDay, sha256Canonical, recomputeSnapshotHash);
  if (integrityResult.tampered !== true) fail('D7 tampered stored snapshot passed integrity verification');
  ok('D7 integrity verifier detects stored-row corruption after guard bypass');

  console.log(`\nPASS: ${checks} DB round-trip checks against an isolated disposable database`);
} catch (error) {
  fail(error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  await client.end().catch(() => {});
}
