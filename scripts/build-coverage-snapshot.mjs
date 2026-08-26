#!/usr/bin/env node
/**
 * Source-refresh coverage snapshot collector (protocol §5-§9, §16; blockers B1, B3, B7).
 *
 * Builds one immutable daily coverage snapshot for the six 7-day-window sources from
 * GitHub Actions `Source Refresh Clock` run summaries produced by collect-refresh-logs.mjs
 * (CI logs are the accepted production evidence ring for §9.1).
 *
 * Inputs (all required):
 *   REFRESH_RUNS_DIR   directory with collect-refresh-logs.mjs output (<run_id>.json files)
 *   CONFIG_MANIFEST    docs/evidence/source-refresh-coverage/config.json from
 *                      generate-refresh-config-manifest.mjs (hashes, classification, targets)
 *   REPO_SHA           git SHA of the deploy producing the runs (typically GITHUB_SHA)
 *   COVERAGE_DAY_UTC   UTC calendar day the snapshot covers, YYYY-MM-DD
 * Optional:
 *   COVERAGE_ALLOW_PREVIOUS_DAY=true
 *                      resolve a deferred/never-invoked slot against the previous day's
 *                      non-deferred outcome (delayed-outcome acceptance; noted in the entry)
 *
 * Day-level evaluation:
 *   - ALL collected runs started inside day D participate (hourly clock => many runs);
 *   - per source the effective row = LAST non-deferred row of day D (earlier deferrals
 *     resolve against later sibling runs, mirroring scheduler overlap semantics);
 *   - green | green_noop -> green-ish, red -> red, nothing non-deferred all day ->
 *     `not_due` when scheduler explicitly did not invoke the source, else unknown;
 *   - §7 hard bounds apply to optional degradation only;
 *   - §16 close-out rule: a day snapshot is PUBLISHED only when every six-source slot has a
 *     subsequent actual (non-deferred) attempt in a LATER run (close_condition satisfied).
 *     Unsatisfied days produce `<day>.pending.json` drafts, never the immutable file.
 *
 * Output: <CONFIG_MANIFEST dir>/<day>.json (immutable) or <day>.pending.json; NEVER overwrites.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DAY_MS = 24 * 60 * 60 * 1000;

const rawDay = process.env.COVERAGE_DAY_UTC ?? '';
const allowPreviousDay = process.env.COVERAGE_ALLOW_PREVIOUS_DAY === 'true';
const runsDir = process.env.REFRESH_RUNS_DIR ?? '';
const configManifestPath = process.env.CONFIG_MANIFEST ?? '';
const repoSha = process.env.REPO_SHA ?? '';

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDay)) fail('COVERAGE_DAY_UTC must be YYYY-MM-DD');
if (!runsDir || !fs.existsSync(runsDir)) fail('REFRESH_RUNS_DIR must point to collected refresh-run JSON files');
if (!configManifestPath || !fs.existsSync(configManifestPath)) fail('CONFIG_MANIFEST must point to config.json');
if (!/^[0-9a-f]{7,40}$/i.test(repoSha)) fail('REPO_SHA must be a git SHA of the deploy producing the runs');

const manifest = JSON.parse(fs.readFileSync(configManifestPath, 'utf8'));
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

const outDir = path.resolve(path.dirname(configManifestPath));
const outPath = path.join(outDir, `${rawDay}.json`);
const pendingPath = path.join(outDir, `${rawDay}.pending.json`);
if (fs.existsSync(outPath)) {
  fail(`refusing to overwrite existing snapshot ${outPath}; corrections must use superseded-file mechanics`);
}

// ---- load collected runs ------------------------------------------------------------------
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
  if (!parsed || typeof parsed !== 'object' || !parsed.run_id || !parsed.run_started_at || !parsed.sources) {
    fail(`run summary missing required fields (run_id/run_started_at/sources): ${file}`);
  }
  const startedMs = Date.parse(parsed.run_started_at);
  if (Number.isNaN(startedMs)) fail(`run ${parsed.run_id}: unparseable run_started_at`);
  collectedRuns.push({ ...parsed, _startedMs: startedMs });
}
collectedRuns.sort((a, b) => a._startedMs - b._startedMs);

// ---- partition runs of the covered day vs earlier vs later --------------------------------
const dayStartMs = Date.parse(`${rawDay}T00:00:00Z`);
const dayEndMs = dayStartMs + DAY_MS;
// Runs up to +1h past midnight stay attributed to the covered day: 00:45 UTC launch is the
// canonical first clock tick of the day and may finish slightly past the boundary.
const GRACE_MS = 60 * 60 * 1000;
const dayRuns = collectedRuns.filter((r) => r._startedMs >= dayStartMs && r._startedMs < dayEndMs + GRACE_MS);
if (dayRuns.length === 0) {
  fail(
    `no collected clock run starts within ${rawDay}. Snapshot refused: covered day requires at least one clock run.`,
  );
}
const laterRuns = collectedRuns.filter((r) => r._startedMs >= dayEndMs + GRACE_MS);
const priorRuns = collectedRuns.filter((r) => r._startedMs < dayStartMs);

// ---- per-source day aggregation ------------------------------------------------------------
/** collapse a run-entry to coarse family for §5/§6 rules */
function statusFamily(entry) {
  const s = entry.status ?? classifyLegacyOutcome(entry.outcome);
  return s === 'green' || s === 'green_noop' ? 'green' : s === 'deferred' ? 'deferred' : 'red';
}
function classifyLegacyOutcome(outcome) {
  switch (outcome) {
    case 'ingested':
    case 'ingested-with-duplicates':
    case 'idempotent-replay':
    case 'expected-zero':
      return 'green_noop';
    case 'deferred':
      return 'deferred';
    default:
      return 'red';
  }
}

/** earliest LATER run containing a non-deferred row for this source (§16 close-out probe) */
function findCloseOut(sourceId, fromRunStartMs) {
  for (const lr of laterRuns) {
    const row = lr.sources[sourceId];
    if (row != null && row.outcome !== 'deferred' && lr._startedMs > fromRunStartMs) {
      return { satisfied_by_run_id: lr.run_id, satisfied_at: new Date(lr._startedMs).toISOString() };
    }
  }
  return { satisfied_by_run_id: null, satisfied_at: null };
}

function evaluateSource(sourceId) {
  const notes = [];
  const dayRows = dayRuns.filter((r) => r.sources[sourceId] != null && r.sources[sourceId].outcome !== 'deferred');
  let effectiveRow = null;
  let effectiveRun = null;
  if (dayRows.length > 0) {
    effectiveRun = dayRows[dayRows.length - 1];
    effectiveRow = effectiveRun.sources[sourceId];
  } else if (allowPreviousDay && priorRuns.length > 0) {
    const fallbackRun = [...priorRuns]
      .reverse()
      .find((r) => r.sources[sourceId] != null && r.sources[sourceId].outcome !== 'deferred');
    if (fallbackRun) {
      effectiveRun = fallbackRun;
      effectiveRow = fallbackRun.sources[sourceId];
      notes.push(
        `resolved via ${effectiveRow.outcome} from previous-day run ${effectiveRun.run_id} (delayed-outcome acceptance)`,
      );
    }
  }

  const criticality = criticalityOf(sourceId);
  // §16 close-out condition exists for EVERY six-source slot regardless of day outcome.
  const closeOut = findCloseOut(sourceId, dayStartMs);
  if (!effectiveRow) {
    // No actual outcome anywhere in day D (and no allowed fallback): explicit not-due/unknown.
    const invokedDeferred = dayRuns.some((r) => r.sources[sourceId] != null);
    return {
      source_id: sourceId,
      criticality,
      status: invokedDeferred || allowPreviousDay ? 'unknown' : 'unknown-missing-launch',
      outcome: invokedDeferred ? 'deferred' : null,
      observation_row_ids: [],
      close_condition: {
        awaited_launch_after: new Date(dayStartMs).toISOString(),
        ...closeOut,
      },
      detail:
        notes.join('; ') ||
        (invokedDeferred
          ? 'only deferred rows all day; no actual outcome'
          : `no rows for source during ${rawDay} (explicit missing launch, §6.2)`),
    };
  }

  const family = statusFamily(effectiveRow);
  return {
    source_id: sourceId,
    criticality,
    status: family === 'green' ? 'green' : family,
    outcome: effectiveRow.outcome,
    records_fetched: effectiveRow.records_fetched ?? null,
    records_accepted: effectiveRow.records_accepted ?? null,
    duplicate_records: effectiveRow.duplicate_records ?? null,
    latency_ms: effectiveRow.latency_ms ?? null,
    error_code: effectiveRow.error_code ?? null,
    observation_row_ids: effectiveRow.observation_row_ids ?? [],
    close_condition: {
      awaited_launch_after: new Date(effectiveRun._startedMs).toISOString(),
      ...closeOut,
    },
    ...(notes.length > 0 ? { notes } : {}),
  };
}

function criticalityOf(sourceId) {
  const mapped = criticalityMap[sourceId];
  return mapped === 'required' || mapped === 'optional' ? mapped : 'required'; // unknown -> fail closed
}

const runs = targetSources.map((sourceId) => evaluateSource(sourceId));

// ---- §7 hard bounds ------------------------------------------------------------------------
const MAX_DEGRADED_OPTIONAL_SOURCES_PER_DAY = 2;
const MAX_CONSECUTIVE_DEGRADED_DAYS_PER_SOURCE = 2;

const degradedOptionalToday = runs.filter((r) => r.criticality === 'optional' && r.status !== 'green');
const degradedRequiredToday = runs.filter((r) => r.criticality === 'required' && r.status !== 'green');

/** consecutive non-green days ending yesterday for an optional source, from append-only snapshots. */
function countConsecutiveDegradedDays(sourceId) {
  let streak = 0;
  let cursor = utcOffsetDays(rawDay, -1);
  while (streak <= MAX_CONSECUTIVE_DEGRADED_DAYS_PER_SOURCE + 1) {
    const prevPath = path.join(outDir, `${cursor}.json`);
    if (!fs.existsSync(prevPath)) break;
    const snap = JSON.parse(fs.readFileSync(prevPath, 'utf8'));
    const entry = (snap.runs ?? []).find((r) => r.source_id === sourceId && r.criticality === 'optional');
    if (!entry || entry.status === 'green') break;
    streak += 1;
    cursor = utcOffsetDays(cursor, -1);
  }
  return streak;
}

function utcOffsetDays(dayStr, delta) {
  const d = new Date(`${dayStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
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

// ---- §5 day status + §16 close-out ---------------------------------------------------------
const RED_DAY_REASONS = [];
if (degradedRequiredToday.length > 0) {
  RED_DAY_REASONS.push(
    `required-source degradation: ${degradedRequiredToday.map((r) => `${r.source_id}:${r.status}`).join(', ')}`,
  );
}
if (boundsExceeded) RED_DAY_REASONS.push('optional degradation exceeds §7 hard bounds');
if (runs.some((r) => r.criticality === 'required' && r.status.startsWith('unknown'))) {
  RED_DAY_REASONS.push('required source unknown/missing');
}
if (runs.some((r) => r.status === 'unknown-missing-launch')) {
  RED_DAY_REASONS.push('explicit missing launch (no previous-day resolution allowed)');
}

const openCloseConditions = runs.filter(
  (r) => r.close_condition && r.close_condition.satisfied_by_run_id == null,
);
const dayStatus =
  openCloseConditions.length > 0 && RED_DAY_REASONS.length === 0 ? 'PENDING_CLOSE' : RED_DAY_REASONS.length > 0 ? 'RED_DAY' : 'GREEN_DAY';

const snapshot = {
  schema_version: 1,
  evidence_type: 'source-refresh-coverage',
  evidence_day_utc: rawDay,
  produced_at: new Date().toISOString(),
  producer: {
    repo_sha: repoSha,
    policy_sha256: manifest.policy_sha256,
    schedules_sha256: manifest.schedules_sha256,
  },
  window_days: manifest.window_days ?? 7,
  runs,
  degradation_events,
  bounds_applied: {
    MAX_DEGRADED_OPTIONAL_SOURCES_PER_DAY,
    MAX_CONSECUTIVE_DEGRADED_DAYS_PER_SOURCE,
  },
  config_version_hash: `sha256:${createHash('sha256').update([repoSha, manifest.policy_sha256, manifest.schedules_sha256].join('|')).digest('hex')}`,
  red_day_reasons: RED_DAY_REASONS,
  close_condition_satisfied_by_all_sources: openCloseConditions.length === 0,
  day_status: dayStatus,
  immutability: 'append-only: изменения запрещены, исправление — новый файл-замена со ссылкой на предыдущий',
};

const serialize = () => `${JSON.stringify(snapshot, null, 2)}\n`;
if (dayStatus === 'PENDING_CLOSE') {
  fs.writeFileSync(pendingPath, serialize(), 'utf8');
  console.log(`PENDING snapshot drafted (NOT published): ${pendingPath}`);
  console.log(
    `  §16 open close conditions: ${openCloseConditions.map((r) => r.source_id).join(', ')}` +
      ' — awaiting subsequent non-deferred attempts in later runs',
  );
  console.log('  day will close automatically once later-run outcomes exist; rerun collector then.');
} else {
  fs.writeFileSync(outPath, serialize(), 'utf8');
  console.log(`OK snapshot written: ${outPath}`);
  console.log(`  day_status=${dayStatus} runs_used=${dayRuns.length}`);
  console.log(`  runs: ${runs.map((r) => `${r.source_id}=${r.status}${r.outcome ? `/${r.outcome}` : ''}`).join(', ')}`);
  console.log(
    `  degraded_optional_today=${degradedOptionalToday.length}/${MAX_DEGRADED_OPTIONAL_SOURCES_PER_DAY}${boundsExceeded ? ' BOUNDS_EXCEEDED' : ''}`,
  );
  console.log(`  degraded_required=${degradedRequiredToday.length}`);
}
