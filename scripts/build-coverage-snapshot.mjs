#!/usr/bin/env node
/**
 * Source-refresh coverage snapshot builder v2 (protocol §5-§9, §16; blockers B1, B2, B3, B4, B5).
 *
 * Builds one immutable daily coverage snapshot for the six 7-day-window sources from
 * GitHub Actions `Source Refresh Clock` run summaries produced by collect-refresh-logs.mjs.
 *
 * Inputs (all required):
 *   REFRESH_RUNS_DIR   directory with collect-refresh-logs.mjs output (<run_id>.json files)
 *   CONFIG_MANIFEST    docs/evidence/source-refresh-coverage/config.json from
 *                      generate-refresh-config-manifest.mjs (hashes, classification, targets,
 *                      zero_contracts)
 *   REPO_SHA           FULL 40-hex git SHA of the deploy producing the runs
 *   COVERAGE_DAY_UTC   UTC calendar day the snapshot covers, YYYY-MM-DD
 *   WORKFLOW_RUN_URL   public URL of the producing workflow run (identity evidence)
 * Optional:
 *   COVERAGE_WINDOW_ID  identifier binding this snapshot to a declared 7-day proof window
 *
 * v2 evaluation (fail closed):
 *   - attribution by expected hourly tick slot, not raw started_at wall time:
 *     every run is assigned scheduled_at_tick = floor(started_at to the hour); a run is in
 *     day D iff its tick is within [D 00:00, D+1 00:00) — no ±grace overlap between adjacent
 *     days, so a 00:45 run belongs ONLY to its own tick's day (B4);
 *   - day close watermark: runs may only be attributed to a closed day D if a LATER tick-run
 *     exists after D+01:30 that carries a non-deferred row or noop for each still-open slot
 *     (close_condition), otherwise PENDING_CLOSE draft (<day>.pending.json) (B4);
 *   - per source the effective row = LAST non-deferred non-noop row of day D; an all-deferred
 *     day is NOT green — deferred rows count as no-proof-of-arrival and fail required sources;
 *   - due/not-due: a source without any rows is not_due only when scheduler state says so;
 *     missing scheduler evidence = overdue/unknown -> red (B1);
 *   - zero outcomes are accepted as green_noop only with policy zero contract AND upstream
 *     identity AND freshness AND delta verdict (B2);
 *   - integrity/provenance (B5): full-SHA + workflow identity required, schema_version 2 run
 *     summaries only, hash-chained via predecessor_snapshot_hash + snapshot_hash;
 *   - §7 hard bounds apply to optional degradation only (2-of-6 bound stated explicitly).
 *
 * Output: <CONFIG_MANIFEST dir>/<day>.json (immutable) or <day>.pending.json; NEVER overwrites.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { sha256Canonical, stableStringify, utcOffsetDays } from './lib/coverage-integrity.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

const rawDay = process.env.COVERAGE_DAY_UTC ?? '';
const runsDir = process.env.REFRESH_RUNS_DIR ?? '';
const configManifestPath = process.env.CONFIG_MANIFEST ?? '';
const repoSha = process.env.REPO_SHA ?? '';
const workflowRunUrl = process.env.WORKFLOW_RUN_URL ?? '';
const windowId = process.env.COVERAGE_WINDOW_ID ?? '';

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDay)) fail('COVERAGE_DAY_UTC must be YYYY-MM-DD');
if (!runsDir || !fs.existsSync(runsDir)) fail('REFRESH_RUNS_DIR must point to collected refresh-run JSON files');
if (!configManifestPath || !fs.existsSync(configManifestPath)) fail('CONFIG_MANIFEST must point to config.json');
// B5: fabricated short SHAs were previously accepted ({7,40} hex). Full 40-hex enforced now.
if (!/^[0-9a-f]{40}$/.test(repoSha)) fail('REPO_SHA must be a full 40-hex git SHA');
if (!/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/actions\/runs\/\d+(\/attempts\/\d+)?$/.test(workflowRunUrl)) {
  fail('WORKFLOW_RUN_URL must be a public github.com Actions run URL');
}
const manifest = JSON.parse(fs.readFileSync(configManifestPath, 'utf8'));
if (!manifest.zero_contracts || typeof manifest.zero_contracts !== 'object') {
  fail('CONFIG_MANIFEST.zero_contracts missing — regenerate config.json first');
}

const outDir = path.resolve(process.env.COVERAGE_SNAPSHOT_DIR ?? path.dirname(configManifestPath));
const outPath = path.join(outDir, `${rawDay}.json`);
const pendingPath = path.join(outDir, `${rawDay}.pending.json`);
fs.mkdirSync(outDir, { recursive: true });
if (fs.existsSync(outPath)) {
  fail(`refusing to overwrite existing snapshot ${outPath}; corrections must use superseded-file mechanics`);
}

// ---- load collected runs (strict schema_version 2) -----------------------------------------
const runFiles = fs.readdirSync(runsDir).filter((f) => f.endsWith('.json'));
if (runFiles.length === 0) fail(`no run summaries found in ${runsDir}`);
const collectedRuns = [];
for (const file of runFiles) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(runsDir, file), 'utf8'));
  } catch {
    fail(`malformed run summary: ${file}`);
  }
  const problems = validateRunSummaryV2(parsed);
  if (problems.length > 0) fail(`run summary ${file}: ${problems.join('; ')}`);
  collectedRuns.push(parsed);
}
collectedRuns.sort((a, b) => Date.parse(a.run_started_at) - Date.parse(b.run_started_at));

function validateRunSummaryV2(parsed) {
  const problems = [];
  if (!parsed || typeof parsed !== 'object') problems.push('not an object');
  if (parsed?.schema_version !== 2) problems.push(`schema_version must be 2, got ${parsed?.schema_version}`);
  if (typeof parsed?.run_id !== 'string' || !parsed.run_id) problems.push('run_id missing');
  if (typeof parsed?.repository !== 'string' || !parsed.repository.includes('/')) problems.push('repository invalid');
  if (!/^([0-9a-f]{40})$/i.test(parsed?.git_sha ?? '')) problems.push('git_sha must be full 40-hex');
  if (!Number.isInteger(parsed?.run_number) || parsed.run_number <= 0) problems.push('run_number invalid');
  if (!Number.isInteger(parsed?.run_attempt) || parsed.run_attempt <= 0) problems.push('run_attempt invalid');
  if (!/^([0-9a-f]{64})$/i.test(parsed?.response_body_sha256 ?? '')) problems.push('response_body_sha256 invalid');
  if (typeof parsed?.workflow_name !== 'string' || parsed.workflow_name.length === 0) problems.push('workflow_name missing');
  if (Number.isNaN(Date.parse(parsed?.run_started_at ?? ''))) problems.push('run_started_at unparseable');
  if (!parsed?.sources || typeof parsed.sources !== 'object' || Array.isArray(parsed.sources)) problems.push('sources missing');
  return problems;
}

const targetSources = [...(manifest.seven_day_sources ?? [])].sort();
if (!Array.isArray(manifest.seven_day_sources) || targetSources.length !== 6) {
  fail(`CONFIG_MANIFEST.seven_day_sources must list exactly 6 sources, got: ${targetSources.length}`);
}
const criticalityMap = manifest.source_criticality ?? {};
if (
  !criticalityMap ||
  typeof criticalityMap !== 'object' ||
  targetSources.some((s) => criticalityMap[s] !== 'required' && criticalityMap[s] !== 'optional')
) {
  fail('CONFIG_MANIFEST.source_criticality must classify all seven-day sources — regenerate config.json');
}
/** A source is delivery-impacting on failure unless policy says otherwise. */
const policyZeroReasons = new Set(
  Object.entries(manifest.zero_contracts)
    .filter(([, c]) => c && c.allow_zero_success === true)
    .flatMap(([, c]) => (Array.isArray(c.allowed_reasons) ? c.allowed_reasons : [])),
);

// ---- B4 attribution: tick-slot partitioning (no grace overlap) ------------------------------
const TICK_GRACE_MS = 15 * 60 * 1000; // cron drift tolerance inside ONE hour bucket only
const dayStartMs = Date.parse(`${rawDay}T00:00:00Z`);
const dayEndMs = dayStartMs + DAY_MS;

for (const run of collectedRuns) {
  const startedMs = Date.parse(run.run_started_at);
  // Attribute to the hourly tick whose launch window covers the observed start:
  // [tick, tick + 1h + grace). This maps both an early 00:59 run of tick H and its late
  // 01:05 finisher onto tick H — but never across more than one boundary.
  const tickMs =
    Math.floor((startedMs - TICK_GRACE_MS) / 60 / 60 / 1000) * 60 * 60 * 1000 + TICK_GRACE_MS;
  run._tickMs = tickMs;
  run._tickIso = new Date(tickMs).toISOString();
}
const dayTicks = collectedRuns.filter((r) => r._tickMs >= dayStartMs && r._tickMs < dayEndMs);
if (dayTicks.length === 0) {
  fail(
    `no clock ticks attributable to ${rawDay}. Snapshot refused: covered day requires at least one tick.`,
  );
}
const laterRuns = collectedRuns.filter((r) => r._tickMs >= dayEndMs);
const priorRuns = collectedRuns.filter((r) => r._tickMs < dayStartMs);

// ---- B2 helpers -------------------------------------------------------------------------------
function hasFreshUpstreamIdentity(row) {
  const up = row.upstream;
  if (!up || typeof up !== 'object') return false;
  if (typeof up.content_hash !== 'string' || !/^[0-9a-f]{16,64}$/i.test(up.content_hash)) return false;
  if (up.upstream_updated_at != null && Number.isNaN(Date.parse(up.upstream_updated_at))) return false;
  return true;
}

/** Delta verdict vs previous day's published snapshot (§B2 fresh/delta contract). */
function deltaVerdict(sourceId, effectiveRow) {
  const prevPath = path.join(outDir, `${utcOffsetDays(rawDay, -1)}.json`);
  if (!fs.existsSync(prevPath)) return { verdict: 'first-day', previous_identity: null };
  const prevSnap = JSON.parse(fs.readFileSync(prevPath, 'utf8'));
  const prevEntry = (prevSnap.runs ?? []).find((r) => r.source_id === sourceId);
  const prevIdentity = prevEntry?.upstream_identity ?? null;
  const curIdentity = effectiveRow.upstream ?? null;
  if (!curIdentity) return { verdict: 'no-current-identity', previous_identity: prevIdentity };
  if (!prevIdentity) return { verdict: 'baseline-established', previous_identity: null };
  const changed =
    prevIdentity.content_hash !== curIdentity.content_hash ||
    prevIdentity.version_id !== curIdentity.version_id;
  return {
    verdict: changed ? 'upstream-changed' : 'unchanged',
    previous_identity: prevIdentity,
  };
}

// ---- per-source day aggregation ---------------------------------------------------------------
function evaluateSource(sourceId) {
  const notes = [];
  const rowsInDay = [];
  for (const run of dayTicks) {
    const row = run.sources[sourceId];
    if (!row) continue;
    rowsInDay.push({ row, run });
  }
  const actualRows = rowsInDay.filter(({ row }) => row.outcome !== 'deferred' && row.status !== 'no-op');
  const deferredRows = rowsInDay.filter(({ row }) => row.outcome === 'deferred');

  let effectiveRow = null;
  let effectiveRun = null;
  if (actualRows.length > 0) {
    effectiveRun = actualRows[actualRows.length - 1].run;
    effectiveRow = actualRows[actualRows.length - 1].row;
  }

  const criticality = criticalityOf(sourceId);
  const zeroContract = manifest.zero_contracts?.[sourceId] ?? { allow_zero_success: false };

  let status;
  let detail;
  if (effectiveRow) {
    if (effectiveRow.status === 'green_noop') {
      // B2 gate: policy zero contract + upstream identity + freshness + delta verdict.
      const identityOk = hasFreshUpstreamIdentity(effectiveRow);
      const contractAllows =
        zeroContract.allow_zero_success === true &&
        typeof effectiveRow.error_code === 'string' &&
        (zeroContract.allowed_reasons ?? []).includes(effectiveRow.error_code);
      const delta = deltaVerdict(sourceId, effectiveRow);
      const deltaOk = ['upstream-changed', 'unchanged', 'baseline-established'].includes(delta.verdict);
      status = identityOk && contractAllows && deltaOk ? 'green_noop' : 'red';
      notes.push(
        `noop gate: identity=${identityOk ? 'ok' : 'missing'} contract=${contractAllows ? 'allowed' : 'not-declared'} delta=${delta.verdict}`,
      );
      detail = notes[notes.length - 1];
    } else {
      status = effectiveRow.status; // green | red | deferred | no-op
      detail = effectiveRow.error_code ?? null;
    }
  } else {
    // No actual outcome in day D. Only scheduler-attested not-due keeps this out of failure;
    // deferred-only days and absent rows require later close-out below.
    const schedulerSaysNotDue = deferredRows.some(({ row }) => row.scheduler?.due === false);
    if (schedulerSaysNotDue) {
      status = 'not_due';
      detail = `all ${deferredRows.length} rows deferred; scheduler attested next_eligible_run_at in future`;
      if (deferredRows[deferredRows.length - 1].row.scheduler?.next_eligible_run_at != null) {
        notes.push(`next_eligible_run_at=${deferredRows.at(-1).row.scheduler.next_eligible_run_at}`);
      }
    } else if (deferredRows.length > 0) {
      status = 'overdue_deferred';
      detail = `${deferredRows.length} deferred row(s); scheduler did not attest future eligibility`;
    } else {
      status = 'unknown-missing-launch';
      detail = `no rows for source during ${rawDay} (explicit missing launch)`;
    }
  }

  return {
    source_id: sourceId,
    criticality,
    status,
    outcome: effectiveRow?.outcome ?? null,
    records_fetched: effectiveRow?.records_fetched ?? null,
    records_accepted: effectiveRow?.records_accepted ?? null,
    duplicate_records: effectiveRow?.duplicate_records ?? null,
    error_code: effectiveRow?.error_code ?? null,
    observation_row_ids: [], // deprecated field kept for schema compat; identity now upstream_identity
    upstream_identity: effectiveRow ? effectiveRow.upstream ?? null : null,
    close_condition: closeConditionFor(sourceId),
    detail,
    ...(notes.length > 0 ? { notes } : {}),
  };
}

/** §16 close-out: a later-tick run after the covered day with a real attempt for the slot. */
function closeConditionFor(sourceId) {
  const probeAfter = Date.parse(`${rawDay}T23:00:00Z`); // last tick of day D must be superseded
  for (const lr of [...laterRuns].sort((a, b) => Date.parse(a.run_started_at) - Date.parse(b.run_started_at))) {
    const row = lr.sources[sourceId];
    if (!row) continue;
    if (row.outcome === 'deferred') continue;
    const startMs = Date.parse(lr.run_started_at);
    if (startMs <= probeAfter) continue;
    return {
      satisfied_by_run_id: lr.run_id,
      satisfied_at: lr.run_started_at,
      awaited_launch_after: new Date(probeAfter).toISOString(),
    };
  }
  return {
    satisfied_by_run_id: null,
    satisfied_at: null,
    awaited_launch_after: new Date(probeAfter).toISOString(),
  };
}

function criticalityOf(sourceId) {
  const mapped = criticalityMap[sourceId];
  return mapped === 'required' || mapped === 'optional' ? mapped : 'required'; // unknown -> fail closed
}

const runs = targetSources.map((sourceId) => evaluateSource(sourceId));

// ---- §7 hard bounds (arithmetic corrected per blocker B6) -------------------------------------
const MAX_DEGRADED_OPTIONAL_SOURCES_PER_DAY = 2;
const MAX_CONSECUTIVE_DEGRADED_DAYS_PER_SOURCE = 2;
// Note: with N_OPTIONAL=4 among the six sources, max degraded 2 of 4 => at least 2 healthy
// optional remain; bounds apply within the six-source window, 2-of-N documented in runbook §7.

const OPTIONAL_IDS = targetSources.filter((s) => criticalityMap[s] === 'optional');
const REQUIRED_IDS = targetSources.filter((s) => criticalityMap[s] === 'required');

const degradedOptionalToday = runs.filter((r) => r.criticality === 'optional' && r.status !== 'green' && r.status !== 'green_noop' && r.status !== 'not_due');
const degradedRequiredToday = runs.filter(
  (r) => r.criticality === 'required' && r.status !== 'green' && r.status !== 'green_noop' && r.status !== 'not_due',
);

/** consecutive non-green days ending yesterday for an optional source, from published snapshots. */
function countConsecutiveDegradedDays(sourceId) {
  let streak = 0;
  let cursor = utcOffsetDays(rawDay, -1);
  while (streak <= MAX_CONSECUTIVE_DEGRADED_DAYS_PER_SOURCE + 1) {
    const prevPath = path.join(outDir, `${cursor}.json`);
    if (!fs.existsSync(prevPath)) break;
    const snap = JSON.parse(fs.readFileSync(prevPath, 'utf8'));
    const entry = (snap.runs ?? []).find((r) => r.source_id === sourceId && r.criticality === 'optional');
    const s = entry?.status ?? 'unknown';
    if (s === 'green' || s === 'green_noop' || s === 'not_due') break;
    streak += 1;
    cursor = utcOffsetDays(cursor, -1);
  }
  return streak;
}

const degradation_events = degradedOptionalToday.map((r) => ({
  source_id: r.source_id,
  kind: r.status,
  consecutive_degraded_days: countConsecutiveDegradedDays(r.source_id),
}));
degradation_events.forEach((e) => {
  e.within_bounds = e.consecutive_degraded_days <= MAX_CONSECUTIVE_DEGRADED_DAYS_PER_SOURCE;
});

const boundsExceeded =
  degradedOptionalToday.length > MAX_DEGRADED_OPTIONAL_SOURCES_PER_DAY ||
  degradation_events.some((e) => !e.within_bounds);

// ---- §5 day status + close-out ------------------------------------------------------------------
const RED_DAY_REASONS = [];
if (degradedRequiredToday.length > 0) {
  RED_DAY_REASONS.push(
    `required-source degradation: ${degradedRequiredToday.map((r) => `${r.source_id}:${r.status}`).join(', ')}`,
  );
}
if (boundsExceeded) RED_DAY_REASONS.push('optional degradation exceeds §7 hard bounds');
for (const r of runs) {
  if (r.criticality === 'required' && (r.status.startsWith('unknown') || r.status === 'overdue_deferred')) {
    RED_DAY_REASONS.push(`required source ${r.source_id}: ${r.status}`);
  }
  if (r.status === 'unknown-missing-launch') {
    RED_DAY_REASONS.push(`missing launch for ${r.source_id}`);
  }
  if (r.close_condition.satisfied_by_run_id == null && ['green', 'green_noop'].includes(r.status)) {
    RED_DAY_REASONS.push(`unclosed day for ${r.source_id}`);
  }
}

const openCloseConditions = runs.filter((r) => r.close_condition.satisfied_by_run_id == null);
let dayStatus;
if (RED_DAY_REASONS.length > 0) dayStatus = 'RED_DAY';
else if (openCloseConditions.length > 0) dayStatus = 'PENDING_CLOSE';
else dayStatus = 'GREEN_DAY';

const predecessorHash = readPredecessorHash(rawDay);
function readPredecessorHash(dayStr) {
  let cursor = utcOffsetDays(dayStr, -1);
  for (let i = 0; i < 14; i += 1) {
    const p = path.join(outDir, `${cursor}.json`);
    if (fs.existsSync(p)) {
      try {
        const snap = JSON.parse(fs.readFileSync(p, 'utf8'));
        return snap.snapshot_hash ?? sha256Canonical(snap);
      } catch {
        return null;
      }
    }
    cursor = utcOffsetDays(cursor, -1);
  }
  return null; // genesis snapshot of the window
}

const coreSnapshot = {
  schema_version: 2,
  evidence_type: 'source-refresh-coverage',
  evidence_day_utc: rawDay,
  ...(windowId ? { window_id: windowId } : {}),
  produced_at: new Date().toISOString(),
  producer: {
    kind: 'github-actions',
    repo_sha: repoSha,
    workflow_run_url: workflowRunUrl,
    policy_sha256: manifest.policy_sha256,
    schedules_sha256: manifest.schedules_sha256,
  },
  window_days: manifest.window_days ?? 7,
  tick_partitioning: {
    rule: 'floor-to-hour tick slot; run belongs solely to the tick day it was launched in',
    grace_ms: TICK_GRACE_MS,
    ticks_observed: [...new Set(dayTicks.map((r) => r._tickIso))].sort(),
    adjacent_day_runs_excluded: [...new Set(laterRuns.concat(priorRuns).map((r) => r.run_id))].sort().slice(0, 20),
  },
  runs,
  degradation_events,
  bounds_applied: {
    MAX_DEGRADED_OPTIONAL_SOURCES_PER_DAY,
    MAX_CONSECUTIVE_DEGRADED_DAYS_PER_SOURCE,
    note: 'bound applies to the N optional sources inside the six-source window (see runbook §7)',
  },
  red_day_reasons: RED_DAY_REASONS,
  close_condition_satisfied_by_all_sources: openCloseConditions.length === 0,
  day_status: dayStatus,
  immutability: 'append-only: изменения запрещены, исправление — новый файл-замена со ссылкой на предыдущий',
};
if (predecessorHash) coreSnapshot.predecessor_snapshot_hash = predecessorHash;

// Chain integrity: snapshot_hash covers the serialized core INCLUDING predecessor reference.
coreSnapshot.snapshot_hash = sha256Canonical(coreSnapshot);

const serialize = () => `${JSON.stringify(coreSnapshot, null, 2)}\n`;
if (dayStatus === 'PENDING_CLOSE') {
  fs.writeFileSync(pendingPath, serialize(), 'utf8');
  console.log(`PENDING snapshot drafted (NOT published): ${pendingPath}`);
  console.log(
    `  open close conditions: ${openCloseConditions.map((r) => r.source_id).join(', ')}` +
      ' — awaiting subsequent non-deferred attempts in later-tick runs',
  );
  console.log('  day will close once later-run outcomes exist; rerun collector then.');
} else {
  fs.writeFileSync(outPath, serialize(), 'utf8');
  console.log(`OK snapshot written: ${outPath}`);
  console.log(`  day_status=${dayStatus} ticks_used=${dayTicks.length}`);
  console.log(`  runs: ${runs.map((r) => `${r.source_id}=${r.status}${r.outcome ? `/${r.outcome}` : ''}`).join(', ')}`);
  console.log(
    `  degraded_optional_today=${degradedOptionalToday.length}/${MAX_DEGRADED_OPTIONAL_SOURCES_PER_DAY}${boundsExceeded ? ' BOUNDS_EXCEEDED' : ''}`,
  );
  console.log(`  degraded_required=${degradedRequiredToday.length}`);
  if (predecessorHash) console.log(`  chain: predecessor=${predecessorHash.slice(0, 12)}… -> ${coreSnapshot.snapshot_hash.slice(0, 12)}…`);
}
