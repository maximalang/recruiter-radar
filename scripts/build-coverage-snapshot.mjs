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
import {
  recomputeSnapshotHash,
  sha256Canonical,
  stableStringify,
  utcOffsetDays,
} from './lib/coverage-integrity.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

const rawDay = process.env.COVERAGE_DAY_UTC ?? '';
const runsDir = process.env.REFRESH_RUNS_DIR ?? '';
const configManifestPath = process.env.CONFIG_MANIFEST ?? '';
const repoSha = process.env.REPO_SHA ?? '';
const workflowRunUrl = process.env.WORKFLOW_RUN_URL ?? '';
const windowId = process.env.COVERAGE_WINDOW_ID ?? '';
const workflowRepo = workflowRunUrl.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\//)?.[1] ?? null;

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
  if (parsed.run_id !== file.slice(0, -'.json'.length)) {
    fail(`run summary ${file}: run_id does not match its filename (provenance binding)`);
  }
  if (workflowRepo && parsed.repository !== workflowRepo) {
    fail(`run summary ${file}: repository ${parsed.repository} != workflow URL repository ${workflowRepo}`);
  }
  collectedRuns.push(parsed);
}
collectedRuns.sort((a, b) => Date.parse(a.run_started_at) - Date.parse(b.run_started_at));

/**
 * Hash the exact collected summary (excluding only builder-local tick attribution). This is
 * carried into each source observation so a snapshot cannot silently swap a source row from a
 * different summary after collection (B5).
 */
function runSummaryDigest(run) {
  const { _tickMs, _tickIso, ...durable } = run;
  return sha256Canonical(durable);
}

function runAttestation(run) {
  return {
    run_id: run.run_id,
    run_number: run.run_number,
    run_attempt: run.run_attempt,
    repository: run.repository,
    workflow_name: run.workflow_name,
    event_name: run.event_name ?? null,
    scheduled_at_tick: run.scheduled_at_tick ?? null,
    git_sha: run.git_sha,
    run_started_at: run.run_started_at,
    response_body_sha256: run.response_body_sha256,
    artifact_digest: run._meta?.log_artifact_digest ?? null,
    summary_sha256: runSummaryDigest(run),
  };
}

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
  if (typeof parsed?.run_started_at !== 'string' || Number.isNaN(Date.parse(parsed?.run_started_at ?? ''))) problems.push('run_started_at unparseable');
  if (!parsed?.sources || typeof parsed.sources !== 'object' || Array.isArray(parsed.sources)) problems.push('sources missing');
  if (!['ok', 'noop', 'schema-error', 'unknown'].includes(parsed?.tick_result)) problems.push('tick_result missing/invalid');
  if (Array.isArray(parsed?.schema_errors) && parsed.schema_errors.length > 0) problems.push(`schema_errors present: ${parsed.schema_errors.join('; ')}`);
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
// B5 hardening: every contributing run summary must originate from the SAME deploy the
// snapshot claims as producer. A mixed-SHA day silently blends deploys into one evidence day.
for (const r of collectedRuns) {
  if ((r.git_sha ?? '').toLowerCase() !== repoSha.toLowerCase()) {
    fail(`run ${r.run_id}: provenance git_sha ${r.git_sha} != REPO_SHA ${repoSha}`);
  }
}
const laterRuns = collectedRuns.filter((r) => r._tickMs >= dayEndMs);
const priorRuns = collectedRuns.filter((r) => r._tickMs < dayStartMs);

// ---- B3 expected-vs-observed hourly tick ledger ------------------------------------------------
// The Source Refresh Clock cron is hourly, so EVERY UTC hour of the covered day owes one
// expected tick slot. Under the attribution formula above slots sit at hh:15 (launch-minus-
// grace floored to the hour, plus grace), and every hourly launch (the :45 schedule with
// drift/latency up to one hour) lands in its own hour's slot. Fewer observed slots than
// expected = missed workflow launches; two runs folded onto one slot = duplicate/unresolved
// launch. Both are DAY DEFECTS (protocol §17.2.4), never silent norms.
const HOUR_MS = 60 * 60 * 1000;
const EXPECTED_TICK_SLOTS_PER_DAY = 24;
const expectedSlotMsList = [];
for (let h = 0; h < EXPECTED_TICK_SLOTS_PER_DAY; h += 1) {
  expectedSlotMsList.push(dayStartMs + h * HOUR_MS + TICK_GRACE_MS);
}
const observedSlots = new Map(); // slotMs -> run ids
for (const r of dayTicks) {
  observedSlots.set(r._tickMs, [...(observedSlots.get(r._tickMs) ?? []), r.run_id]);
}
const missingTickSlots = expectedSlotMsList
  .filter((ms) => !observedSlots.has(ms))
  .map((ms) => new Date(ms).toISOString());
const duplicateTickSlots = [...observedSlots.entries()]
  .filter(([, ids]) => ids.length > 1)
  .map(([ms, ids]) => ({ slot: new Date(ms).toISOString(), run_ids: ids.sort() }));
const unresolvedTickSlots = dayTicks
  .filter((r) => r.tick_result !== 'ok')
  .map((r) => ({ slot: r._tickIso, run_id: r.run_id, tick_result: r.tick_result }));

// ---- B2 helpers -------------------------------------------------------------------------------
// Freshness horizon for upstream identity (protocol §2.2/§17.3): identity observed more than
// the 7-day window plus one grace day ago cannot witness a live stream, and rows whose
// upstream_updated_at falls outside [horizon, day-end] are stale.
const IDENTITY_FRESHNESS_WINDOW_DAYS = manifest.window_days ?? 7;
const IDENTITY_GRACE_DAYS = 1;

function hasFreshUpstreamIdentity(row) {
  const up = row.upstream;
  if (!up || typeof up !== 'object') return false;
  if (typeof up.content_hash !== 'string' || !/^[0-9a-f]{16,64}$/i.test(up.content_hash)) return false;
  if (up.upstream_updated_at == null) return false; // B2: undated identity is not freshness evidence
  const updatedMs = Date.parse(up.upstream_updated_at);
  if (Number.isNaN(updatedMs)) return false;
  if (updatedMs > dayEndMs) return false; // future-dated identity is fabricated
  const oldestFreshMs = dayStartMs - (IDENTITY_FRESHNESS_WINDOW_DAYS + IDENTITY_GRACE_DAYS) * DAY_MS;
  return updatedMs >= oldestFreshMs;
}

function normalizeIdentity(identity) {
  if (!identity || typeof identity !== 'object') return null;
  return {
    content_hash: identity.content_hash ?? identity.content_hash_sha256 ?? null,
    version_id: identity.version_id ?? identity.versionId ?? null,
    upstream_updated_at: identity.upstream_updated_at ?? identity.upstreamUpdatedAt ?? null,
  };
}

function sourceObservation(sourceId, run) {
  if (!run) return null;
  const attestation = runAttestation(run);
  return {
    source_id: sourceId,
    run_id: attestation.run_id,
    run_number: attestation.run_number,
    run_attempt: attestation.run_attempt,
    repository: attestation.repository,
    workflow_name: attestation.workflow_name,
    event_name: attestation.event_name,
    scheduled_at_tick: attestation.scheduled_at_tick,
    git_sha: attestation.git_sha,
    run_started_at: attestation.run_started_at,
    response_body_sha256: attestation.response_body_sha256,
    artifact_digest: attestation.artifact_digest,
    summary_sha256: attestation.summary_sha256,
    tick_slot: run._tickIso,
  };
}

/** Delta verdict vs previous day's published snapshot (§B2 fresh/delta contract). */
function deltaVerdict(sourceId, effectiveRow) {
  const prevPath = path.join(outDir, `${utcOffsetDays(rawDay, -1)}.json`);
  if (!fs.existsSync(prevPath)) return { verdict: 'baseline-established', previous_identity: null };
  const prevSnap = JSON.parse(fs.readFileSync(prevPath, 'utf8'));
  const prevEntry = (prevSnap.runs ?? []).find((r) => r.source_id === sourceId);
  const prevIdentity = normalizeIdentity(prevEntry?.upstream_row ?? prevEntry?.upstream_identity);
  const curIdentity = normalizeIdentity(effectiveRow.upstream);
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
      detail = identityOk ? notes[notes.length - 1] : 'zero-without-upstream-identity';
    } else if (effectiveRow.status === 'green') {
      // B2 v4: the freshness/delta gate applies to ANY green evidence, not only no-ops.
      // A green run without fresh dated upstream identity cannot witness a live stream.
      const identityOk = hasFreshUpstreamIdentity(effectiveRow);
      const delta = deltaVerdict(sourceId, effectiveRow);
      const deltaOk = ['upstream-changed', 'unchanged', 'baseline-established'].includes(delta.verdict);
      status = identityOk && deltaOk ? 'green' : 'red';
      notes.push(
        `green gate: identity=${identityOk ? 'fresh' : 'stale-or-missing'} delta=${delta.verdict}`,
      );
      detail = effectiveRow.error_code ?? null;
      if (!identityOk) detail = detail ?? 'green-without-fresh-upstream-identity';
    } else {
      status = effectiveRow.status; // green | red | deferred | no-op
      detail = effectiveRow.error_code ?? null;
    }
  } else {
    // No actual outcome in day D. Only scheduler-attested not-due keeps this out of failure;
    // deferred-only days and absent rows require later close-out below.
    // B1 v4: a deferral attests "not due" ONLY with a valid next_eligible_run_at strictly in
    // the future of the deferring run. Past, missing or unparseable timestamps are overdue
    // self-attestation (review case A), never an excuse.
    const deferredWithAttestation = deferredRows.filter(({ row, run }) => {
      if (row.scheduler?.due !== false) return false;
      const rawNext = row.scheduler?.next_eligible_run_at;
      if (rawNext == null) return false;
      const nextMs = Date.parse(rawNext);
      if (Number.isNaN(nextMs)) return false;
      return nextMs > Date.parse(run.run_started_at);
    });
    // A future attestation is scoped to its own scheduled slot. It cannot excuse a later
    // overdue/deferred slot for the same source (the v4 false-GREEN case F).
    const invalidDeferredRows = deferredRows.filter(
      ({ row, run }) => !deferredWithAttestation.some((candidate) => candidate.run.run_id === run.run_id),
    );
    const futureAttestation = deferredWithAttestation.at(-1);
    if (deferredRows.length > 0 && invalidDeferredRows.length === 0 && futureAttestation) {
      status = 'not_due';
      detail = `${deferredRows.length} row(s) deferred; every observed slot attested due=false with future next_eligible_run_at`;
      notes.push(`next_eligible_run_at=${futureAttestation.row.scheduler.next_eligible_run_at}`);
    } else if (deferredRows.length > 0) {
      status = 'overdue_deferred';
      detail = `${deferredRows.length} deferred row(s); at least one observed slot lacked future eligibility attestation`;
      if (futureAttestation) notes.push('early deferral attestation cannot mask a later overdue slot');
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
    // B2 v4: machine-readable gate results, so the window checker (and reviewers) can verify
    // greenness structurally instead of trusting the status string alone.
    upstream_identity: effectiveRow
      ? {
          present: Boolean(effectiveRow.upstream && typeof effectiveRow.upstream === 'object'),
          content_hash_sha256: hasFreshUpstreamIdentity(effectiveRow)
            ? String(effectiveRow.upstream?.content_hash ?? '')
            : null,
          upstream_updated_at: effectiveRow.upstream?.upstream_updated_at ?? null,
          fresh: hasFreshUpstreamIdentity(effectiveRow),
        }
      : { present: false, content_hash_sha256: null, upstream_updated_at: null, fresh: false },
    delta_verdict:
      effectiveRow && ['green', 'green_noop'].includes(status)
        ? (() => {
            const d = deltaVerdict(sourceId, effectiveRow);
            return { verdict: d.verdict, ...(d.reason ? { reason: d.reason } : {}) };
          })()
        : null,
    error_code: effectiveRow?.error_code ?? null,
    observation_row_ids: [], // deprecated field kept for schema compat; identity now upstream_identity
    upstream_row: effectiveRow ? effectiveRow.upstream ?? null : null,
    source_observation: sourceObservation(sourceId, effectiveRun),
    close_condition: closeConditionFor(sourceId),
    detail,
    ...(notes.length > 0 ? { notes } : {}),
  };
}

/**
 * §16 close-out (B4 v4): the day is witnessed by the FIRST expected subsequent tick slot —
 * `D+1 00:15Z` — and only inside the bounded window `[D 23:15Z, D+1 02:00Z]`. A later run
 * inside that window closes the day with its own provenance; NO run within the window leaves
 * close-out open (day red/pending); a run arriving after the immutable closure deadline is
 * NOT accepted as retroactive evidence (review case C) — it is its own late tick, and the
 * day carries an explicit backfill_rejected marker instead of greenness.
 */
const CLOSE_PROBE_AFTER_MS = dayEndMs - HOUR_MS + TICK_GRACE_MS;
// Immutable closure deadline: the first expected subsequent slot lives at D+1 00:15Z; the
// witnessed launch must occur no later than two hours into D+1 (B4 v4, review case C).
const CLOSE_WINDOW_END_MS = dayStartMs + DAY_MS + 2 * HOUR_MS;
const closeConditionFor = (sourceId) => {
  const eligible = [...laterRuns]
    .sort((a, b) => Date.parse(a.run_started_at) - Date.parse(b.run_started_at))
    .find((lr) => {
      const startMs = Date.parse(lr.run_started_at);
      return (
        startMs > CLOSE_PROBE_AFTER_MS &&
        startMs <= CLOSE_WINDOW_END_MS &&
        (lr.tick_result ?? '') === 'ok' &&
        // §16 is source-bound: a source-less later run cannot close every slot. The
        // witnessing summary must contain this source and a non-deferred outcome.
        lr.sources?.[sourceId] &&
        lr.sources[sourceId].outcome !== 'deferred' &&
        lr.sources[sourceId].status !== 'deferred'
      );
    });
  const lateRun = [...laterRuns]
    .filter((lr) => Date.parse(lr.run_started_at) > CLOSE_WINDOW_END_MS)
    .sort((a, b) => Date.parse(a.run_started_at) - Date.parse(b.run_started_at))[0];
  if (!eligible) {
    return {
      satisfied_by_run_id: null,
      satisfied_at: null,
      awaited_launch_after: new Date(CLOSE_PROBE_AFTER_MS).toISOString(),
      ...(lateRun || Date.now() > CLOSE_WINDOW_END_MS
        ? {
            backfill_rejected: lateRun
              ? `run ${lateRun.run_id} started at ${lateRun.run_started_at} after closure deadline ${new Date(CLOSE_WINDOW_END_MS).toISOString()}`
              : `closure deadline ${new Date(CLOSE_WINDOW_END_MS).toISOString()} passed without witnessing run`,
          }
        : {}),
    };
  }
  return {
    satisfied_by_run_id: eligible.run_id,
    satisfied_at: eligible.run_started_at,
    awaited_launch_after: new Date(CLOSE_PROBE_AFTER_MS).toISOString(),
    closed_by_tick_slot: eligible._tickIso,
    witness_source_id: sourceId,
    witness_response_body_sha256: eligible.response_body_sha256 ?? null,
    witness_artifact_digest: eligible._meta?.log_artifact_digest ?? null,
  };
};

function criticalityOf(sourceId) {
  const mapped = criticalityMap[sourceId];
  return mapped === 'required' || mapped === 'optional' ? mapped : 'required'; // unknown -> fail closed
}

const runs = targetSources.map((sourceId) => evaluateSource(sourceId));

// ---- §7 hard bounds (arithmetic corrected per blocker B6) -------------------------------------
const MAX_DEGRADED_OPTIONAL_SOURCES_PER_DAY = 2;
const MAX_CONSECUTIVE_DEGRADED_DAYS_PER_SOURCE = 2;
// Note: among the six 7-day sources there are N_OPTIONAL=5 optional and N_REQUIRED=1 required
// (egrul-fns), per config.json required_optional_counts. Max degraded 2 of 5 => at least 3
// healthy optional remain; bounds apply within the six-source window, 2-of-N in runbook §7.

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

// ---- B3: expected-vs-observed tick ledger feeds day status (§17.2.4) ----------------------------
if (missingTickSlots.length > 0) {
  RED_DAY_REASONS.push(
    `missing workflow launch slots (${missingTickSlots.length}/${EXPECTED_TICK_SLOTS_PER_DAY}): first=${missingTickSlots[0]}`,
  );
}
if (duplicateTickSlots.length > 0) {
  RED_DAY_REASONS.push(
    `duplicate/unresolved tick slots: ${duplicateTickSlots.map((d) => `${d.slot}<=${d.run_ids.join('+')}`).join(', ')}`,
  );
}
if (unresolvedTickSlots.length > 0) {
  RED_DAY_REASONS.push(
    `unresolved tick results: ${unresolvedTickSlots.map((d) => `${d.slot}=${d.tick_result}`).join(', ')}`,
  );
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
        // B5 v4: the predecessor reference is only trusted when it provably hashes to the
        // predecessor's own content AND the predecessor day strictly precedes this day. A
        // tampered or misdated file silently forges a chain link.
        if (snap.evidence_day_utc !== cursor) return null;
        if (recomputeSnapshotHash(snap) !== snap.snapshot_hash) {
          fail(
            `predecessor snapshot ${cursor}.json content does not match its own snapshot_hash — refusing to chain onto corrupted evidence`,
          );
        }
        return snap.snapshot_hash;
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
    workflow_name: 'Source Refresh Clock',
    repository: workflowRepo,
    policy_sha256: manifest.policy_sha256,
    schedules_sha256: manifest.schedules_sha256,
    config_manifest_sha256: sha256Canonical(manifest),
  },
  // The builder records, but never upgrades, collector provenance. The checker only accepts a
  // published window when every source observation has a durable artifact digest.
  trusted_provenance: {
    authority: 'downloaded-github-actions-artifact',
    status: collectedRuns.every((run) => /^[0-9a-f]{64}$/i.test(run._meta?.log_artifact_digest ?? ''))
      ? 'verified'
      : 'unverified',
    attestation_kind: 'collector-log-artifact-digest',
  },
  run_attestations: collectedRuns.map(runAttestation),
  window_days: manifest.window_days ?? 7,
  tick_partitioning: {
    rule: 'floor-to-hour tick slot; run belongs solely to the tick day it was launched in',
    grace_ms: TICK_GRACE_MS,
    ticks_observed: [...new Set(dayTicks.map((r) => r._tickIso))].sort(),
    adjacent_day_runs_excluded: [...new Set(laterRuns.concat(priorRuns).map((r) => r.run_id))].sort().slice(0, 20),
  },
  // B3 v4: explicit expected-vs-observed ledger. An hourly cron owes exactly 24 slots; the
  // checker enforces this structurally instead of trusting prose claims of full-day coverage.
  tick_ledger: {
    expected_slots_per_day: EXPECTED_TICK_SLOTS_PER_DAY,
    expected_slots_utc: expectedSlotMsList.map((ms) => new Date(ms).toISOString()),
    observed_slot_count: observedSlots.size,
    missing_slots_utc: missingTickSlots,
    duplicate_slots: duplicateTickSlots,
    unresolved_slots: unresolvedTickSlots,
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
