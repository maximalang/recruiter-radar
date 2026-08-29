/**
 * Authority boundary for source-refresh coverage evidence.
 *
 * A run summary is derived data. It becomes trustworthy only when its identity and
 * digest match a manifest and log files downloaded from the GitHub Actions artifact.
 * These helpers are intentionally synchronous so collector, builder, and checker
 * can apply the same fail-closed binding without a shared service.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { sha256Canonical } from './coverage-integrity.mjs';

export const AUTHORITY_MANIFEST_FILENAME = 'github-run-manifest.json';
const FULL_SHA = /^[0-9a-f]{40}$/i;
const DIGEST = /^[0-9a-f]{64}$/i;
const RUN_ID = /^\d+$/;

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function walkFiles(dir, prefix = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walkFiles(absolute, relative));
    else if (entry.isFile()) files.push({ absolute, relative });
  }
  return files;
}

/** Digest the downloaded log-artifact payload, excluding its metadata manifest. */
export function computeArtifactDigest(runDir) {
  const files = walkFiles(runDir)
    .filter(({ relative }) => path.basename(relative) !== AUTHORITY_MANIFEST_FILENAME)
    .map(({ absolute, relative }) => {
      const bytes = fs.readFileSync(absolute);
      return { path: relative, bytes: bytes.length, sha256: sha256Bytes(bytes) };
    });
  if (files.length === 0) return null;
  return sha256Canonical(files);
}

export function readAuthorityManifest(runDir, expectedRunId = null) {
  const manifestPath = path.join(runDir, AUTHORITY_MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`missing ${AUTHORITY_MANIFEST_FILENAME}`);
  }
  const raw = fs.readFileSync(manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    throw new Error(`invalid ${AUTHORITY_MANIFEST_FILENAME} JSON: ${error.message}`);
  }
  const problems = validateAuthorityManifest(manifest, expectedRunId);
  if (problems.length > 0) throw new Error(problems.join('; '));
  return {
    manifest,
    manifest_sha256: sha256Bytes(raw),
    manifest_path: manifestPath,
  };
}

export function validateAuthorityManifest(manifest, expectedRunId = null) {
  const problems = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['manifest must be an object'];
  }
  if (manifest.schema_version !== 1) problems.push(`manifest schema_version must be 1, got ${manifest.schema_version}`);
  if (typeof manifest.run_id !== 'string' || !RUN_ID.test(manifest.run_id)) problems.push('manifest run_id invalid');
  if (expectedRunId != null && manifest.run_id !== String(expectedRunId)) {
    problems.push(`manifest run_id ${manifest.run_id} != artifact directory ${expectedRunId}`);
  }
  if (!Number.isInteger(manifest.run_number) || manifest.run_number <= 0) problems.push('manifest run_number invalid');
  if (!Number.isInteger(manifest.run_attempt) || manifest.run_attempt <= 0) problems.push('manifest run_attempt invalid');
  if (typeof manifest.repository !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(manifest.repository)) {
    problems.push('manifest repository invalid');
  }
  if (manifest.workflow_name !== 'Source Refresh Clock') problems.push('manifest workflow_name invalid');
  if (manifest.event_name !== 'schedule') problems.push('manifest event_name must be schedule');
  if (typeof manifest.scheduled_at_tick !== 'string' || manifest.scheduled_at_tick.trim() === '') {
    problems.push('manifest scheduled_at_tick missing');
  }
  if (typeof manifest.head_sha !== 'string' || !FULL_SHA.test(manifest.head_sha)) problems.push('manifest head_sha invalid');
  if (typeof manifest.artifact_name !== 'string' || manifest.artifact_name !== `source-refresh-run-${manifest.run_id}-attempt-${manifest.run_attempt}`) {
    problems.push('manifest artifact_name is not bound to run_id/run_attempt');
  }
  return problems;
}

const SUMMARY_BINDINGS = [
  ['run_id', 'run_id'],
  ['run_number', 'run_number'],
  ['run_attempt', 'run_attempt'],
  ['repository', 'repository'],
  ['workflow_name', 'workflow_name'],
  ['event_name', 'event_name'],
  ['scheduled_at_tick', 'scheduled_at_tick'],
  ['git_sha', 'head_sha'],
];

/** Compare collector summary identity fields with the authoritative manifest. */
export function authorityBindingProblems(summary, authority) {
  const manifest = authority?.manifest ?? authority;
  const problems = [];
  for (const [summaryKey, manifestKey] of SUMMARY_BINDINGS) {
    if (String(summary?.[summaryKey] ?? '') !== String(manifest?.[manifestKey] ?? '')) {
      problems.push(`${summaryKey} does not match authoritative manifest`);
    }
  }
  if (summary?._meta?.authority_verified !== true) {
    problems.push('collector authority verification flag is not true');
  }
  const expectedArtifact = authority?.artifact_digest;
  const declaredArtifact = summary?._meta?.log_artifact_digest;
  if (!DIGEST.test(declaredArtifact ?? '')) problems.push('summary log_artifact_digest invalid');
  if (expectedArtifact == null || declaredArtifact !== expectedArtifact) {
    problems.push('summary log_artifact_digest does not match downloaded artifact bytes');
  }
  const declaredManifest = summary?._meta?.authority_manifest_sha256;
  if (!DIGEST.test(declaredManifest ?? '')) problems.push('summary authority_manifest_sha256 invalid');
  if (authority?.manifest_sha256 == null || declaredManifest !== authority.manifest_sha256) {
    problems.push('summary authority_manifest_sha256 does not match manifest bytes');
  }
  return problems;
}

/** Compare provenance parsed from the downloaded log with its GitHub manifest. */
export function provenanceBindingProblems(provenance, manifest) {
  const problems = [];
  const bindings = [
    ['run_id', 'run_id'],
    ['run_number', 'run_number'],
    ['attempt', 'run_attempt'],
    ['repository', 'repository'],
    ['workflow_name', 'workflow_name'],
    ['event_name', 'event_name'],
    ['scheduled_at', 'scheduled_at_tick'],
    ['git_sha', 'head_sha'],
  ];
  for (const [provenanceKey, manifestKey] of bindings) {
    const provenanceValue = String(provenance?.[provenanceKey] ?? '');
    const manifestValue = String(manifest?.[manifestKey] ?? '');
    const normalizedProvenance = provenanceKey === 'workflow_name' ? provenanceValue.replaceAll('_', ' ') : provenanceValue;
    if (normalizedProvenance !== manifestValue) {
      problems.push(`log provenance ${provenanceKey} does not match authoritative manifest`);
    }
  }
  return problems;
}

/** Verify a summary against the raw downloaded artifact directory. */
export function verifySummaryAgainstArtifact(summary, logsRoot) {
  if (!logsRoot) return { verified: false, problems: ['SOURCE_REFRESH_LOGS_DIR is required'] };
  const runId = String(summary?.run_id ?? '');
  if (!RUN_ID.test(runId)) return { verified: false, problems: ['summary run_id is not numeric'] };
  const runDir = path.join(logsRoot, runId);
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    return { verified: false, problems: ['downloaded artifact directory missing'] };
  }
  try {
    const authority = readAuthorityManifest(runDir, summary.run_id);
    authority.artifact_digest = computeArtifactDigest(runDir);
    if (!DIGEST.test(authority.artifact_digest ?? '')) {
      return { verified: false, problems: ['downloaded artifact digest missing'] };
    }
    const problems = authorityBindingProblems(summary, authority);
    return { verified: problems.length === 0, problems, authority };
  } catch (error) {
    return { verified: false, problems: [error.message] };
  }
}

export function workflowRunUrlParts(url) {
  const match = String(url ?? '').match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)(?:\/attempts\/(\d+))?(?:$|[?#])/);
  if (!match) return null;
  return { repository: match[1], run_id: match[2], run_attempt: match[3] == null ? null : Number(match[3]) };
}
