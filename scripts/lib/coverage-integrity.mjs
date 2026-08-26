/**
 * Shared integrity helpers for the source-refresh coverage toolchain.
 * Import with a RELATIVE specifier from both scripts/build-coverage-snapshot.mjs
 * and scripts/check-coverage-window.mjs (plain node --experimental-default-type=module
 * compatible; package.json has no exports map for /scripts).
 */
import { createHash } from 'node:crypto';

/** Deterministic, key-order-independent JSON serialization used for all content hashes. */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256Canonical(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function utcOffsetDays(dayStr, delta) {
  const d = new Date(`${dayStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function parseUtcDay(dayStr) {
  return Date.parse(`${dayStr}T00:00:00Z`);
}

/** Full-hour UTC tick bucket of an ISO timestamp, e.g. '2026-08-21T00:45:12Z' -> 0. */
export function tickHourOf(iso) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).getUTCHours();
}

/** Recompute snapshot_hash from a parsed snapshot object (ignores the hash field itself). */
export function recomputeSnapshotHash(snapshot) {
  const { snapshot_hash, ...core } = snapshot;
  if (snapshot_hash === undefined) return sha256Canonical(snapshot);
  return sha256Canonical(core);
}

/** Every field a run summary must carry for builder/checker to trust it (blocker B5). */
export function validateRunSummaryV2(parsed) {
  const problems = [];
  if (!parsed || typeof parsed !== 'object') problems.push('not an object');
  if (parsed?.schema_version !== 2) problems.push(`schema_version must be 2, got ${parsed?.schema_version}`);
  if (typeof parsed?.run_id !== 'string' || !parsed.run_id) problems.push('run_id missing');
  if (typeof parsed?.repository !== 'string' || !parsed.repository.includes('/')) problems.push('repository missing');
  if (!/^([0-9a-f]{40})$/i.test(parsed?.git_sha ?? '')) problems.push('git_sha must be a full 40-hex SHA');
  if (!Number.isInteger(parsed?.run_number) || parsed.run_number <= 0) problems.push('run_number missing');
  if (!Number.isInteger(parsed?.run_attempt) || parsed.run_attempt <= 0) problems.push('run_attempt missing');
  if (!/^([0-9a-f]{64})$/i.test(parsed?.response_body_sha256 ?? '')) problems.push('response_body_sha256 must be 64-hex');
  if (typeof parsed?.workflow_name !== 'string' || parsed.workflow_name.length === 0) problems.push('workflow_name missing');
  if (Number.isNaN(Date.parse(parsed?.run_started_at ?? ''))) problems.push('run_started_at unparseable');
  if (!parsed?.sources || typeof parsed.sources !== 'object' || Array.isArray(parsed.sources)) problems.push('sources missing');
  if ((parsed?.schema_errors ?? []).length > 0) problems.push(`schema_errors present: ${(parsed.schema_errors ?? []).join('; ')}`);
  return problems;
}
