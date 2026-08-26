#!/usr/bin/env node
/**
 * Coverage-window gate v2 for the source-refresh proof protocol §9.5 (blockers B4, B5, B6).
 *
 * Mechanical formula (all mandatory):
 *   READY <=> for every day D in the last 7 UTC days
 *     a) snapshot <D>.json exists, parses, carries schema_version=2 producer identity and
 *        re-computes to its snapshot_hash (tamper detection; B5);
 *     b) the hash chain holds: predecessor_snapshot_hash == previous day's snapshot_hash
 *        across consecutive published days in the window (B5);
 *     c) day_status is GREEN_DAY with §7 bounds respected (B6 arithmetic: 2-of-N optional
 *        bound, bound value read from snapshot.bounds_applied) and §16 close-out satisfied;
 *     d) producer provenance resolves to a full 40-hex deploy SHA + workflow run URL whose
 *        commit sha matches REPO_SHA when provided;
 *     e) acceptance-recency: each source shows records_accepted > 0 at least once in window,
 *        so auditable no-op streams cannot masquerade as live evidence.
 *
 * Unsigned/hand-made snapshots (no producer, no snapshot_hash, mismatched hash chain,
 * missing workflow identity) fail closed — B5 regression on the fabricated-window attack.
 *
 * Inputs:
 *   CONFIG_MANIFEST       config.json path (default docs/evidence/source-refresh-coverage/config.json)
 *   COVERAGE_SNAPSHOT_DIR directory with <day>.json snapshots (defaults to manifest's dir)
 *   COVERAGE_REF_DAY_UTC  reference day YYYY-MM-DD (defaults today UTC); window = 7 days ending here
 *   EXPECTED_REPO_SHA     optional full 40-hex deploy SHA that must match every snapshot's producer.repo_sha
 *
 * Exit codes: 0 ready | 1 not ready.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { recomputeSnapshotHash } from './lib/coverage-integrity.mjs';

const manifestPath = process.env.CONFIG_MANIFEST ?? 'docs/evidence/source-refresh-coverage/config.json';
const refDay = process.env.COVERAGE_REF_DAY_UTC ?? new Date().toISOString().slice(0, 10);
const expectedRepoSha = process.env.EXPECTED_REPO_SHA ?? '';

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(manifestPath)) fail(`config manifest not found: ${manifestPath}`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(refDay)) fail('COVERAGE_REF_DAY_UTC must be YYYY-MM-DD');
if (expectedRepoSha && !/^[0-9a-f]{40}$/.test(expectedRepoSha)) {
  fail('EXPECTED_REPO_SHA must be a full 40-hex git SHA');
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const targetSources = [...(manifest.seven_day_sources ?? [])].sort();
if (!Array.isArray(manifest.seven_day_sources) || targetSources.length !== 6) {
  fail(`config manifest seven_day_sources must list exactly 6 sources, got ${targetSources.length}`);
}
const outDir = path.resolve(process.env.COVERAGE_SNAPSHOT_DIR ?? path.dirname(manifestPath));
const WINDOW_DAYS = Number(manifest.window_days ?? 7);

function utcOffsetDays(dayStr, delta) {
  const d = new Date(`${dayStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Full structural+integrity evaluation of one published day snapshot. */
function evalDay(dayStr) {
  const p = path.join(outDir, `${dayStr}.json`);
  if (!fs.existsSync(p)) return { ok: false, snap: null, reasons: [`missing snapshot ${p}`] };
  let snap;
  try {
    snap = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return { ok: false, snap: null, reasons: [`malformed snapshot ${p}`] };
  }
  const reasons = [];

  // ---- B5 integrity -----------------------------------------------------
  if (snap.schema_version !== 2) reasons.push(`${dayStr}: schema_version=${snap.schema_version}, expected 2`);
  if (!snap.producer || typeof snap.producer !== 'object') {
    reasons.push(`${dayStr}: missing producer identity (unsigned evidence rejected)`);
  } else {
    if (!/^[0-9a-f]{40}$/.test(snap.producer.repo_sha ?? '')) {
      reasons.push(`${dayStr}: producer.repo_sha not a full 40-hex SHA`);
    }
    if (!/^https:\/\/github\.com\/.+\/actions\/runs\/\d+/.test(snap.producer.workflow_run_url ?? '')) {
      reasons.push(`${dayStr}: producer.workflow_run_url missing/not an Actions run URL`);
    }
    if (expectedRepoSha && snap.producer.repo_sha !== expectedRepoSha) {
      reasons.push(`${dayStr}: producer.repo_sha != EXPECTED_REPO_SHA`);
    }
    if (
      typeof manifest.policy_sha256 === 'string' &&
      snap.producer.policy_sha256 !== manifest.policy_sha256
    ) {
      reasons.push(`${dayStr}: snapshot policy_sha256 differs from config manifest`);
    }
    if (
      typeof manifest.schedules_sha256 === 'string' &&
      snap.producer.schedules_sha256 !== manifest.schedules_sha256
    ) {
      reasons.push(`${dayStr}: snapshot schedules_sha256 differs from config manifest`);
    }
  }
  if (typeof snap.snapshot_hash !== 'string' || !/^[0-9a-f]{64}$/.test(snap.snapshot_hash)) {
    reasons.push(`${dayStr}: snapshot_hash missing/not 64-hex`);
  } else {
    const recomputed = recomputeSnapshotHash(snap);
    if (recomputed !== snap.snapshot_hash) {
      reasons.push(`${dayStr}: snapshot_hash mismatch after recompute (tampered or hand-edited)`);
    }
  }

  // ---- day status / bounds / close-out -----------------------------------
  if (snap.day_status !== 'GREEN_DAY') {
    reasons.push(
      `${dayStr}: day_status=${snap.day_status} — ${(snap.red_day_reasons ?? []).join('; ')}`,
    );
  }
  const degradedOptional = (snap.degradation_events ?? []).length;
  const bound = Number((snap.bounds_applied ?? {}).MAX_DEGRADED_OPTIONAL_SOURCES_PER_DAY ?? NaN);
  if (!Number.isInteger(bound) || bound < 0) {
    reasons.push(`${dayStr}: bounds_applied.MAX_DEGRADED_OPTIONAL_SOURCES_PER_DAY missing`);
  } else if (degradedOptional > bound) {
    reasons.push(`${dayStr}: optional degradation (${degradedOptional}) exceeds hard bound (${bound})`);
  }
  if ((snap.degradation_events ?? []).some((e) => e.within_bounds === false)) {
    reasons.push(`${dayStr}: consecutive-day degradation exceeded`);
  }
  const runs = Array.isArray(snap.runs) ? snap.runs : [];
  if (runs.length !== targetSources.length) {
    reasons.push(`${dayStr}: runs[] has ${runs.length} entries, expected ${targetSources.length}`);
  }
  if (snap.close_condition_satisfied_by_all_sources !== true) {
    reasons.push(`${dayStr}: §16 close_condition not satisfied for all slots`);
  }
  const openSlots = runs
    .filter((r) => !r.close_condition || r.close_condition.satisfied_by_run_id == null)
    .map((r) => r.source_id);
  if (openSlots.length > 0) {
    reasons.push(`${dayStr}: §16 close-out missing for: ${openSlots.join(', ')}`);
  }
  // Every declared target source must be present exactly once per snapshot.
  const seenIds = new Set(runs.map((r) => r.source_id));
  for (const s of targetSources) {
    if (!seenIds.has(s)) reasons.push(`${dayStr}: missing run entry for ${s}`);
  }
  return { ok: reasons.length === 0, snap, reasons };
}

const days = [];
for (let i = WINDOW_DAYS - 1; i >= 0; i -= 1) days.push(utcOffsetDays(refDay, -i));

const dayResults = days.map((d) => ({ day: d, ...evalDay(d) }));

// ---- B5 hash-chain continuity -------------------------------------------
const chainIssues = [];
{
  let prev = null;
  for (const dr of [...dayResults].reverse()) {
    if (!dr.snap) continue;
    const curHash = dr.snap.snapshot_hash;
    const declaredPred = dr.snap.predecessor_snapshot_hash ?? null;
    if (prev === null) {
      // genesis day of window: predecessor may legitimately be null or out-of-window
      prev = curHash;
    } else {
      if (declaredPred == null) {
        chainIssues.push(`${dr.day}: predecessor_snapshot_hash absent but window continues`);
      } else if (declaredPred !== prev) {
        chainIssues.push(`${dr.day}: predecessor_snapshot_hash != previous snapshot_hash (chain break)`);
      }
      prev = curHash;
    }
  }
}

/** acceptance-recency within window. */
function acceptanceRecency(sourceId) {
  let latestAccepted = null;
  for (const { snap } of dayResults.filter((r) => r.snap)) {
    const entry = (snap.runs ?? []).find((r) => r.source_id === sourceId);
    if (entry && Number(entry.records_accepted ?? 0) > 0) {
      if (!latestAccepted || snap.evidence_day_utc > latestAccepted) latestAccepted = snap.evidence_day_utc;
    }
  }
  return latestAccepted;
}

const recencyGaps = [];
for (const src of targetSources) {
  const latest = acceptanceRecency(src);
  if (!latest) recencyGaps.push(`${src}: no records_accepted>0 anywhere in window`);
}

const daysOk = dayResults.every((d) => d.ok);
const ready = daysOk && chainIssues.length === 0 && recencyGaps.length === 0;

console.log('=== SOURCE REFRESH COVERAGE WINDOW GATE v2 (protocol §9.5) ===');
console.log(`reference_day=${refDay} window=${days[0]}..${days[days.length - 1]} (${WINDOW_DAYS} days)`);
for (const d of dayResults) {
  console.log(`  ${d.day}: ${d.ok ? 'GREEN' : 'FAIL'}${d.reasons.length ? ` — ${d.reasons.join('; ')}` : ''}`);
}
if (chainIssues.length > 0) {
  console.log('hash-chain issues:');
  chainIssues.forEach((g) => console.log(`  - ${g}`));
}
if (recencyGaps.length > 0) {
  console.log('acceptance-recency gaps:');
  recencyGaps.forEach((g) => console.log(`  - ${g}`));
}
console.log(
  `VERDICT: ${ready ? 'READY' : 'NOT_READY'} ` +
    `(green_days=${dayResults.filter((d) => d.ok).length}/${WINDOW_DAYS}, ` +
    `chain_issues=${chainIssues.length}, recency_gaps=${recencyGaps.length})`,
);
process.exit(ready ? 0 : 1);
