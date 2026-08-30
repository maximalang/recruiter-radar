#!/usr/bin/env node
/**
 * Regression suite for the source-refresh clock protocol v2 (blockers B1–B7 of PR #240 review).
 *
 * Covers EXACTLY the eight scenarios demanded by the independent blocker review:
 *   S1 due/not-due: scheduler-attested not_due is the only non-degraded missing-outcome path
 *   S2 arbitrary expected-zero: adversarial noop stream must turn RED (B2)
 *   S3 422/no-details + missing tick: collector must fail closed, never silently succeed (B3)
 *   S4 adjacent-day 00:45 double attribution: tick-slot partitioning is disjoint (B4)
 *   S5 late run classification: late runs are their own ticks, not retroactive greens
 *   S6 fabricated unsigned 7-day window: checker rejects producer-less evidence (B5)
 *   S7 2-of-N degradation arithmetic: RED at bound+1, GREEN within bound (B6)
 *   S8 absent sixth source / L2 lineage: snapshot completeness required (B7)
 *
 * Run: node --test scripts/source-refresh-clock-regression.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { sha256Canonical } from './lib/coverage-integrity.mjs';
import { computeArtifactDigest, verifySummaryAgainstArtifact } from './lib/coverage-authority.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const COLLECTOR = path.join(REPO_ROOT, 'scripts', 'collect-refresh-logs.mjs');
const BUILDER = path.join(REPO_ROOT, 'scripts', 'build-coverage-snapshot.mjs');
const CHECKER = path.join(REPO_ROOT, 'scripts', 'check-coverage-window.mjs');
const CONFIG = path.join(REPO_ROOT, 'docs', 'evidence', 'source-refresh-coverage', 'config.json');

const FULL_SHA = 'a'.repeat(40);
const REPO = 'maximalang/recruiter-radar';

const SEVEN_DAY_SOURCES = [
  'cbr-registry',
  'egrul-fns',
  'fns-open-data',
  'rospatent-open-data',
  'rosstat-open-data',
  'transparent-business-fns',
];

function tmpDir(t) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `rr-srcClock-${t}-`));
}

/** Run a protocol script with env; returns {status, stdout, stderr}. Non-zero is NOT thrown. */
function runScript(scriptPath, env) {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath], {
      env: { ...process.env, ...env },
      encoding: 'utf8',
      cwd: REPO_ROOT,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? String(err.message) };
  }
}

/** Create artifact-manifest bindings for builder fixtures that represent real collected runs. */
function writeVerifiedAuthorityFixtures(runsDir, logsDir = path.join(runsDir, '.verified-artifacts')) {
  fs.mkdirSync(logsDir, { recursive: true });
  for (const file of fs.readdirSync(runsDir).filter((entry) => entry.endsWith('.json')).sort()) {
    const summaryPath = path.join(runsDir, file);
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    const runId = String(summary.run_id);
    summary.event_name = 'schedule';
    summary.scheduled_at_tick ??= summary.run_started_at;

    const runDir = path.join(logsDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'fixture.log'), `verified fixture for ${runId}\n`);
    const manifest = {
      schema_version: 1,
      workflow_name: 'Source Refresh Clock',
      repository: summary.repository,
      run_id: runId,
      run_number: summary.run_number,
      run_attempt: summary.run_attempt,
      event_name: summary.event_name,
      scheduled_at_tick: summary.scheduled_at_tick,
      head_sha: summary.git_sha,
      artifact_name: `source-refresh-run-${runId}-attempt-${summary.run_attempt}`,
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    fs.writeFileSync(path.join(runDir, 'github-run-manifest.json'), manifestBytes);
    summary._meta = {
      ...summary._meta,
      authority_verified: true,
      log_artifact_digest: computeArtifactDigest(runDir),
      authority_manifest_sha256: createHash('sha256').update(manifestBytes).digest('hex'),
    };
    fs.writeFileSync(summaryPath, JSON.stringify(summary));
  }
  return logsDir;
}

/** Avoid run-id collisions when several fixture days share one authority root. */
function rewriteFixtureRunIds(runsDir, dayOffset) {
  const files = fs.readdirSync(runsDir).filter((entry) => entry.endsWith('.json')).sort();
  for (const [index, file] of files.entries()) {
    const oldPath = path.join(runsDir, file);
    const summary = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
    const runId = String(19000000000 + dayOffset * 100 + index);
    summary.run_id = runId;
    const newPath = path.join(runsDir, `${runId}.json`);
    fs.writeFileSync(newPath, JSON.stringify(summary));
    fs.unlinkSync(oldPath);
  }
}

/** Builder invocation bound to an isolated snapshot dir (never the repo evidence dir). */
function buildSnapshot({ day, runsDir, outDir, sourceLogsDir }) {
  const verifiedLogsDir = sourceLogsDir === undefined ? writeVerifiedAuthorityFixtures(runsDir) : sourceLogsDir;
  return runScript(BUILDER, {
    COVERAGE_DAY_UTC: day,
    REFRESH_RUNS_DIR: runsDir,
    SOURCE_REFRESH_LOGS_DIR: verifiedLogsDir,
    CONFIG_MANIFEST: CONFIG,
    REPO_SHA: FULL_SHA,
    WORKFLOW_RUN_URL: RUN_URL,
    COVERAGE_SNAPSHOT_DIR: outDir,
  });
}


/** Load the day artifact whichever form the builder produced (.json or .pending.json). */
function readDayArtifact(dir, day) {
  for (const name of [`${day}.json`, `${day}.pending.json`]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  throw new Error(`no day artifact for ${day} under ${dir}`);
}

/** Deterministic run summary fixture. startedAt ISO controls tick attribution. */
function makeRunSummary({ runId, startedAt, sources = {}, overrides = {} }) {
  return {
    schema_version: 2,
    run_id: runId,
    workflow_name: 'Source Refresh Clock',
    repository: `${REPO}`,
    run_number: 1,
    run_attempt: 1,
    scheduled_at_tick: null,
    git_sha: FULL_SHA,
    http_status: 200,
    response_body_sha256: 'b'.repeat(64),
    run_started_at: startedAt,
    tick_result: 'ok',
    sources,
    ...overrides,
  };
}

function greenRow(overrides = {}) {
  return {
    outcome: 'ingested',
    success: true,
    records_fetched: 10,
    records_accepted: 8,
    duplicate_records: 2,
    error_code: null,
    status: 'green',
    scheduler: { due: true },
    upstream: { content_hash: 'c'.repeat(64), version_id: 'v1', upstream_updated_at: '2026-08-20T10:00:00Z' },
    ...overrides,
  };
}

const RUN_URL = `https://github.com/${REPO}/actions/runs/12345`;

/** Write six-source green rows except named degraded map {sourceId: row}. */
function dayRows(overridesBySource = {}, opts = {}) {
  const rows = {};
  for (const s of SEVEN_DAY_SOURCES) {
    rows[s] = overridesBySource[s] ?? greenRow(opts.green ?? {});
  }
  return rows;
}

/** Write one complete hourly day plus the bounded close-witness tick. */
function writeHourlyRuns(runsDir, { day, overridesBySource = {}, green = {} }) {
  for (let hour = 0; hour < 24; hour += 1) {
    const runId = String(15000000000 + hour + 1);
    const startedAt = `${day}T${String(hour).padStart(2, '0')}:45:00Z`;
    const summary = makeRunSummary({ runId, startedAt, sources: dayRows(overridesBySource, { green }) });
    fs.writeFileSync(path.join(runsDir, `${runId}.json`), JSON.stringify(summary));
  }
  const closeId = '16000000000';
  const close = makeRunSummary({
    runId: closeId,
    startedAt: `${day}T23:59:59Z`,
    sources: dayRows({}, { green }),
  });
  const nextDay = new Date(`${day}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  close.run_started_at = `${nextDay.toISOString().slice(0, 10)}T02:00:00Z`;
  fs.writeFileSync(path.join(runsDir, `${closeId}.json`), JSON.stringify(close));
}

/** Forgeable summaries that look collector-shaped but have no authoritative artifact manifest. */
function writeForgeableHourlyRuns(runsDir, { day, identity }) {
  const forgeDigest = 'f'.repeat(64);
  for (let hour = 0; hour < 24; hour += 1) {
    const runId = String(17000000000 + hour + 1);
    const summary = makeRunSummary({
      runId,
      startedAt: `${day}T${String(hour).padStart(2, '0')}:45:00Z`,
      sources: dayRows({
        ...Object.fromEntries(SEVEN_DAY_SOURCES.map((source) => [source, greenRow({ upstream: identity })])),
      }),
      overrides: {
        event_name: 'schedule',
        scheduled_at_tick: '45 * * * *',
        _meta: {
          log_artifact_digest: forgeDigest,
          authority_manifest_sha256: 'e'.repeat(64),
          authority_verified: true,
        },
      },
    });
    fs.writeFileSync(path.join(runsDir, `${runId}.json`), JSON.stringify(summary));
  }
  const closeId = '18000000000';
  const close = makeRunSummary({
    runId: closeId,
    startedAt: `${day}T23:59:59Z`,
    sources: dayRows({
      ...Object.fromEntries(SEVEN_DAY_SOURCES.map((source) => [source, greenRow({ upstream: identity })])),
    }),
    overrides: {
      event_name: 'schedule',
      scheduled_at_tick: '45 * * * *',
      _meta: {
        log_artifact_digest: forgeDigest,
        authority_manifest_sha256: 'e'.repeat(64),
        authority_verified: true,
      },
    },
  });
  const nextDay = new Date(`${day}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  close.run_started_at = `${nextDay.toISOString().slice(0, 10)}T02:00:00Z`;
  fs.writeFileSync(path.join(runsDir, `${closeId}.json`), JSON.stringify(close));
}

// ================================================================================
// S1 — due/not-due (B1)
// ================================================================================
test('S1: scheduler-attested not_due keeps a deferred-only source out of failure; unattested deferral fails required day', () => {
  const dir = tmpDir('s1-notdue');
  // Required source egrul-fns: all-day deferred WITH attestation -> not_due.
  const summaries = [
    makeRunSummary({
      runId: '11111111111',
      startedAt: '2026-08-20T05:00:12Z',
      sources: dayRows({
        'egrul-fns': greenRow({
          outcome: 'deferred',
          success: false,
          records_fetched: null,
          records_accepted: 0,
          status: 'deferred',
          scheduler: { due: false, next_eligible_run_at: '2026-08-22T00:00:00Z' },
        }),
      }),
    }),
    // Closer run on a later tick so §16 close_condition can be satisfied.
    makeRunSummary({
      runId: '22222222222',
      startedAt: '2026-08-21T02:00:12Z',
      sources: dayRows(),
    }),
  ];
  const runsDir = path.join(dir, 'runs');
  fs.mkdirSync(runsDir);
  for (const s of summaries) fs.writeFileSync(path.join(runsDir, `${s.run_id}.json`), JSON.stringify(s));

  const res = buildSnapshot({ day: '2026-08-20', runsDir: runsDir, outDir: dir })
  assert.equal(res.status, 0, `builder failed: ${res.stderr}`);
  const snap = JSON.parse(fs.readFileSync(path.join(dir, '2026-08-20.json'), 'utf8'));
  const egrul = snap.runs.find((r) => r.source_id === 'egrul-fns');
  assert.equal(egrul.status, 'not_due', 'attested future eligibility must yield not_due');

  // Same shape WITHOUT scheduler attestation -> overdue_deferred -> RED_DAY.
  const dir2 = tmpDir('s1-overdue');
  const summaries2 = [
    makeRunSummary({
      runId: '33333333333',
      startedAt: '2026-08-20T05:00:12Z',
      sources: dayRows({
        'egrul-fns': greenRow({
          outcome: 'deferred',
          success: false,
          records_fetched: null,
          records_accepted: 0,
          status: 'deferred',
        }),
      }),
    }),
    makeRunSummary({ runId: '44444444444', startedAt: '2026-08-21T02:00:12Z', sources: dayRows() }),
  ];
  const runsDir2 = path.join(dir2, 'runs');
  fs.mkdirSync(runsDir2);
  for (const s of summaries2) fs.writeFileSync(path.join(runsDir2, `${s.run_id}.json`), JSON.stringify(s));
  const res2 = buildSnapshot({ day: '2026-08-20', runsDir: runsDir2, outDir: dir2 })
  const pending2 = readDayArtifact(dir2, '2026-08-20');
  const egrul2 = pending2.runs.find((r) => r.source_id === 'egrul-fns');
  assert.equal(egrul2.status, 'overdue_deferred');
  assert.equal(pending2.day_status, 'RED_DAY');
});

// ================================================================================
// S2 — arbitrary expected-zero must be red (B2)
// ================================================================================
test('S2: adversarial zero stream with empty identity turns RED, never green_noop', () => {
  const dir = tmpDir('s2-zero');
  const summaries = [
    makeRunSummary({
      runId: '55555555555',
      startedAt: '2026-08-20T06:00:00Z',
      sources: Object.fromEntries(
        SEVEN_DAY_SOURCES.map((s) => [
          s,
          {
            outcome: 'expected-zero',
            success: true,
            records_fetched: 0,
            records_accepted: 0,
            duplicate_records: null,
            error_code: 'totally-made-up-reason', // not in policy allowlist
            status: 'green_noop',
            scheduler: { due: true },
            upstream: null,
          },
        ]),
      ),
    }),
    makeRunSummary({ runId: '66666666666', startedAt: '2026-08-21T02:00:00Z', sources: dayRows() }),
  ];
  const runsDir = path.join(dir, 'runs');
  fs.mkdirSync(runsDir);
  for (const s of summaries) fs.writeFileSync(path.join(runsDir, `${s.run_id}.json`), JSON.stringify(s));
  const res = buildSnapshot({ day: '2026-08-20', runsDir: runsDir, outDir: dir })
  const snap = readDayArtifact(dir, '2026-08-20');
  for (const r of snap.runs) {
    if (r.status === 'green_noop') {
      assert.fail(`fabricated green_noop accepted for ${r.source_id} — B2 regression`);
    }
  }
  // egrul-fns (required) red + fabricated statuses => RED/PENDING close.
  assert.ok(['RED_DAY'].includes(snap.day_status), `day must be RED, got ${snap.day_status}`);
});

// ================================================================================
// S3 — 422/no-details and missing tick must fail closed in collector (B3)
// ================================================================================
test('S3: collector writes schema-error summary (never silent skip) for malformed logs; identity fields captured when present', () => {
  const dir = tmpDir('s3-collector');
  const logsDir = path.join(dir, 'logs');
  const runsDir = path.join(dir, 'runs');
  fs.mkdirSync(logsDir);
  fs.mkdirSync(runsDir);

  // Run A: log contains no parseable payload (missed/failed tick).
  fs.mkdirSync(path.join(logsDir, '77777777777'), { recursive: true });
  fs.writeFileSync(
    path.join(logsDir, '77777777777', 'step.txt'),
    'some unrelated output\nno payload here\n',
  );

  // Run B: provenance + valid body embedded.
  const goodBody = JSON.stringify({
    success: true,
    data: {
      total: 6,
      succeeded: 6,
      details: [
        {
          source: 'egrul-fns',
          outcome: 'ingested',
          success: true,
          fetchedCount: 5,
          upsertedCount: 4,
          diagnostics: { normalizedCount: 4, zeroReason: null },
        },
      ],
    },
  });
  fs.mkdirSync(path.join(logsDir, '88888888888'), { recursive: true });
  fs.writeFileSync(
    path.join(logsDir, '88888888888', 'step.txt'),
    [
      'noise line before',
      'source-refresh-provenance: workflow_name=Source_Refresh_Clock repository=maximalang/recruiter-radar run_id=88888888888 run_number=7 attempt=1 event_name=schedule scheduled_at=2026-08-20T06:00:00Z git_sha=' +
        FULL_SHA +
        ' http_status=200 body_sha256=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      goodBody,
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(logsDir, '88888888888', 'github-run-manifest.json'),
    `${JSON.stringify({
      schema_version: 1,
      workflow_name: 'Source Refresh Clock',
      repository: 'maximalang/recruiter-radar',
      run_id: '88888888888',
      run_number: 7,
      run_attempt: 1,
      event_name: 'schedule',
      scheduled_at_tick: '2026-08-20T06:00:00Z',
      head_sha: FULL_SHA,
      artifact_name: 'source-refresh-run-88888888888-attempt-1',
    }, null, 2)}\n`,
  );

  const res = runScript(COLLECTOR, { SOURCE_REFRESH_LOGS_DIR: logsDir, REFRESH_RUNS_DIR: runsDir, CONFIG_MANIFEST: CONFIG });
  assert.equal(res.status, 0, `collector should complete: ${res.stderr}`);

  const bad = JSON.parse(fs.readFileSync(path.join(runsDir, '77777777777.json'), 'utf8'));
  assert.equal(bad.tick_result, 'schema-error');
  assert.ok((bad.schema_errors?.length ?? 0) > 0, 'malformed run must record schema_errors (B3)');

  const good = JSON.parse(fs.readFileSync(path.join(runsDir, '88888888888.json'), 'utf8'));
  assert.equal(good.http_status, 200);
  assert.equal(good.run_number, 7);
  assert.equal(good.git_sha, FULL_SHA);
  assert.equal(good.sources['egrul-fns'].records_accepted, 4);
  assert.equal(good.response_body_sha256.length, 64);
  assert.equal(good._meta.authority_verified, true);
  assert.match(good._meta.authority_manifest_sha256, /^[0-9a-f]{64}$/);
  const authority = verifySummaryAgainstArtifact(good, logsDir);
  assert.equal(authority.verified, true, authority.problems.join('; '));
});

// ================================================================================
// S4 — adjacent-day 00:45 double attribution (B4)
// ================================================================================
test('S4: run at 23:59:50Z belongs to its own tick day only; attribution windows are disjoint', () => {
  const dir = tmpDir('s4-attribution');
  // The adversarial case from the review was a 00:45 next-day run counted twice. Under
  // floor-to-hour ticks, 2026-08-21T00:45 has tick 2026-08-21T00:15 → belongs to Aug21 ONLY.
  const lateNightRun = makeRunSummary({
    runId: '99999999999',
    startedAt: '2026-08-21T00:45:00Z',
    sources: dayRows(),
  });
  const runsDir = path.join(dir, 'runs');
  fs.mkdirSync(runsDir);
  fs.writeFileSync(path.join(runsDir, '99999999999.json'), JSON.stringify(lateNightRun));

  // Building day Aug-20 must refuse: its only candidate tick lands outside the day window.
  const resAug20 = buildSnapshot({ day: '2026-08-20', runsDir: runsDir, outDir: dir })
  assert.equal(resAug20.status, 1, '00:45 next-day run must not seed the previous day');
  assert.ok(!fs.existsSync(path.join(dir, '2026-08-20.json')));

  // Building day Aug-21 succeeds and uses that run.
  const resAug21 = buildSnapshot({ day: '2026-08-21', runsDir: runsDir, outDir: dir })
  assert.equal(resAug21.status, 0, `expected builder success for own day: ${resAug21.stderr}`);
  assert.ok(fs.existsSync(path.join(dir, '2026-08-21.json')) || fs.existsSync(path.join(dir, '2026-08-21.pending.json')));
});

// ================================================================================
// S5 — late run classification
// ================================================================================
test('S5: two runs inside one tick hour collapse onto one slot; distinct hours produce distinct slots', () => {
  const dir = tmpDir('s5-late');
  const runsDir = path.join(dir, 'runs');
  fs.mkdirSync(runsDir);
  const rows = dayRows();
  // Both start inside [03:15, 04:15): same tick despite wall-clock hour boundary crossing.
  fs.writeFileSync(
    path.join(runsDir, '12121212121.json'),
    JSON.stringify(makeRunSummary({ runId: '12121212121', startedAt: '2026-08-20T03:59:00Z', sources: rows })),
  );
  fs.writeFileSync(
    path.join(runsDir, '13131313131.json'),
    JSON.stringify(makeRunSummary({ runId: '13131313131', startedAt: '2026-08-20T04:14:30Z', sources: rows })),
  );
  fs.writeFileSync(
    path.join(runsDir, '14141414141.json'),
    JSON.stringify(makeRunSummary({ runId: '14141414141', startedAt: '2026-08-20T05:00:01Z', sources: rows })),
  );
  const res = buildSnapshot({ day: '2026-08-20', runsDir: runsDir, outDir: dir })
  const outFiles = ['2026-08-20.json', '2026-08-20.pending.json'].map((f) => path.join(dir, f)).filter((f) => fs.existsSync(f));
  assert.equal(outFiles.length, 1, 'exactly one day artifact produced');
  const snap = JSON.parse(fs.readFileSync(outFiles[0], 'utf8'));
  const ticks = snap.tick_partitioning.ticks_observed;
  assert.equal(new Set(ticks).size, 2, `03:59 & 04:14 share tick 03:15; 05:00 gives second — got ${JSON.stringify(ticks)}`);
});

// ================================================================================
// S6 — fabricated unsigned window rejected by checker (B5)
// ================================================================================
test('S6: hand-made snapshots without producer/hash chain are NOT_READY', () => {
  const dir = tmpDir('s6-unsigned'); // tmpDir() already mkdirs
  for (let i = 6; i >= 0; i -= 1) {
    const day = new Date(Date.UTC(2026, 7, 27 - i)).toISOString().slice(0, 10);
    const fake = {
      schema_version: 1,
      evidence_type: 'source-refresh-coverage',
      evidence_day_utc: day,
      produced_at: new Date().toISOString(),
      window_days: 7,
      runs: SEVEN_DAY_SOURCES.map((s) => ({
        source_id: s,
        criticality: s === 'egrul-fns' ? 'required' : 'optional',
        status: 'green',
        records_accepted: 5,
        close_condition: { satisfied_by_run_id: 'manual-run' },
      })),
      bounds_applied: { MAX_DEGRADED_OPTIONAL_SOURCES_PER_DAY: 2, MAX_CONSECUTIVE_DEGRADED_DAYS_PER_SOURCE: 2 },
      degradation_events: [],
      close_condition_satisfied_by_all_sources: true,
      day_status: 'GREEN_DAY',
    };
    fs.writeFileSync(path.join(dir, `${day}.json`), JSON.stringify(fake, null, 2));
  }
  const res = runScript(CHECKER, { COVERAGE_REF_DAY_UTC: '2026-08-27', COVERAGE_SNAPSHOT_DIR: dir });
  assert.equal(res.status, 1, 'unsigned/fabricated window MUST fail closed');
  assert.match(res.stdout + res.stderr, /NOT_READY/);
  assert.match(res.stdout + res.stderr, /producer|snapshot_hash|schema_version/);
});

// ================================================================================
// S7 — 2-of-N degradation arithmetic (B6)
// ================================================================================
test('S7: 2 degraded optional stay in bounds; 3 exceed MAX_DEGRADED_OPTIONAL_SOURCES_PER_DAY=2', () => {
  const OPTIONAL_TEST_CASES = [
    { degraded: ['cbr-registry', 'rosstat-open-data'], expectGreen: true },
    { degraded: ['cbr-registry', 'rosstat-open-data', 'fns-open-data'], expectGreen: false },
  ];
  for (const tc of OPTIONAL_TEST_CASES) {
    const dir = tmpDir(`s7-${tc.degraded.length}`);
    const overrides = {};
    for (const s of tc.degraded) {
      overrides[s] = {
        outcome: 'failed',
        success: false,
        records_fetched: null,
        records_accepted: 0,
        duplicate_records: null,
        error_code: 'source-unavailable',
        status: 'red',
        scheduler: { due: true },
        upstream: null,
      };
    }
    const runsDir = path.join(dir, 'runs');
    fs.mkdirSync(runsDir);
    writeHourlyRuns(runsDir, { day: '2026-08-20', overridesBySource: overrides });
    const res = buildSnapshot({ day: '2026-08-20', runsDir: runsDir, outDir: dir })
    assert.equal(res.status, 0, res.stderr);
    const snap = readDayArtifact(dir, '2026-08-20');
    assert.equal(snap.degradation_events.length, tc.degraded.length);
    if (tc.expectGreen) {
      assert.notEqual(snap.day_status, 'RED_DAY', 'two-of-five optional degradation must stay publishable');
      assert.ok(!snap.red_day_reasons.some((r) => r.includes('bound')), `no bound violation expected: ${snap.red_day_reasons}`);
    } else {
      assert.equal(snap.day_status, 'RED_DAY', 'three degraded optionals exceed the hard bound of two');
      assert.ok(snap.red_day_reasons.some((r) => r.includes('optional degradation exceeds')));
    }
  }
});

// ================================================================================
// S8 — absent sixth source / snapshot completeness (B7 analog at snapshot level)
// ================================================================================
test('S8: run summary containing only five of six target sources yields explicit unknown-missing-launch entries', () => {
  const dir = tmpDir('s8-absent');
  const absent = 'rospatent-open-data';
  const rows = dayRows();
  delete rows[absent];
  const runsDir = path.join(dir, 'runs');
  fs.mkdirSync(runsDir);
  fs.writeFileSync(
    path.join(runsDir, '17171717171.json'),
    JSON.stringify(makeRunSummary({ runId: '17171717171', startedAt: '2026-08-20T07:00:00Z', sources: rows })),
  );
  fs.writeFileSync(
    path.join(runsDir, '18181818181.json'),
    JSON.stringify(makeRunSummary({ runId: '18181818181', startedAt: '2026-08-21T02:00:00Z', sources: dayRows() })),
  );
  const res = buildSnapshot({ day: '2026-08-20', runsDir: runsDir, outDir: dir })
  assert.equal(res.status, 0, res.stderr);
  const snap = readDayArtifact(dir, '2026-08-20');
  const entry = snap.runs.find((r) => r.source_id === absent);
  assert.ok(entry, 'absent source must still appear as an explicit row (not vanish)');
  assert.equal(entry.status, 'unknown-missing-launch');
  assert.ok(
    snap.red_day_reasons.some((r) => r.includes(absent)),
    'missing sixth source must fail the day explicitly',
  );
});

// ================================================================================
// Adversarial A-E — exact v4 blocker cases
// ================================================================================
test('A: past next_eligible_run_at is overdue, never a valid not_due attestation', () => {
  const dir = tmpDir('adv-a-past-due');
  const runsDir = path.join(dir, 'runs');
  fs.mkdirSync(runsDir);
  const run = makeRunSummary({
    runId: '19191919191',
    startedAt: '2026-08-20T05:00:00Z',
    sources: dayRows({
      'egrul-fns': greenRow({
        outcome: 'deferred', status: 'deferred', success: false,
        records_fetched: null, records_accepted: 0,
        scheduler: { due: false, next_eligible_run_at: '2026-08-20T04:59:59Z' },
      }),
    }),
  });
  const close = makeRunSummary({ runId: '20202020202', startedAt: '2026-08-21T02:00:00Z', sources: dayRows() });
  for (const s of [run, close]) fs.writeFileSync(path.join(runsDir, `${s.run_id}.json`), JSON.stringify(s));
  assert.equal(buildSnapshot({ day: '2026-08-20', runsDir, outDir: dir }).status, 0);
  const snap = readDayArtifact(dir, '2026-08-20');
  assert.equal(snap.runs.find((r) => r.source_id === 'egrul-fns').status, 'overdue_deferred');
  assert.equal(snap.day_status, 'RED_DAY');
});

test('B: ordinary green with stale upstream identity is downgraded to red', () => {
  const dir = tmpDir('adv-b-stale-green');
  const runsDir = path.join(dir, 'runs');
  fs.mkdirSync(runsDir);
  const stale = greenRow({ upstream: { content_hash: 'd'.repeat(64), version_id: 'old', upstream_updated_at: '2026-08-01T10:00:00Z' } });
  const run = makeRunSummary({ runId: '21212121212', startedAt: '2026-08-20T05:00:00Z', sources: dayRows({ 'egrul-fns': stale }) });
  const close = makeRunSummary({ runId: '22222222222', startedAt: '2026-08-21T02:00:00Z', sources: dayRows() });
  for (const s of [run, close]) fs.writeFileSync(path.join(runsDir, `${s.run_id}.json`), JSON.stringify(s));
  assert.equal(buildSnapshot({ day: '2026-08-20', runsDir, outDir: dir }).status, 0);
  const snap = readDayArtifact(dir, '2026-08-20');
  const egrul = snap.runs.find((r) => r.source_id === 'egrul-fns');
  assert.equal(egrul.status, 'red');
  assert.equal(egrul.upstream_identity.fresh, false);
  assert.ok(snap.red_day_reasons.some((reason) => reason.includes('egrul-fns')));
});

test('C: late close run after immutable deadline cannot backfill the covered day', () => {
  const dir = tmpDir('adv-c-late-backfill');
  const runsDir = path.join(dir, 'runs');
  fs.mkdirSync(runsDir);
  writeHourlyRuns(runsDir, { day: '2026-08-20' });
  const latePath = path.join(runsDir, '16000000000.json');
  const late = JSON.parse(fs.readFileSync(latePath, 'utf8'));
  late.run_started_at = '2026-08-21T03:00:00Z';
  fs.writeFileSync(latePath, JSON.stringify(late));
  assert.equal(buildSnapshot({ day: '2026-08-20', runsDir, outDir: dir }).status, 0);
  const snap = readDayArtifact(dir, '2026-08-20');
  assert.notEqual(snap.day_status, 'GREEN_DAY');
  assert.ok(snap.runs.every((r) => r.close_condition.satisfied_by_run_id == null));
  assert.ok(snap.runs.every((r) => r.close_condition.backfill_rejected));
});

test('D: checker catches a forward hash-chain break even when the edited snapshot is rehashed', () => {
  const dir = tmpDir('adv-d-chain-direction');
  const previousRuns = path.join(dir, 'previous-runs');
  const currentRuns = path.join(dir, 'current-runs');
  fs.mkdirSync(previousRuns);
  fs.mkdirSync(currentRuns);
  writeHourlyRuns(previousRuns, {
    day: '2026-08-19',
    green: { upstream: { content_hash: 'e'.repeat(64), version_id: 'v19', upstream_updated_at: '2026-08-19T10:00:00Z' } },
  });
  writeHourlyRuns(currentRuns, { day: '2026-08-20' });
  assert.equal(buildSnapshot({ day: '2026-08-19', runsDir: previousRuns, outDir: dir }).status, 0);
  assert.equal(buildSnapshot({ day: '2026-08-20', runsDir: currentRuns, outDir: dir }).status, 0);
  const currentPath = path.join(dir, '2026-08-20.json');
  const current = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
  current.predecessor_snapshot_hash = 'f'.repeat(64);
  const unsigned = { ...current };
  delete unsigned.snapshot_hash;
  current.snapshot_hash = sha256Canonical(unsigned);
  fs.writeFileSync(currentPath, JSON.stringify(current, null, 2));
  const checked = runScript(CHECKER, {
    CONFIG_MANIFEST: CONFIG,
    COVERAGE_SNAPSHOT_DIR: dir,
    COVERAGE_REF_DAY_UTC: '2026-08-20',
    EXPECTED_REPO_SHA: FULL_SHA,
  });
  assert.notEqual(checked.status, 0);
  assert.match(checked.stdout, /forward chain break/);
});

test('E: mixed deploy SHA in one collected day is rejected before snapshot publication', () => {
  const dir = tmpDir('adv-e-mixed-sha');
  const runsDir = path.join(dir, 'runs');
  fs.mkdirSync(runsDir);
  const mismatched = makeRunSummary({
    runId: '23232323232',
    startedAt: '2026-08-20T05:00:00Z',
    sources: dayRows(),
    overrides: { git_sha: '0'.repeat(40) },
  });
  fs.writeFileSync(path.join(runsDir, `${mismatched.run_id}.json`), JSON.stringify(mismatched));
  const result = buildSnapshot({ day: '2026-08-20', runsDir, outDir: dir });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /provenance git_sha/);
});

// F — a one-minute deferral attestation cannot cover later overdue slots, and a source-less
// close witness cannot close the required source.
test('F: transient deferral and source-less closer remain fail-closed', () => {
  const dir = tmpDir('adv-f-transient-deferral');
  const runsDir = path.join(dir, 'runs');
  fs.mkdirSync(runsDir);
  for (let hour = 0; hour < 24; hour += 1) {
    const rows = dayRows();
    rows['egrul-fns'] = greenRow({
      outcome: 'deferred',
      success: false,
      records_fetched: null,
      records_accepted: 0,
      status: 'deferred',
      scheduler:
        hour === 0
          ? { due: false, next_eligible_run_at: '2026-08-20T00:46:00Z' }
          : { due: true },
      upstream: null,
    });
    const summary = makeRunSummary({
      runId: String(25000000000 + hour),
      startedAt: `2026-08-20T${String(hour).padStart(2, '0')}:45:00Z`,
      sources: rows,
    });
    fs.writeFileSync(path.join(runsDir, `${summary.run_id}.json`), JSON.stringify(summary));
  }
  const sourceLessCloser = makeRunSummary({
    runId: '25000000024',
    startedAt: '2026-08-21T00:45:00Z',
    sources: {},
  });
  fs.writeFileSync(
    path.join(runsDir, `${sourceLessCloser.run_id}.json`),
    JSON.stringify(sourceLessCloser),
  );

  assert.equal(buildSnapshot({ day: '2026-08-20', runsDir, outDir: dir }).status, 0);
  const snap = readDayArtifact(dir, '2026-08-20');
  const egrul = snap.runs.find((entry) => entry.source_id === 'egrul-fns');
  assert.equal(egrul.status, 'overdue_deferred');
  assert.equal(egrul.close_condition.satisfied_by_run_id, null);
  assert.equal(snap.day_status, 'RED_DAY');
});

// G — even artifact-verified summaries with one reused upstream identity are not a live seven-day window.
test('G: reused upstream identity is rejected despite verified artifact authority', () => {
  const dir = tmpDir('adv-g-forged-window');
  const sourceLogsDir = path.join(dir, 'verified-logs');
  const first = '2026-08-20';
  const plusDay = (day, delta) => {
    const date = new Date(`${day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + delta);
    return date.toISOString().slice(0, 10);
  };
  for (let offset = 0; offset < 7; offset += 1) {
    const day = plusDay(first, offset);
    const runsDir = path.join(dir, `runs-${day}`);
    fs.mkdirSync(runsDir);
    writeHourlyRuns(runsDir, { day, green: { upstream: { content_hash: 'c'.repeat(64), version_id: 'same-v1', upstream_updated_at: '2026-08-19T10:00:00Z' } } });
    rewriteFixtureRunIds(runsDir, offset);
    writeVerifiedAuthorityFixtures(runsDir, sourceLogsDir);
    assert.equal(buildSnapshot({ day, runsDir, outDir: dir, sourceLogsDir }).status, 0);
  }
  const checked = runScript(CHECKER, {
    CONFIG_MANIFEST: CONFIG,
    COVERAGE_SNAPSHOT_DIR: dir,
    COVERAGE_REF_DAY_UTC: '2026-08-26',
    EXPECTED_REPO_SHA: FULL_SHA,
    SOURCE_REFRESH_LOGS_DIR: sourceLogsDir,
  });
  assert.notEqual(checked.status, 0);
  assert.match(checked.stdout, /VERDICT: NOT_READY/);
  assert.match(checked.stdout, /upstream identity reused/);
});

// G+ — syntactically valid forged artifact digest and fake run URL must fail before publication.
test('G+: fake URL and forged artifact digest are rejected before a snapshot exists', () => {
  const dir = tmpDir('adv-g-plus-forged-authority');
  const day = '2026-08-20';
  const runsDir = path.join(dir, `runs-${day}`);
  fs.mkdirSync(runsDir);
  writeForgeableHourlyRuns(runsDir, {
    day,
    identity: {
      content_hash: 'a'.repeat(64),
      version_id: 'forged-v1',
      upstream_updated_at: `${day}T10:00:00Z`,
    },
  });
  const built = buildSnapshot({ day, runsDir, outDir: dir, sourceLogsDir: '' });
  assert.notEqual(built.status, 0, 'unverified source artifacts must fail before publication');
  assert.match(built.stderr, /SOURCE_REFRESH_LOGS_DIR|authority/i);
  assert.equal(fs.existsSync(path.join(dir, `${day}.json`)), false);
  assert.equal(fs.existsSync(path.join(dir, `${day}.pending.json`)), false);
});

// H — a malformed predecessor must never be treated as a fresh chain genesis.
test('H: malformed predecessor aborts before writing the candidate day', () => {
  const dir = tmpDir('adv-h-broken-predecessor');
  const day = '2026-08-20';
  fs.writeFileSync(path.join(dir, '2026-08-19.json'), '{"not":"a valid coverage snapshot"}\n');
  const runsDir = path.join(dir, 'runs');
  fs.mkdirSync(runsDir);
  writeHourlyRuns(runsDir, { day });

  const built = buildSnapshot({ day, runsDir, outDir: dir });
  assert.notEqual(built.status, 0, 'broken predecessor chain must fail before publication');
  assert.match(built.stderr, /predecessor snapshot/i);
  assert.equal(fs.existsSync(path.join(dir, `${day}.json`)), false);
  assert.equal(fs.existsSync(path.join(dir, `${day}.pending.json`)), false);
});
