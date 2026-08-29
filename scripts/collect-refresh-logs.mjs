#!/usr/bin/env node
/**
 * Source Refresh Clock run-log collector v2 (protocol §4-§6, §8, §10; blockers B2, B3).
 *
 * Reads recursively-numbered GitHub Actions run log trees of the `Source Refresh Clock`
 * workflow, re-parses each run's HTTP response JSON (the route never prints per-source lines),
 * and emits one deterministic per-run summary file <REFRESH_RUNS_DIR>/<run_id>.json.
 *
 * v2 contract (fail closed):
 *   - EVERY scanned run produces a summary file: success payloads, HTTP 422 no-active-profiles
 *     no-ops (entry keyed `no-active-profiles`, tick_result=noop) and malformed/no-payload logs
 *     (`schema_errors[]` + exit non-zero afterwards in the builder) — silent skips would be
 *     indistinguishable from missed ticks (B3);
 *   - provenance lines (`source-refresh-provenance:` repository/run_id/run_number/attempt/
 *     scheduled_at/git_sha/http_status/body_sha256) are captured verbatim; body_sha256 ties the
 *     summary to the raw-response artifact uploaded by the workflow;
 *   - upstream content identity per row ({contentHash, versionId, upstreamUpdatedAt}) is carried
 *     verbatim into `upstream` when present, else null — zero contracts alone cannot green a day;
 *   - scheduler truth (due / next_eligible_run_at) is carried into `scheduler` when the route
 *     exposes it, so the builder can separate not-due from overdue-deferred (B1);
 *   - zero/refresh outcomes require the collector-level allowlist reason
 *     ('no-new-signals', 'derived-events-empty', 'source-unavailable'); arbitrary zeroReason
 *     values fail closed to red with error_code=zero-reason-not-in-policy (B2).
 *
 * Usage: REFRESH_RUNS_DIR=... SOURCE_REFRESH_LOGS_DIR=... CONFIG_MANIFEST=<config.json> \
 *        node scripts/collect-refresh-logs.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  computeArtifactDigest,
  provenanceBindingProblems,
  readAuthorityManifest,
} from './lib/coverage-authority.mjs';

const logsDir = process.env.SOURCE_REFRESH_LOGS_DIR ?? '';
const runsDir = process.env.REFRESH_RUNS_DIR ?? '';
const workflowName = process.env.SOURCE_REFRESH_WORKFLOW_NAME ?? 'Source Refresh Clock';
const manifestPath = process.env.CONFIG_MANIFEST ?? '';

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (!logsDir || !fs.existsSync(logsDir)) fail('SOURCE_REFRESH_LOGS_DIR must point to downloaded run log directories');
if (!runsDir) fail('REFRESH_RUNS_DIR must point to the output directory');
if (!manifestPath || !fs.existsSync(manifestPath)) {
  fail('CONFIG_MANIFEST must point to the regenerated config.json (zero contracts + bounds)');
}

/** Collector-side allowlist mirror of source-ingest.ts + scheduler zeroReason vocabulary. */
const POLICY_ZERO_REASONS = new Set(['no-new-signals', 'derived-events-empty', 'source-unavailable']);

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (!manifest.zero_contracts || typeof manifest.zero_contracts !== 'object') {
  fail('config manifest is missing zero_contracts (regenerate via generate-refresh-config-manifest.mjs)');
}

fs.mkdirSync(runsDir, { recursive: true });

function extractProvenance(text) {
  const out = {};
  // Scan every provenance LINE, then all key=value pairs on it. A single anchored
  // matchAll would capture only the first pair and silently drop run_id/status/sha.
  for (const lineMatch of text.matchAll(/^.*source-refresh-provenance:.*$/gm)) {
    for (const kv of lineMatch[0].matchAll(/(\w+)=([^\s]+)/g)) {
      out[kv[1]] = kv[2];
    }
  }
  return out;
}

/**
 * Parse one candidate JSON text. Returns `{kind:'details', details, startedAt}`,
 * `{kind:'envelope', error}`, or null when the payload is not a source-refresh HTTP body.
 */
function parsePayload(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (Array.isArray(parsed?.data?.details)) {
    return { kind: 'details', details: parsed.data.details, startedAt: parsed?.data?.startedAt ?? null };
  }
  if (typeof parsed?.data === 'object' && parsed.data !== null && !Array.isArray(parsed.data.details)) {
    throw new Error('data.details is missing or not an array');
  }
  if (typeof parsed?.error === 'string' && parsed?.success !== true) {
    // Structured failure envelope without details[] (e.g. 422 no_active_profiles).
    return { kind: 'envelope', error: parsed.error };
  }
  return null;
}

function classifySourceRow(row) {
  const outcome = row.outcome;
  const accepted = row.upsertedCount ?? row.diagnostics?.normalizedCount ?? 0;
  switch (outcome) {
    case 'ingested':
    case 'ingested-with-duplicates':
      return accepted > 0 ? { status: 'green' } : { status: 'red', errorCode: 'zero-upsert-success' };
    case 'idempotent-replay':
    case 'expected-zero': {
      const reason = row.diagnostics?.zeroReason ?? null;
      if (!reason || !POLICY_ZERO_REASONS.has(reason)) {
        return { status: 'red', errorCode: 'zero-reason-not-in-policy' };
      }
      return { status: 'green_noop_pending_identity' };
    }
    case 'deferred':
      return { status: 'deferred' };
    default:
      return { status: 'red', errorCode: 'outcome-not-in-policy' };
  }
}

/** Recursively walk a run-log directory collecting *.txt paths (GitHub artifacts nest per job/step). */
function walkLogFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkLogFiles(p));
    else if (entry.name.endsWith('.txt')) out.push(p);
  }
  return out.sort();
}

/**
 * Bind a collected summary to the exact downloaded GitHub artifact contents. The digest is
 * computed from relative paths, byte lengths, and SHA-256s, so a hand-made summary cannot
 * claim collector provenance without the durable log artifact itself (B5).
 */
function logArtifactDigest(runDir) {
  return computeArtifactDigest(runDir);
}

const seenBodyHashes = new Set();
const runDirs = fs.readdirSync(logsDir).filter((d) => fs.statSync(path.join(logsDir, d)).isDirectory());
let processed = 0;

for (const runId of runDirs) {
  const runPath = path.join(logsDir, runId);
  const outPath = path.join(runsDir, `${runId}.json`);
  if (fs.existsSync(outPath)) continue; // idempotent re-run of collector
  const txtFiles = walkLogFiles(runPath);
  const artifactDigest = logArtifactDigest(runPath);
  const provAccumulator = {};

  let found = null;
  let malformedMessage = null;

  for (const filePath of txtFiles) {
    const text = fs.readFileSync(filePath, 'utf8');
    Object.assign(provAccumulator, extractProvenance(text));
    if (provAccumulator.body_sha256) seenBodyHashes.add(provAccumulator.body_sha256);

    // Direct parse: pure-JSON steps (the body-echo step) parse wholesale.
    try {
      const hit = parsePayload(text);
      if (hit) {
        found = hit;
        break;
      }
    } catch (err) {
      if (!malformedMessage) malformedMessage = `${path.relative(logsDir, filePath)}: ${err.message}`;
    }

    // Embedded parse: mixed-step logs carrying the body inline.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (!found && start !== -1 && end > start) {
      try {
        const hit = parsePayload(text.slice(start, end + 1));
        if (hit) {
          found = hit;
          break;
        }
      } catch (err) {
        if (!malformedMessage) malformedMessage = `${path.relative(logsDir, filePath)}: ${err.message}`;
      }
    }
  }

  const prov = provAccumulator;
  let authorityManifest = null;
  let authorityManifestSha256 = null;
  let authorityErrors = [];
  try {
    const authority = readAuthorityManifest(runPath, runId);
    authorityManifest = authority.manifest;
    authorityManifestSha256 = authority.manifest_sha256;
    authorityErrors = provenanceBindingProblems(prov, authorityManifest);
  } catch (error) {
    authorityErrors = [error.message];
  }
  const httpStatus = intOrNull(prov.http_status);
  processed += 1;
  const stat = fs.statSync(path.join(logsDir, runId));

  let sources = {};
  let schemaErrors = [];
  let tickResult = 'unknown';

  if (!found) {
    // B3: unparseable clock log is a durable fail-closed schema_error entry, never a silent skip.
    schemaErrors = [
      malformedMessage ?? `no parseable source-refresh payload found in ${txtFiles.length} log file(s)`,
    ];
    tickResult = 'schema-error';
  } else if (found.kind === 'details') {
    for (const row of found.details) {
      if (!row || typeof row.source !== 'string' || !row.source) {
        schemaErrors.push('details row missing string source id');
        continue;
      }
      const classification = classifySourceRow(row);
      const schedulerRaw = row.scheduler ?? {};
      const hasScheduler =
        Boolean(schedulerRaw && typeof schedulerRaw === 'object') &&
        (schedulerRaw.next_eligible_run_at != null || schedulerRaw.due != null);
      const upstreamRaw = row.upstreamIdentity ?? null;
      const hasUpstream =
        Boolean(upstreamRaw && typeof upstreamRaw === 'object') &&
        ((upstreamRaw.contentHash ?? '') !== '' ||
          upstreamRaw.versionId != null ||
          upstreamRaw.upstreamUpdatedAt != null);
      const srcEntry = {
        outcome: row.outcome,
        success: row.success === true,
        records_fetched: row.fetchedCount ?? null,
        records_accepted: row.upsertedCount ?? row.diagnostics?.normalizedCount ?? 0,
        duplicate_records: row.diagnostics?.duplicateCount ?? null,
        error_code: classification.errorCode ?? row.error ?? row.diagnostics?.zeroReason ?? null,
        status: classification.status,
        scheduler: hasScheduler
          ? {
              due: schedulerRaw.due === true,
              ...(schedulerRaw.next_eligible_run_at != null
                ? { next_eligible_run_at: String(schedulerRaw.next_eligible_run_at) }
                : {}),
            }
          : null,
        upstream: hasUpstream
          ? {
              content_hash: String(upstreamRaw.contentHash ?? ''),
              version_id: upstreamRaw.versionId == null ? null : String(upstreamRaw.versionId),
              upstream_updated_at:
                upstreamRaw.upstreamUpdatedAt == null ? null : String(upstreamRaw.upstreamUpdatedAt),
            }
          : null,
      };
      if (srcEntry.status === 'green_noop_pending_identity' && !hasUpstream) {
        srcEntry.status = 'red';
        srcEntry.error_code = 'zero-without-upstream-identity';
      } else if (srcEntry.status === 'green_noop_pending_identity') {
        srcEntry.status = 'green_noop';
      }
      sources[row.source] = srcEntry;
    }
    tickResult = 'ok';
  } else {
    // Envelope without details[]: legitimate only as 422 no-active-profiles.
    if (httpStatus === 422) {
      sources['no-active-profiles'] = {
        outcome: 'no-active-profiles',
        success: false,
        records_fetched: null,
        records_accepted: 0,
        duplicate_records: null,
        error_code: 'no-active-profiles',
        status: 'no-op',
        scheduler: null,
        upstream: null,
      };
      tickResult = 'noop';
    } else {
      schemaErrors = [`failure envelope without details[] under HTTP ${httpStatus ?? 'unknown'}: ${found.error}`];
      tickResult = 'schema-error';
    }
  }

  let startedAtMs = Number.NaN;
  const rawStarted = found?.startedAt ?? null;
  if (rawStarted != null) startedAtMs = Date.parse(rawStarted);
  const startedAtIso = !Number.isNaN(startedAtMs)
    ? new Date(startedAtMs).toISOString()
    : new Date(stat.mtimeMs).toISOString();

  fs.writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        schema_version: 2,
        run_id: runId,
        workflow_name: authorityManifest?.workflow_name ?? prov.workflow_name ?? workflowName,
        repository: authorityManifest?.repository ?? prov.repository ?? null,
        run_number: authorityManifest?.run_number ?? intOrNull(prov.run_number),
        run_attempt: authorityManifest?.run_attempt ?? intOrNull(prov.attempt),
        scheduled_at_tick: authorityManifest?.scheduled_at_tick ?? prov.scheduled_at ?? null,
        event_name: authorityManifest?.event_name ?? prov.event_name ?? null,
        git_sha: authorityManifest?.head_sha ?? prov.git_sha ?? null,
        http_status: httpStatus,
        response_body_sha256: prov.body_sha256 ?? null,
        run_started_at: startedAtIso,
        tick_result: tickResult,
        sources,
        ...(schemaErrors.length > 0 ? { schema_errors: schemaErrors } : {}),
        _meta: {
          derived_from_log_dir: runId,
          log_artifact_digest: artifactDigest,
          authority_manifest_sha256: authorityManifestSha256,
          authority_verified: authorityManifest != null && authorityErrors.length === 0,
          ...(authorityErrors.length > 0 ? { authority_errors: authorityErrors } : {}),
          processed_at: new Date().toISOString(),
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

console.log(`OK collected ${processed} new run summaries into ${runsDir} (${runDirs.length} dirs scanned)`);
console.log(`OK distinct response-body hashes observed: ${seenBodyHashes.size}`);

if (processed === 0 && runDirs.length === 0) {
  fail(`no run directories found under ${logsDir}`);
}

function intOrNull(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}
