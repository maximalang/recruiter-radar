#!/usr/bin/env node
/**
 * Unit tests for the source-refresh evidence store (task t_e64a6b6e).
 *
 * Pure derivation + client-contract logic with a fake pg client (no real DB):
 *   U1 missing day derives a critical missing_snapshot alert carrying the day
 *   U2 late day derives late_snapshot; deriveAlerts on recovered day derives none of them
 *   U3 red day reasons map 1:1 to red_day alerts (dedupe by reason)
 *   U4 tick ledger defects: missing slots (bounded warning -> critical at >3),
 *      duplicate and unresolved slots
 *   U5 provenance_unverified derived when trusted_provenance.status != 'verified'
 *   U6 persistSnapshot: insert / unchanged re-encounter (same hash)
 *   U7 persistSnapshot: published day + different hash => append-only fail closed
 *   U8 persistSnapshot: pending draft superseded by later published day (upgrade)
 *   U9 persistLogArchiveIndex: insert then unchanged re-encounter; diverged digest fails
 *  U10 resolveAlert only closes open alerts; recovered-day resolution closes missing/late
 *  U11 verifySnapshotIntegrity: tamper + chain break against the store
 *  U12 tamper_detected alert derived on integrity failure
 *
 * Run: node --test scripts/test-source-refresh-evidence-store.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveAlerts,
  deriveMissingSnapshotAlert,
  persistSnapshot,
  persistLogArchiveIndex,
  persistAlerts,
  resolveAlert,
  resolveAlertsForRecoveredDay,
  verifySnapshotIntegrity,
} from './lib/source-refresh-evidence-store.mjs';
import { recomputeSnapshotHash, sha256Canonical } from './lib/coverage-integrity.mjs';

const DAY = '2026-08-28';
const RUN_URL = 'https://github.com/maximalang/recruiter-radar/actions/runs/123456789';

function daySnapshot(overrides = {}) {
  const core = {
    schema_version: 2,
    evidence_type: 'source-refresh-coverage',
    evidence_day_utc: DAY,
    produced_at: '2026-08-29T00:30:00.000Z',
    producer: {
      kind: 'github-actions',
      repo_sha: 'a'.repeat(40),
      workflow_run_url: RUN_URL,
      workflow_name: 'Source Refresh Clock',
      repository: 'maximalang/recruiter-radar',
      policy_sha256: 'p'.repeat(64),
      schedules_sha256: 's'.repeat(64),
      config_manifest_sha256: 'c'.repeat(64),
    },
    trusted_provenance: { authority: 'downloaded-github-actions-artifact', status: 'verified', attestation_kind: 'collector-log-artifact-digest' },
    run_attestations: [],
    window_days: 7,
    tick_partitioning: { rule: 'floor-to-hour', grace_ms: 300000, ticks_observed: [], adjacent_day_runs_excluded: [] },
    tick_ledger: {
      expected_slots_per_day: 24,
      expected_slots_utc: [],
      observed_slot_count: 24,
      missing_slots_utc: [],
      duplicate_slots: [],
      unresolved_slots: [],
    },
    runs: [],
    degradation_events: [],
    bounds_applied: { MAX_DEGRADED_OPTIONAL_SOURCES_PER_DAY: 2, MAX_CONSECUTIVE_DEGRADED_DAYS_PER_SOURCE: 3, note: 'test' },
    red_day_reasons: [],
    close_condition_satisfied_by_all_sources: true,
    day_status: 'GREEN_DAY',
    immutability: 'append-only',
    ...overrides,
  };
  core.snapshot_hash = recomputeSnapshotHash(core);
  return core;
}

/** Minimal fake pg client: records queries, returns scripted results in order. */
function fakeClient() {
  const queries = [];
  const results = [];
  const client = {
    query: async (text, params) => {
      queries.push({ text: String(text).replace(/\s+/g, ' ').trim(), params });
      const next = results.shift();
      if (typeof next === 'function') return next(text, params, queries.length - 1);
      if (next) return next;
      return { rows: [], rowCount: 0 };
    },
    __queue: (r) => results.push(r),
    __queries: queries,
  };
  return client;
}

const insertReturning = (inserted, hash) => ({
  rows: [{ inserted, evidence_day_utc: DAY, snapshot_hash: hash }],
});

// ---- U1/U2 missing & late alerts --------------------------------------------
test('U1: missing day derives a critical missing_snapshot alert carrying the day', () => {
  const day = '2026-08-27';
  const dayEndMs = Date.parse(`${day}T00:00:00Z`) + 24 * 3600 * 1000;
  const alert = deriveMissingSnapshotAlert(day, { nowMs: dayEndMs + 3600 * 1000 });
  assert.equal(alert.alert_type, 'missing_snapshot');
  assert.equal(alert.evidence_day_utc, day);
  assert.equal(alert.severity, 'critical');
});

test('U2: day missing beyond the deadline derives late_snapshot', () => {
  const day = '2026-08-27';
  const dayEndMs = Date.parse(`${day}T00:00:00Z`) + 24 * 3600 * 1000;
  const alert = deriveMissingSnapshotAlert(day, { nowMs: dayEndMs + 36 * 3600 * 1000 });
  assert.equal(alert.alert_type, 'late_snapshot');
  assert.equal(alert.severity, 'critical');
});

// ---- U3 red day alerts -------------------------------------------------------
test('U3: red day reasons map 1:1 to red_day alerts', () => {
  const snapshot = daySnapshot({
    day_status: 'RED_DAY',
    red_day_reasons: ['required_source_failing:egrul-fns', 'tick_ledger_defect'],
  });
  const alerts = deriveAlerts(snapshot, {});
  const red = alerts.filter((a) => a.alert_type === 'red_day');
  assert.equal(red.length, 2);
  assert.deepEqual(
    red.map((a) => a.dedupe_key).sort(),
    ['required_source_failing:egrul-fns', 'tick_ledger_defect'],
  );
  for (const a of red) {
    assert.equal(a.severity, 'critical');
    assert.equal(a.evidence_day_utc, DAY);
  }
});

// ---- U4 tick ledger defects --------------------------------------------------
test('U4a: few missing tick slots derive a bounded warning', () => {
  const snapshot = daySnapshot({
    tick_ledger: {
      expected_slots_per_day: 24,
      expected_slots_utc: [],
      observed_slot_count: 22,
      missing_slots_utc: ['2026-08-28T10:45:00.000Z', '2026-08-28T11:45:00.000Z'],
      duplicate_slots: [],
      unresolved_slots: [],
    },
  });
  const alerts = deriveAlerts(snapshot, {});
  const defects = alerts.filter((a) => a.alert_type === 'tick_ledger_defect');
  assert.equal(defects.length, 1);
  assert.equal(defects[0].severity, 'warning');
  assert.equal(defects[0].payload.count, 2);
});

test('U4b: >3 missing tick slots escalate to critical', () => {
  const snapshot = daySnapshot({
    tick_ledger: {
      expected_slots_per_day: 24,
      expected_slots_utc: [],
      observed_slot_count: 20,
      missing_slots_utc: ['2026-08-28T10:45:00.000Z', '2026-08-28T11:45:00.000Z', '2026-08-28T12:45:00.000Z', '2026-08-28T13:45:00.000Z'],
      duplicate_slots: [],
      unresolved_slots: [],
    },
  });
  const alerts = deriveAlerts(snapshot, {});
  const defects = alerts.filter((a) => a.alert_type === 'tick_ledger_defect');
  assert.equal(defects[0].severity, 'critical');
});

test('U4c: duplicate and unresolved slots derive per-slot alerts', () => {
  const snapshot = daySnapshot({
    tick_ledger: {
      expected_slots_per_day: 24,
      expected_slots_utc: [],
      observed_slot_count: 24,
      missing_slots_utc: [],
      duplicate_slots: [{ slot: '2026-08-28T09:45:00.000Z', run_ids: ['r1', 'r2'] }],
      unresolved_slots: [{ slot: '2026-08-28T08:45:00.000Z', run_id: 'r9' }],
    },
  });
  const alerts = deriveAlerts(snapshot, {});
  const defects = alerts.filter((a) => a.alert_type === 'tick_ledger_defect');
  assert.equal(defects.length, 2);
  assert.deepEqual(defects.map((d) => d.payload.kind).sort(), ['duplicate_slot', 'unresolved_slot']);
});

// ---- U5 provenance ------------------------------------------------------------
test('U5: unverified provenance derives provenance_unverified alert', () => {
  const snapshot = daySnapshot({
    trusted_provenance: { authority: 'downloaded-github-actions-artifact', status: 'unverified', attestation_kind: 'collector-log-artifact-digest' },
  });
  const alerts = deriveAlerts(snapshot, {});
  const prov = alerts.filter((a) => a.alert_type === 'provenance_unverified');
  assert.equal(prov.length, 1);
  assert.equal(prov[0].severity, 'critical');
});

test('U5b: verified provenance derives no provenance alert', () => {
  const alerts = deriveAlerts(daySnapshot(), {});
  assert.equal(alerts.filter((a) => a.alert_type === 'provenance_unverified').length, 0);
});

// ---- U6/U7/U8 persistSnapshot -------------------------------------------------
test('U6: persistSnapshot inserts a new day and is unchanged on same-hash re-encounter', async () => {
  const snapshot = daySnapshot();
  const client = fakeClient();
  client.__queue(insertReturning(true, snapshot.snapshot_hash));
  const first = await persistSnapshot(client, snapshot, { snapshot_file: `${DAY}.json` });
  assert.equal(first.status, 'inserted');
  assert.equal(client.__queries[0].params[4], snapshot.snapshot_hash);
  assert.equal(client.__queries[0].params[17], true, 'published flag must be true for <day>.json');

  client.__queue({ rows: [] }); // published-day conflict: no RETURNING row
  client.__queue({ rows: [{ snapshot_hash: snapshot.snapshot_hash }] }); // same hash
  const second = await persistSnapshot(client, snapshot, { snapshot_file: `${DAY}.json` });
  assert.equal(second.status, 'unchanged');
});

test('U7: published day + different hash fails closed (append-only)', async () => {
  const snapshot = daySnapshot();
  const client = fakeClient();
  client.__queue({ rows: [] }); // conflict: no RETURNING row
  client.__queue({ rows: [{ snapshot_hash: 'd'.repeat(64) }] }); // published with different hash
  await assert.rejects(
    () => persistSnapshot(client, snapshot, { snapshot_file: `${DAY}.json` }),
    /append-only violation/,
  );
});

test('U8: pending draft is superseded by a later published day (upgrade)', async () => {
  const draft = daySnapshot({ day_status: 'PENDING_CLOSE', close_condition_satisfied_by_all_sources: false, produced_at: '2026-08-28T23:30:00.000Z' });
  const close = daySnapshot();
  assert.notEqual(draft.snapshot_hash, close.snapshot_hash, 'draft and close hashes must differ');
  const client = fakeClient();
  client.__queue({ rows: [{ inserted: false, evidence_day_utc: DAY, snapshot_hash: close.snapshot_hash }] });
  const result = await persistSnapshot(client, close, { snapshot_file: `${DAY}.json` });
  assert.equal(result.status, 'upgraded');
});

// ---- U9 archive index ----------------------------------------------------------
const ARCHIVE = {
  run_id: '11111111111',
  run_number: 42,
  run_attempt: 1,
  repository: 'maximalang/recruiter-radar',
  workflow_name: 'Source Refresh Clock',
  event_name: 'schedule',
  scheduled_at_tick: '45 * * * *',
  head_sha: 'b'.repeat(40),
  artifact_name: 'source-refresh-run-11111111111-attempt-1',
  authority_manifest_sha256: 'a'.repeat(64),
  log_artifact_digest: 'c'.repeat(64),
  log_bytes: 2048,
  storage_key: 'source-refresh-logs/2026-08-28/11111111111/refresh.log',
  summary_sha256: 'd'.repeat(64),
  archived_by_run_url: RUN_URL,
};

test('U9: archive index inserts, then unchanged; diverged digest fails closed', async () => {
  const client = fakeClient();
  client.__queue({ rows: [] }); // existence check: absent
  client.__queue({ rows: [{ run_id: ARCHIVE.run_id }] }); // insert RETURNING
  const first = await persistLogArchiveIndex(client, ARCHIVE);
  assert.equal(first.status, 'inserted');

  client.__queue({ rows: [{ ...ARCHIVE }] }); // existence check: present, same digests
  const second = await persistLogArchiveIndex(client, ARCHIVE);
  assert.equal(second.status, 'unchanged');

  client.__queue({ rows: [{ ...ARCHIVE, log_artifact_digest: 'x'.repeat(64) }] });
  await assert.rejects(() => persistLogArchiveIndex(client, ARCHIVE), /different digests/);
});

// ---- U10 alert resolution ------------------------------------------------------
test('U10: resolveAlert closes an open alert and requires a reason', async () => {
  const client = fakeClient();
  client.__queue({ rows: [], rowCount: 1 });
  const ok = await resolveAlert(client, 'red_day:2026-08-28:some-reason', 'fixed same day');
  assert.equal(ok.resolved, true);
  await assert.rejects(() => resolveAlert(client, 'x', '   '), /reason required/);

  client.__queue({ rows: [], rowCount: 0 });
  const miss = await resolveAlert(client, 'red_day:2026-08-28:nope', 'fixed');
  assert.equal(miss.resolved, false);
});

test('U10b: recovered-day resolution closes open missing/late alerts', async () => {
  const client = fakeClient();
  client.__queue({ rows: [], rowCount: 2 });
  const out = await resolveAlertsForRecoveredDay(client, DAY);
  assert.equal(out.resolved, 2);
  const q = client.__queries[0];
  assert.equal(q.params[0], DAY);
  assert.match(q.text, /missing_snapshot/);
});

// ---- U11/U12 integrity ---------------------------------------------------------
test('U11: tampered stored snapshot detected via hash re-computation', async () => {
  const snapshot = daySnapshot();
  const client = fakeClient();
  client.__queue({
    rows: [{ snapshot: { ...snapshot, day_status: 'GREEN_DAY' }, snapshot_hash: 'e'.repeat(64), predecessor_snapshot_hash: null, day_status: 'GREEN_DAY' }],
  });
  const result = await verifySnapshotIntegrity(client, DAY, recomputeSnapshotHash, recomputeSnapshotHash);
  assert.equal(result.present, true);
  assert.equal(result.tampered, true);
});

test('U11b: chain break detected when predecessor hash mismatches stored prior day', async () => {
  const snapshot = daySnapshot();
  const client = fakeClient();
  client.__queue({
    rows: [{ snapshot, snapshot_hash: snapshot.snapshot_hash, predecessor_snapshot_hash: 'f'.repeat(64), day_status: 'GREEN_DAY' }],
  });
  client.__queue({ rows: [{ snapshot_hash: '0'.repeat(64) }] }); // prior day hash differs
  const result = await verifySnapshotIntegrity(client, DAY, recomputeSnapshotHash, recomputeSnapshotHash);
  assert.equal(result.chainBroken, true);
  assert.match(result.chainProblem, /predecessor_snapshot_hash does not match/);
});

test('U12: tamper_detected alert derived from integrity context', () => {
  const alerts = deriveAlerts(daySnapshot(), { tampered: true });
  const tamper = alerts.filter((a) => a.alert_type === 'tamper_detected');
  assert.equal(tamper.length, 1);
  assert.equal(tamper[0].severity, 'critical');
});
