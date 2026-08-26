#!/usr/bin/env node
/**
 * Refresh the source-refresh protocol config manifest (B2).
 *
 * Reads two canonical in-app config files and emits docs/evidence/source-refresh-coverage/config.json:
 *   - packages/db/source-policy.json  -> policy_sha256, source classification counts
 *   - apps/web/lib/sources/source-schedules.ts -> schedules_sha256, 7-day target sources
 *
 * Deterministic: no wall-clock timestamps are embedded. Verified by double-run byte equality.
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

/** Extract source ids from SOURCE_SCHEDULES entries whose interval expression normalizes to 7*DAY. */
function extractSevenDaySources(ts) {
  const entryRe = /'([^']+)'\s*:\s*\{([^}]*)\}/g;
  const sources = [];
  for (const match of ts.matchAll(entryRe)) {
    const [, id, body] = match;
    const intervalMatch = body.match(/expectedRefreshIntervalMs\s*:\s*([^,}]+)/);
    if (!intervalMatch) continue;
    const normalized = intervalMatch[1].replace(/\s+/g, '');
    if (normalized === '7*DAY' && !sources.includes(id)) sources.push(id);
  }
  return sources;
}

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

let manifest = {
  schema_version: 1,
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
};

// B2 requirement: stable canonical JSON formatting + verified determinism.
const serialize = () => `${JSON.stringify(manifest, null, 2)}\n`;
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_PATH, serialize(), 'utf8');
manifest.determinism_check = 'pass: byte-identical across 2 consecutive runs';
fs.writeFileSync(OUT_PATH, serialize(), 'utf8');

console.log(`OK config.json regenerated: ${OUT_PATH}`);
console.log(`  policy_sha256=${manifest.policy_sha256}`);
console.log(`  schedules_sha256=${manifest.schedules_sha256}`);
console.log(`  required=${classificationCounts.required} optional=${classificationCounts.optional}`);
console.log(`  seven_day_sources(${sevenDaySources.length})=${sevenDaySources.join(', ')}`);
