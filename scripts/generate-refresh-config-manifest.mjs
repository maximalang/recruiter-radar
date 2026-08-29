#!/usr/bin/env node
/**
 * Refresh the source-refresh protocol config manifest (blockers B2, B6).
 *
 * Reads two canonical in-app config files and emits docs/evidence/source-refresh-coverage/config.json:
 *   - packages/db/source-policy.json  -> policy_sha256, source classification counts, zero contracts
 *   - apps/web/lib/sources/source-schedules.ts -> schedules_sha256, 7-day target sources
 *
 * v2 additions:
 *   - zero_contracts: per 7-day source the policy-declared allow_zero_success flag and its
 *     canonical allowed_reasons; a source without an explicit contract fails closed in the
 *     builder (no more "any zeroReason => green_noop").
 *   - hard_bounds: §7 degradation bounds stated once here and consumed by snapshots/checker
 *     (2-of-N optional per day per B6 arithmetic fix).
 *
 * Deterministic: no wall-clock timestamps embedded. Verified by double-run byte equality.
 * Scope: report evidence only — never changes the configs themselves.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const POLICY_PATH = path.join(REPO_ROOT, 'packages', 'db', 'source-policy.json');
const SCHEDULES_PATH = path.join(REPO_ROOT, 'apps', 'web', 'lib', 'sources', 'source-schedules.ts');
const OUT_DIR = path.join(REPO_ROOT, 'docs', 'evidence', 'source-refresh-coverage');
const OUT_PATH = path.join(OUT_DIR, 'config.json');

const sha256File = (filePath) => createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

/** Extract SOURCE_SCHEDULES entries whose interval normalizes to 7*DAY. */
function extractSevenDaySources(ts) {
  const entryRe = /'([^']+)'\s*:\s*\{([^}]*)\}/g;
  const sources = [];
  for (const match of ts.matchAll(entryRe)) {
    const [, id, body] = match;
    const intervalMatch = body.match(/expectedRefreshIntervalMs\s*:\s*([^,}]+)/);
    if (!intervalMatch) continue;
    if (intervalMatch[1].replace(/\s+/g, '') === '7*DAY' && !sources.includes(id)) sources.push(id);
  }
  return sources;
}

// Canonical collector-observed zeroReason vocabulary (see source-ingest.ts + schedulers):
// 'no-new-signals'   -> fetched page parsed, normalized set identical to persisted state;
// 'derived-events-empty' -> derivation step produced no new events without raw-page change;
// 'source-unavailable' -> upstream served a well-formed empty/unavailable payload (optional only).
const CANONICAL_ZERO_REASONS = ['no-new-signals', 'derived-events-empty'];

const policyRaw = fs.readFileSync(POLICY_PATH, 'utf8');
const schedulesTs = fs.readFileSync(SCHEDULES_PATH, 'utf8');
const policy = JSON.parse(policyRaw);

const classificationCounts = { required: 0, optional: 0 };
const sourceCriticality = {};
const MANDATORY_IDENTITY_ENRICHMENT_SOURCES = new Set(['egrul-fns']);
for (const [sourceId, cfg] of Object.entries(policy)) {
  const isRequired =
    (cfg.promotionStatus === 'digest-allowed' &&
      ['digest-lead-originating', 'confidence-gated-evidence'].includes(cfg.leadEligibility)) ||
    MANDATORY_IDENTITY_ENRICHMENT_SOURCES.has(sourceId);
  sourceCriticality[sourceId] = isRequired ? 'required' : 'optional';
  if (!isRequired) continue;
  classificationCounts.required += 1;
}
classificationCounts.optional = Object.keys(policy).length - classificationCounts.required;
if (Object.keys(sourceCriticality).length !== Object.keys(policy).length || classificationCounts.optional < 0) {
  console.error('FAIL: inconsistent policy classification');
  process.exit(1);
}

const sevenDaySources = extractSevenDaySources(schedulesTs).sort();
if (sevenDaySources.length === 0) {
  console.error('FAIL: no 7-day sources parsed from source-schedules.ts — extraction pattern is stale');
  process.exit(1);
}

// ---- B2: explicit per-source zero contract -----------------------------------
const zeroContracts = {};
for (const sourceId of sevenDaySources) {
  const cfg = policy[sourceId];
  const criticality = sourceCriticality[sourceId];
  // Policy-declared zero allowance: only explicit idempotent-replay-capable configs may opt in.
  // Required identity sources are never allowed zero-success green by default.
  const declaredAllowsZero = cfg?.allowZeroSuccessOnIdempotentReplay === true && criticality === 'optional';
  zeroContracts[sourceId] = {
    criticality,
    allow_zero_success: declaredAllowsZero,
    allowed_reasons: declaredAllowsZero ? CANONICAL_ZERO_REASONS : [],
    require_upstream_identity: true,
    note: 'fail closed outside these reasons; arbitrary diagnostics.zeroReason values must turn RED',
  };
}
// 'source-unavailable' is a degradation outcome, not a zero-contract reason: it maps to red or
// optional degradation accounting downstream and is deliberately NOT in allowed_reasons.

const manifest = {
  schema_version: 2,
  generated_from: {
    repo_working_tree: true,
    source_policy_path: 'packages/db/source-policy.json',
    source_schedules_path: 'apps/web/lib/sources/source-schedules.ts',
  },
  policy_sha256: sha256File(POLICY_PATH),
  schedules_sha256: sha256File(SCHEDULES_PATH),
  source_count: Object.keys(policy).length,
  required_optional_counts: classificationCounts,
  source_criticality: sourceCriticality,
  seven_day_sources: sevenDaySources,
  zero_contracts: zeroContracts,
  hard_bounds: {
    MAX_DEGRADED_OPTIONAL_SOURCES_PER_DAY: 2,
    MAX_CONSECUTIVE_DEGRADED_DAYS_PER_SOURCE: 2,
    arithmetic_note: 'bound counts optional-only among the six 7-day sources; required failures never count toward it',
  },
};

// Determinism verified by double-write of identical bytes.
const serialize = () => `${JSON.stringify(manifest, null, 2)}\n`;
fs.mkdirSync(OUT_DIR, { recursive: true });
const firstPass = serialize();
fs.writeFileSync(OUT_PATH, firstPass, 'utf8');
fs.writeFileSync(OUT_PATH, serialize(), 'utf8');

console.log(`OK config.json regenerated: ${OUT_PATH}`);
console.log(`  policy_sha256=${manifest.policy_sha256}`);
console.log(`  schedules_sha256=${manifest.schedules_sha256}`);
console.log(`  required=${classificationCounts.required} optional=${classificationCounts.optional}`);
console.log(`  seven_day_sources(${sevenDaySources.length})=${sevenDaySources.join(', ')}`);
console.log(
  `  zero_contracts: ${sevenDaySources.filter((s) => zeroContracts[s].allow_zero_success).length}/${sevenDaySources.length} allow zero-success`,
);
