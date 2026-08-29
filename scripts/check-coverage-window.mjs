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
 *        bound, bound value read from snapshot.bounds_applied), §16 close-out satisfied
 *        inside its immutable window (B4), and the §17.2.4 hourly tick ledger shows all 24
 *        expected launch slots observed exactly once (B3);
 *     d) producer provenance resolves to a full 40-hex deploy SHA + workflow run URL whose
 *        commit sha matches REPO_SHA when provided;
 *     e) acceptance-recency: each source shows records_accepted > 0 at least once in window,
 *        so auditable no-op streams cannot masquerade as live evidence;
 *     f) every green/green_noop entry carries fresh dated upstream identity plus an accepted
 *        delta verdict, verified from machine-readable per-run fields (B2 v4); criticality of
 *        every entry matches the canonical config manifest (schema-drift fail closed).
 *
 * Unsigned/hand-made snapshots (no producer, no snapshot_hash, mismatched hash chain,
 * missing workflow identity) fail closed — B5 regression on the fabricated-window attack.
 *
 * Inputs:
 *   CONFIG_MANIFEST       config.json path (default docs/evidence/source-refresh-coverage/config.json)
 *   COVERAGE_SNAPSHOT_DIR directory with <day>.json snapshots (defaults to manifest's dir)
 *   COVERAGE_REF_DAY_UTC  reference day YYYY-MM-DD (defaults today UTC); window = 7 days ending here
 *   EXPECTED_REPO_SHA     optional full 40-hex deploy SHA that must match every snapshot's producer.repo_sha
 *   SOURCE_REFRESH_LOGS_DIR downloaded artifacts/<run_id>/ with workflow-generated manifest + log bytes;
 *                         required for READY (summary-declared provenance is never authority)
 *
 *
 * Exit codes: 0 ready | 1 not ready.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  verifySummaryAgainstArtifact,
  workflowRunUrlParts,
} from './lib/coverage-authority.mjs';
import { recomputeSnapshotHash, sha256Canonical } from './lib/coverage-integrity.mjs';

const manifestPath = process.env.CONFIG_MANIFEST ?? 'docs/evidence/source-refresh-coverage/config.json';
const refDay = process.env.COVERAGE_REF_DAY_UTC ?? new Date().toISOString().slice(0, 10);
const expectedRepoSha = process.env.EXPECTED_REPO_SHA ?? '';
const sourceLogsDir = process.env.SOURCE_REFRESH_LOGS_DIR ?? '';

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
const HOUR_MS = 60 * 60 * 1000;
const TICK_GRACE_MS = 15 * 60 * 1000;

function expectedTickSlots(dayStr) {
  const start = Date.parse(`${dayStr}T00:00:00Z`);
  return Array.from({ length: 24 }, (_, hour) => new Date(start + hour * HOUR_MS + TICK_GRACE_MS).toISOString());
}

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
    if (
      typeof snap.producer.config_manifest_sha256 !== 'string' ||
      snap.producer.config_manifest_sha256 !== sha256Canonical(manifest)
    ) {
      reasons.push(`${dayStr}: producer.config_manifest_sha256 does not bind this snapshot to the immutable config manifest`);
    }
    const urlRepo = snap.producer.workflow_run_url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\//)?.[1];
    if (snap.producer.repository !== urlRepo) {
      reasons.push(`${dayStr}: producer.repository does not match workflow_run_url repository`);
    }
    if (snap.producer.workflow_name !== 'Source Refresh Clock') {
      reasons.push(`${dayStr}: producer.workflow_name is not Source Refresh Clock`);
    }
  }
  const runs = Array.isArray(snap.runs) ? snap.runs : [];
  // A summary can describe a GitHub run, but it cannot be its own authority. The collector's
  // artifact digest is the durable boundary: without it a hand-made summary/window is never
  // eligible for READY, even when its producer fields and self-hash look correct.
  if (snap.trusted_provenance?.authority !== 'downloaded-github-actions-artifact') {
    reasons.push(`${dayStr}: trusted provenance authority missing (self-declared summaries rejected)`);
  }
  if (snap.trusted_provenance?.status !== 'verified') {
    reasons.push(`${dayStr}: trusted provenance is not verified by a collected artifact digest`);
  }
  if (snap.trusted_provenance?.attestation_kind !== 'collector-log-artifact-digest') {
    reasons.push(`${dayStr}: unsupported trusted provenance attestation kind`);
  }
  const runAttestations = Array.isArray(snap.run_attestations) ? snap.run_attestations : [];
  const attestationsById = new Map(runAttestations.map((a) => [a.run_id, a]));
  if (runAttestations.length === 0) reasons.push(`${dayStr}: run_attestations missing`);
  for (const r of runs) {
    const isGreenish = r.status === 'green' || r.status === 'green_noop';
    const obs = r.source_observation;
    if (!isGreenish && !obs) continue;
    if (!obs || obs.source_id !== r.source_id) {
      reasons.push(`${dayStr}: ${r.source_id}: source-bound observation missing`);
      continue;
    }
    if (!/^[0-9a-f]{64}$/i.test(obs.artifact_digest ?? '')) {
      reasons.push(`${dayStr}: ${r.source_id}: source observation lacks durable artifact digest`);
    }
    if (!/^[0-9a-f]{64}$/i.test(obs.summary_sha256 ?? '')) {
      reasons.push(`${dayStr}: ${r.source_id}: source observation lacks summary digest`);
    }
    if (obs.event_name !== 'schedule' || typeof obs.scheduled_at_tick !== 'string' || !obs.scheduled_at_tick) {
      reasons.push(`${dayStr}: ${r.source_id}: observation is not bound to a scheduled GitHub event`);
    }
    if (obs.repository !== snap.producer?.repository || obs.workflow_name !== snap.producer?.workflow_name) {
      reasons.push(`${dayStr}: ${r.source_id}: observation producer identity differs from snapshot producer`);
    }
    const attestation = attestationsById.get(obs.run_id);
    if (!attestation) {
      reasons.push(`${dayStr}: ${r.source_id}: observation run ${obs.run_id} has no attestation`);
      continue;
    }
    for (const field of [
      'run_number',
      'run_attempt',
      'repository',
      'workflow_name',
      'event_name',
      'scheduled_at_tick',
      'git_sha',
      'run_started_at',
      'response_body_sha256',
      'artifact_digest',
      'summary_sha256',
    ]) {
      if (obs[field] !== attestation[field]) {
        reasons.push(`${dayStr}: ${r.source_id}: observation/attestation ${field} mismatch`);
      }
    }
  }

  // The summary's _meta and trusted_provenance are claims, not authority. Re-open every
  // downloaded artifact and compare its manifest/bytes with the attestation before READY.
  const producerUrl = workflowRunUrlParts(snap.producer?.workflow_run_url);
  if (!sourceLogsDir) {
    reasons.push(`${dayStr}: SOURCE_REFRESH_LOGS_DIR is required for authoritative artifact verification`);
  } else {
    if (!producerUrl) {
      reasons.push(`${dayStr}: producer workflow URL cannot be resolved to a GitHub run identity`);
    }
    const authoritativeRunIds = new Set();
    for (const attestation of runAttestations) {
      const summary = {
        run_id: attestation.run_id,
        run_number: attestation.run_number,
        run_attempt: attestation.run_attempt,
        repository: attestation.repository,
        workflow_name: attestation.workflow_name,
        event_name: attestation.event_name,
        scheduled_at_tick: attestation.scheduled_at_tick,
        git_sha: attestation.git_sha,
        _meta: {
          log_artifact_digest: attestation.artifact_digest,
          authority_manifest_sha256: attestation.authority_manifest_sha256,
          authority_verified: attestation.authority_verified,
        },
      };
      const authority = verifySummaryAgainstArtifact(summary, sourceLogsDir);
      if (!authority.verified || attestation.authority_verified !== true) {
        reasons.push(
          `${dayStr}: run ${attestation.run_id}: authoritative artifact verification failed${
            authority.problems.length > 0 ? ` (${authority.problems.join('; ')})` : ''
          }`,
        );
      } else {
        authoritativeRunIds.add(String(attestation.run_id));
      }
    }
    if (producerUrl && !authoritativeRunIds.has(producerUrl.run_id)) {
      reasons.push(`${dayStr}: producer workflow URL run_id is not present in authoritative attestations`);
    }
    if (producerUrl?.run_attempt != null) {
      const matchingAttempt = runAttestations.some(
        (attestation) => String(attestation.run_id) === producerUrl.run_id && attestation.run_attempt === producerUrl.run_attempt,
      );
      if (!matchingAttempt) reasons.push(`${dayStr}: producer workflow URL run_attempt is not authoritative`);
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
  // ---- B3 v4: expected-vs-observed hourly tick ledger ---------------------------------------
  const ledger = snap.tick_ledger ?? null;
  if (!ledger || typeof ledger !== 'object') {
    reasons.push(`${dayStr}: tick_ledger missing — snapshot predates v4 protocol`);
  } else {
    const expected = Number(ledger.expected_slots_per_day);
    if (expected !== 24) reasons.push(`${dayStr}: tick_ledger.expected_slots_per_day=${expected}, expected 24`);
    const canonicalExpected = expectedTickSlots(dayStr);
    if (JSON.stringify(ledger.expected_slots_utc) !== JSON.stringify(canonicalExpected)) {
      reasons.push(`${dayStr}: tick_ledger.expected_slots_utc does not match canonical hourly UTC slots`);
    }
    const observedCount = Number(ledger.observed_slot_count);
    if (!Number.isInteger(observedCount) || observedCount < 0) {
      reasons.push(`${dayStr}: tick_ledger.observed_slot_count invalid`);
    } else if (observedCount !== 24) {
      reasons.push(`${dayStr}: tick_ledger observed ${observedCount}/24 slots`);
    }
    const observed = snap.tick_partitioning?.ticks_observed;
    if (!Array.isArray(observed)) {
      reasons.push(`${dayStr}: tick_partitioning.ticks_observed missing`);
    } else {
      const expectedSet = new Set(canonicalExpected);
      const observedSet = new Set(observed);
      const missingCanonical = canonicalExpected.filter((slot) => !observedSet.has(slot));
      const unexpected = observed.filter((slot) => !expectedSet.has(slot));
      if (observed.length !== observedSet.size) reasons.push(`${dayStr}: duplicate ticks_observed entries`);
      if (missingCanonical.length > 0) reasons.push(`${dayStr}: canonical observed ledger missing ${missingCanonical.length} slots`);
      if (unexpected.length > 0) reasons.push(`${dayStr}: canonical observed ledger has unexpected slots (${unexpected[0]})`);
    }
    if (!Array.isArray(ledger.missing_slots_utc)) {
      reasons.push(`${dayStr}: tick_ledger.missing_slots_utc invalid`);
    } else if (ledger.missing_slots_utc.length > 0) {
      reasons.push(`${dayStr}: ${ledger.missing_slots_utc.length}/24 workflow launch slots missed (first=${ledger.missing_slots_utc[0]})`);
    }
    if (!Array.isArray(ledger.duplicate_slots)) {
      reasons.push(`${dayStr}: tick_ledger.duplicate_slots invalid`);
    } else if (ledger.duplicate_slots.length > 0) {
      reasons.push(`${dayStr}: duplicate/unresolved launch slots: ${ledger.duplicate_slots.map((d) => d.slot).join(', ')}`);
    }
    if (!Array.isArray(ledger.unresolved_slots)) {
      reasons.push(`${dayStr}: tick_ledger.unresolved_slots invalid`);
    } else if (ledger.unresolved_slots.length > 0) {
      reasons.push(`${dayStr}: unresolved tick results: ${ledger.unresolved_slots.map((d) => `${d.slot}=${d.tick_result}`).join(', ')}`);
    }
  }
  // ---- B2 v4: structural green gate on per-run machine-readable fields ----------------------
  for (const r of runs) {
    const idt = r.upstream_identity ?? null;
    const isGreenish = r.status === 'green' || r.status === 'green_noop';
    if (!isGreenish) continue;
    if (!idt || idt.fresh !== true) {
      reasons.push(`${dayStr}: ${r.source_id}: green without fresh upstream identity`);
    }
    const dv = r.delta_verdict?.verdict ?? null;
    if (!dv || !['upstream-changed', 'unchanged', 'baseline-established'].includes(dv)) {
      reasons.push(`${dayStr}: ${r.source_id}: green without accepted delta verdict (${String(dv)})`);
    }
  }
  // ---- B4 v4: close-out must name a witnessing run inside the immutable window --------------
  const closeAfterMs = Date.parse(`${dayStr}T23:15:00Z`);
  const closeDeadlineMs = closeAfterMs + 2 * HOUR_MS + 45 * 60 * 1000;
  for (const r of runs) {
    const cc = r.close_condition;
    if (!cc || cc.satisfied_by_run_id == null) continue; // already reported by close-out check below
    if (typeof cc.satisfied_by_run_id !== 'string' || cc.satisfied_by_run_id.length === 0) {
      reasons.push(`${dayStr}: ${r.source_id}: close-out witness run id malformed (${String(cc.satisfied_by_run_id)})`);
    }
    const awaitedMs = Date.parse(cc.awaited_launch_after ?? '');
    if (awaitedMs !== closeAfterMs) {
      reasons.push(`${dayStr}: ${r.source_id}: close watermark must be D23:15Z`);
    }
    const satisfiedMs = Date.parse(cc.satisfied_at ?? '');
    if (Number.isNaN(satisfiedMs) || satisfiedMs <= closeAfterMs || satisfiedMs > closeDeadlineMs) {
      reasons.push(`${dayStr}: ${r.source_id}: close witness outside immutable window`);
    }
    if (cc.backfill_rejected) {
      reasons.push(`${dayStr}: ${r.source_id}: late backfill rejected — ${String(cc.backfill_rejected)}`);
    }
    if (cc.witness_source_id !== r.source_id) {
      reasons.push(`${dayStr}: ${r.source_id}: close witness is not source-bound`);
    }
    if (!/^[0-9a-f]{64}$/i.test(cc.witness_response_body_sha256 ?? '')) {
      reasons.push(`${dayStr}: ${r.source_id}: close witness lacks raw response digest`);
    }
    if (!/^[0-9a-f]{64}$/i.test(cc.witness_artifact_digest ?? '')) {
      reasons.push(`${dayStr}: ${r.source_id}: close witness lacks artifact digest`);
    }
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
  // Review case B: criticality on every entry must come from the canonical config manifest;
  // drifted or locally re-classified entries fail closed.
  for (const r of runs) {
    const declared = manifest.source_criticality?.[r.source_id];
    if (!declared) {
      reasons.push(`${dayStr}: ${r.source_id}: not present in canonical source_criticality policy`);
    } else if (r.criticality !== declared) {
      reasons.push(`${dayStr}: ${r.source_id}: criticality=${r.criticality}, canonical=${declared}`);
    }
  }
  return { ok: reasons.length === 0, snap, reasons };
}

const days = [];
for (let i = WINDOW_DAYS - 1; i >= 0; i -= 1) days.push(utcOffsetDays(refDay, -i));

const dayResults = days.map((d) => ({ day: d, ...evalDay(d) }));

// ---- B5 hash-chain continuity (oldest -> newest) ------------------------
const chainIssues = [];
{
  let prev = null;
  for (const dr of dayResults) {
    if (!dr.snap) continue;
    const curHash = dr.snap.snapshot_hash;
    const declaredPred = dr.snap.predecessor_snapshot_hash ?? null;
    if (prev === null) {
      // Genesis day of window: predecessor may legitimately be null or out-of-window.
      prev = curHash;
    } else {
      if (declaredPred == null) {
        chainIssues.push(`${dr.day}: predecessor_snapshot_hash absent but window continues`);
      } else if (declaredPred !== prev) {
        chainIssues.push(`${dr.day}: predecessor_snapshot_hash != previous snapshot_hash (forward chain break)`);
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

// A seven-day window needs seven independently observed upstream states. Replaying one dated
// identity is not a valid "unchanged" delta: it proves only that the same old payload was copied
// forward (B2/B5, forged-window case G).
const lineageIssues = [];
const identityOwners = new Map();
for (const { day, snap } of dayResults.filter((result) => result.snap)) {
  const dayStartMs = Date.parse(`${day}T00:00:00Z`);
  for (const entry of snap.runs ?? []) {
    if (!['green', 'green_noop'].includes(entry.status)) continue;
    const idt = entry.upstream_identity ?? {};
    const hasIdentity = [idt.content_hash, idt.version_id, idt.upstream_updated_at].some(
      (value) => value != null && String(value).length > 0,
    );
    if (!hasIdentity) continue;
    const identityKey = [
      entry.source_id,
      idt.content_hash ?? '',
      idt.version_id ?? '',
      idt.upstream_updated_at ?? '',
    ].join('|');
    const owner = identityOwners.get(identityKey);
    if (owner) {
      lineageIssues.push(
        `${day}: ${entry.source_id}: upstream identity reused from ${owner} (not an independent daily observation)`,
      );
    } else {
      identityOwners.set(identityKey, day);
    }
    const updatedMs = Date.parse(idt.upstream_updated_at ?? '');
    if (!Number.isNaN(updatedMs) && updatedMs < dayStartMs - 24 * HOUR_MS) {
      lineageIssues.push(
        `${day}: ${entry.source_id}: upstream identity is stale (${idt.upstream_updated_at})`,
      );
    }
  }
}

const daysOk = dayResults.every((d) => d.ok);
const ready = daysOk && chainIssues.length === 0 && recencyGaps.length === 0 && lineageIssues.length === 0;

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
if (lineageIssues.length > 0) {
  console.log('observation-lineage issues:');
  lineageIssues.forEach((g) => console.log(`  - ${g}`));
}
console.log(
  `VERDICT: ${ready ? 'READY' : 'NOT_READY'} ` +
    `(green_days=${dayResults.filter((d) => d.ok).length}/${WINDOW_DAYS}, ` +
    `chain_issues=${chainIssues.length}, recency_gaps=${recencyGaps.length}, ` +
    `lineage_issues=${lineageIssues.length})`,
);
process.exit(ready ? 0 : 1);
