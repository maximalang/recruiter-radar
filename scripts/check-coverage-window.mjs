#!/usr/bin/env node
/**
 * Coverage-window gate for the source-refresh proof protocol §9.5 (blocker B6).
 *
 * Replaces prose-only evaluation ("manual readiness criteria") with a mechanical formula:
 *
 *   READY <=> for every day D in the last 7 UTC days
 *     a) snapshot <D>.json exists and is green (day_status GREEN_DAY, zero failedRequired);
 *     b) every optional degradation is inside §7 hard bounds; AND additionally
 *     c) (B4/§5 acceptance-recency) each seven-day-window source shows at least one
 *        records_accepted > 0 within its own last 7 daily snapshots, so that a stream of
 *        auditable no-ops cannot masquerade as live evidence.
 *
 * Inputs:
 *   CONFIG_MANIFEST      config.json path (default docs/evidence/source-refresh-coverage/config.json)
 *   COVERAGE_SNAPSHOT_DIR directory with <day>.json snapshots (defaults to the manifest's dir)
 *   COVERAGE_REF_DAY_UTC reference day, YYYY-MM-DD (defaults to today UTC); the window is the 7 days ENDING on this day
 *
 * Exit codes: 0 ready | 1 not ready (with per-day/per-source reason table).
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const manifestPath = process.env.CONFIG_MANIFEST ?? 'docs/evidence/source-refresh-coverage/config.json';
const refDay = process.env.COVERAGE_REF_DAY_UTC ?? new Date().toISOString().slice(0, 10);

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(manifestPath)) fail(`config manifest not found: ${manifestPath}`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(refDay)) fail('COVERAGE_REF_DAY_UTC must be YYYY-MM-DD');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const targetSources = [...(manifest.seven_day_sources ?? [])].sort();
const outDir = path.resolve(
  process.env.COVERAGE_SNAPSHOT_DIR ?? path.dirname(manifestPath),
);
const WINDOW_DAYS = Number(manifest.window_days ?? 7);
const MAX_DEGRADED_OPTIONAL_SOURCES_PER_DAY = 2;
const MAX_CONSECUTIVE_DEGRADED_DAYS_PER_SOURCE = 2;

function utcOffsetDays(dayStr, delta) {
  const d = new Date(`${dayStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** evaluate one day snapshot; returns {ok, missing, reasons[]} */
function evalDay(dayStr) {
  const p = path.join(outDir, `${dayStr}.json`);
  if (!fs.existsSync(p)) return { ok: false, reasons: [`missing snapshot ${p}`] };
  let snap;
  try {
    snap = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return { ok: false, reasons: [`malformed snapshot ${p}`] };
  }
  if (snap.day_status !== 'GREEN_DAY') {
    return { ok: false, reasons: [`${dayStr}: day_status=${snap.day_status} — ${(snap.red_day_reasons ?? []).join('; ')}`] };
  }
  const bounds = snap.bounds_applied ?? {};
  const degradedOptional = (snap.degradation_events ?? []).length;
  if (
    degradedOptional > (bounds.MAX_DEGRADED_OPTIONAL_SOURCES_PER_DAY ?? MAX_DEGRADED_OPTIONAL_SOURCES_PER_DAY)
  ) {
    return { ok: false, reasons: [`${dayStr}: optional degradation exceeds hard bound`] };
  }
  if ((snap.degradation_events ?? []).some((e) => e.within_bounds === false)) {
    return { ok: false, reasons: [`${dayStr}: consecutive-day degradation exceeded`] };
  }
  // §16 close-out condition must be satisfied by every six-source slot before the day counts.
  const runs = snap.runs ?? [];
  if (!Array.isArray(runs) || runs.length === 0) {
    return { ok: false, reasons: [`${dayStr}: snapshot has no runs[] entries`] };
  }
  if (snap.close_condition_satisfied_by_all_sources !== true) {
    return { ok: false, reasons: [`${dayStr}: §16 close_condition not satisfied for all slots`] };
  }
  const openSlots = runs
    .filter((r) => !r.close_condition || r.close_condition.satisfied_by_run_id == null)
    .map((r) => r.source_id);
  if (openSlots.length > 0) {
    return { ok: false, reasons: [`${dayStr}: §16 close-out missing for: ${openSlots.join(', ')}`] };
  }
  return { ok: true, snap, reasons: [] };
}

const days = [];
for (let i = WINDOW_DAYS - 1; i >= 0; i -= 1) days.push(utcOffsetDays(refDay, -i));

const dayResults = days.map((d) => ({ day: d, ...evalDay(d) }));

/** acceptance-recency: any day in window with actually accepted rows for this source? */
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
if (targetSources.length > 0) {
  for (const src of targetSources) {
    const latest = acceptanceRecency(src);
    if (!latest) recencyGaps.push(`${src}: no records_accepted>0 anywhere in window`);
  }
}

const daysOk = dayResults.every((d) => d.ok);
const ready = daysOk && recencyGaps.length === 0;

console.log('=== SOURCE REFRESH COVERAGE WINDOW GATE (protocol §9.5) ===');
console.log(`reference_day=${refDay} window=${days[0]}..${days[days.length - 1]} (${WINDOW_DAYS} days)`);
for (const d of dayResults) {
  console.log(`  ${d.day}: ${d.ok ? 'GREEN' : 'FAIL'}${d.reasons.length ? ` — ${d.reasons.join('; ')}` : ''}`);
}
if (recencyGaps.length > 0) {
  console.log('acceptance-recency gaps:');
  recencyGaps.forEach((g) => console.log(`  - ${g}`));
}
console.log(
  `VERDICT: ${ready ? 'READY' : 'NOT_READY'} ` +
    `(green_days=${dayResults.filter((d) => d.ok).length}/${WINDOW_DAYS}, recency_gaps=${recencyGaps.length})`,
);
process.exit(ready ? 0 : 1);
