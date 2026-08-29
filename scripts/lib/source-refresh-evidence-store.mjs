#!/usr/bin/env node
/**
 * Persistence layer for daily Source Refresh Clock evidence capture (task t_e64a6b6e).
 *
 * Responsibilities (protocol v2 §9/§16 instrumentation):
 *   - persistSnapshot: idempotent by evidence_day_utc. Re-capture with the SAME
 *     snapshot_hash is a no-op; a DIFFERENT hash for an already-captured day is tampered
 *     evidence and throws (append-only). Unpublished pending drafts may be superseded by
 *     their published counterpart (same hash) — the draft row is upgraded in place.
 *   - persistLogArchiveIndex: idempotent by run_id; re-encounter with a different
 *     artifact digest or manifest hash fails closed.
 *   - deriveAlerts: alerts are DERIVED by application code from the snapshot object,
 *     never trusted from input. Persisted idempotently by
 *     (alert_type, evidence_day_utc, dedupe_key); re-encounter refreshes last_seen_at.
 *   - verifySnapshotIntegrity: recompute snapshot_hash and follow predecessor hash chain
 *     links inside DB; any mismatch throws (tamper detection).
 *   - resolveAlert: explicit close of an alert with a reason (auditable).
 *
 * Every query goes through an injected `client` with the pg contract
 * (query(text, params) -> { rows }); the DB roundtrip verifier supplies a real pg Client.
 * No environment reading, no process exits, no logging of evidence payloads.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const LATE_SNAPSHOT_AFTER_MS = 10 * 60 * 60 * 1000; // 10:00 UTC deadline grace
export const REDAY_SUPPRESS_WINDOW_MS = 4 * 60 * 60 * 1000; // re-open quiet window

function assertDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`evidence_day_utc must be YYYY-MM-DD, got ${JSON.stringify(value)}`);
  }
}

function fail(message) {
  throw new Error(`source-refresh-evidence: ${message}`);
}

/**
 * Derive alerts from one snapshot object (pure, no I/O). The builder emits
 * red_day_reasons[] as the single source of truth for a RED_DAY; tick ledger defects
 * and tamper/chain verdicts come from the machine-readable ledger fields and the
 * re-computed hash comparison done by the caller.
 */
export function deriveAlerts(snapshot, context = {}) {
  const { tampered = false, chainBroken = false, chainProblem = null, provenanceProblems = [] } = context;
  const alerts = [];
  if (!snapshot || typeof snapshot !== 'object') fail('snapshot must be an object');
  assertDay(snapshot.evidence_day_utc);

  const provenanceStatus = snapshot.trusted_provenance?.status ?? 'unverified';
  if (provenanceStatus !== 'verified') {
    alerts.push({
      alert_type: 'provenance_unverified',
      evidence_day_utc: snapshot.evidence_day_utc,
      severity: 'critical',
      dedupe_key: provenanceProblems.length > 0 ? provenanceProblems.join('|').slice(0, 200) : 'authority-unverified',
      payload: {
        reason: 'snapshot provenance is not verified against downloaded artifacts',
        problems: provenanceProblems,
      },
    });
  }

  if (tampered) {
    alerts.push({
      alert_type: 'tamper_detected',
      evidence_day_utc: snapshot.evidence_day_utc,
      severity: 'critical',
      dedupe_key: snapshot.snapshot_hash ?? 'unknown',
      payload: {
        reason: 'snapshot_hash re-computation does not match stored hash',
        stored_hash: snapshot.snapshot_hash ?? null,
      },
    });
  }
  if (chainBroken) {
    alerts.push({
      alert_type: 'hash_chain_broken',
      evidence_day_utc: snapshot.evidence_day_utc,
      severity: 'critical',
      dedupe_key: chainProblem ?? 'predecessor-hash-mismatch',
      payload: { reason: chainProblem ?? 'predecessor_snapshot_hash mismatch' },
    });
  }

  const isRed = snapshot.red_day_reasons?.length > 0 || snapshot.day_status === 'RED_DAY';
  if (isRed) {
    for (const reason of snapshot.red_day_reasons ?? ['day_status=RED_DAY without reasons']) {
      alerts.push({
        alert_type: 'red_day',
        evidence_day_utc: snapshot.evidence_day_utc,
        severity: 'critical',
        dedupe_key: String(reason),
        payload: { reason },
      });
    }
  }

  const ledger = snapshot.tick_ledger ?? {};
  const missing = ledger.missing_slots_utc ?? [];
  if (missing.length > 0) {
    alerts.push({
      alert_type: 'tick_ledger_defect',
      evidence_day_utc: snapshot.evidence_day_utc,
      severity: missing.length > 3 ? 'critical' : 'warning',
      dedupe_key: `missing_slots:${missing.length}:${missing[0]}`,
      payload: { kind: 'missing_slots', count: missing.length, first: missing[0], slots: missing },
    });
  }
  const duplicates = ledger.duplicate_slots ?? [];
  for (const d of duplicates) {
    alerts.push({
      alert_type: 'tick_ledger_defect',
      evidence_day_utc: snapshot.evidence_day_utc,
      severity: 'warning',
      dedupe_key: `duplicate_slot:${d.slot}`,
      payload: { kind: 'duplicate_slot', ...d },
    });
  }
  const unresolved = ledger.unresolved_slots ?? [];
  for (const u of unresolved) {
    alerts.push({
      alert_type: 'tick_ledger_defect',
      evidence_day_utc: snapshot.evidence_day_utc,
      severity: 'warning',
      dedupe_key: `unresolved_slot:${u.slot}:${u.run_id}`,
      payload: { kind: 'unresolved_slot', ...u },
    });
  }
  return alerts;
}

/** Alert for a day that has no published snapshot at check time (pure). */
export function deriveMissingSnapshotAlert(day, context = {}) {
  assertDay(day);
  const nowMs = context.nowMs ?? Date.now();
  const dayEndMs = Date.parse(`${day}T00:00:00Z`) + DAY_MS;
  const isLate = nowMs - dayEndMs > LATE_SNAPSHOT_AFTER_MS;
  return {
    alert_type: isLate ? 'late_snapshot' : 'missing_snapshot',
    evidence_day_utc: day,
    severity: 'critical',
    dedupe_key: isLate ? 'late' : 'missing',
    payload: {
      reason: isLate
        ? `day ${day} has no published snapshot more than ${LATE_SNAPSHOT_AFTER_MS / 3600000}h after day end`
        : `day ${day} has no published snapshot yet`,
      checked_at: new Date(nowMs).toISOString(),
    },
  };
}

/** Column list mirroring the migration's snapshot table. */
export function snapshotRowFromSnapshot(snapshot, meta = {}) {
  const day = snapshot.evidence_day_utc;
  assertDay(day);
  if (typeof snapshot.snapshot_hash !== 'string' || !/^[0-9a-f]{64}$/.test(snapshot.snapshot_hash)) {
    fail('snapshot_hash missing or not 64-hex');
  }
  const producer = snapshot.producer ?? {};
  if (!/^[0-9a-f]{40}$/.test(producer.repo_sha ?? '')) fail('producer.repo_sha must be full 40-hex');
  const runUrl = producer.workflow_run_url ?? '';
  if (!/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/actions\/runs\/\d+/.test(runUrl)) {
    fail('producer.workflow_run_url must be a github Actions run URL');
  }
  // published/interim is determined by the builder's OUTPUT FILE: <day>.json is the
  // immutable published snapshot; <day>.pending.json is a PENDING_CLOSE draft that a
  // later capture may supersede.
  const snapshotFile = meta.snapshot_file ?? `${day}.json`;
  const published = snapshotFile === `${day}.json`;
  const pending = snapshotFile === `${day}.pending.json`;
  if (!published && !pending) {
    fail(`snapshot_file must be exactly ${day}.json or ${day}.pending.json`);
  }
  if (published && snapshot.day_status === 'PENDING_CLOSE') {
    fail('PENDING_CLOSE snapshots must use the unpublished .pending.json file');
  }
  if (pending && snapshot.day_status !== 'PENDING_CLOSE') {
    fail('only PENDING_CLOSE snapshots may use the unpublished .pending.json file');
  }
  return [
    day,
    2,
    snapshot.window_id ?? null,
    snapshot.day_status,
    snapshot.snapshot_hash,
    snapshot.predecessor_snapshot_hash ?? null,
    producer.repo_sha,
    runUrl,
    producer.repository ?? '',
    (snapshot.run_attestations ?? []).length,
    JSON.stringify(snapshot.red_day_reasons ?? []),
    snapshot.close_condition_satisfied_by_all_sources === true,
    JSON.stringify(snapshot.tick_ledger ?? {}),
    JSON.stringify(snapshot.runs ?? []),
    JSON.stringify(snapshot.degradation_events ?? []),
    snapshot.trusted_provenance?.status === 'verified' ? 'verified' : 'unverified',
    JSON.stringify(meta.provenance_problems ?? []),
    published,
    snapshotFile,
    JSON.stringify(snapshot),
    meta.captured_by_run_url ?? null,
  ];
}

const UPSERT_SNAPSHOT_SQL = `
INSERT INTO source_refresh_evidence_snapshots (
  evidence_day_utc, schema_version, window_id, day_status, snapshot_hash,
  predecessor_snapshot_hash, producer_repo_sha, producer_workflow_run_url,
  producer_repository, run_attestation_count, red_day_reasons, close_condition_satisfied_by_all_sources,
  tick_ledger, runs, degradation_events, provenance_status, provenance_problems,
  snapshot_published, snapshot_file, snapshot, captured_by_run_url
) VALUES (
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17::jsonb,$18,$19,$20::jsonb,$21
)
ON CONFLICT (evidence_day_utc) DO UPDATE SET
  day_status = EXCLUDED.day_status,
  snapshot_hash = EXCLUDED.snapshot_hash,
  predecessor_snapshot_hash = EXCLUDED.predecessor_snapshot_hash,
  run_attestation_count = EXCLUDED.run_attestation_count,
  red_day_reasons = EXCLUDED.red_day_reasons,
  close_condition_satisfied_by_all_sources = EXCLUDED.close_condition_satisfied_by_all_sources,
  tick_ledger = EXCLUDED.tick_ledger,
  runs = EXCLUDED.runs,
  degradation_events = EXCLUDED.degradation_events,
  provenance_status = EXCLUDED.provenance_status,
  provenance_problems = EXCLUDED.provenance_problems,
  snapshot_published = EXCLUDED.snapshot_published,
  snapshot_file = EXCLUDED.snapshot_file,
  snapshot = EXCLUDED.snapshot,
  captured_at = NOW(),
  captured_by_run_url = EXCLUDED.captured_by_run_url
WHERE source_refresh_evidence_snapshots.snapshot_published = FALSE
  AND EXCLUDED.snapshot_published = TRUE
RETURNING (xmax = 0) AS inserted, evidence_day_utc, snapshot_hash, snapshot_published;
`;

/**
 * Idempotently persist one snapshot object. Returns
 * { status: 'inserted' | 'unchanged' | 'upgraded', day, snapshot_hash }.
 * A PENDING_CLOSE draft (published=FALSE) is interim evidence: only the later published
 * capture for the same day may replace it. A pending replay is a no-op, and every other
 * divergent hash fails closed. A PUBLISHED day is immutable.
 */
export async function persistSnapshot(client, snapshot, meta = {}) {
  const row = snapshotRowFromSnapshot(snapshot, meta);
  const { rows } = await client.query(UPSERT_SNAPSHOT_SQL, row);
  if (rows.length > 0) {
    const result = rows[0];
    return {
      status: result.inserted === true ? 'inserted' : 'upgraded',
      day: result.evidence_day_utc,
      snapshot_hash: result.snapshot_hash,
      published: result.snapshot_published === true,
    };
  }

  // No RETURNING row means either a published day, a pending replay, or a rejected
  // divergent draft. Read the locked conflict winner before deciding which; this also
  // makes a concurrent capture deterministic without trusting a caller-side pre-read.
  const existing = await client.query(
    `SELECT snapshot_hash, snapshot_published FROM source_refresh_evidence_snapshots
     WHERE evidence_day_utc = $1`,
    [row[0]],
  );
  if (existing.rows.length !== 1) {
    fail(`day ${row[0]} upsert skipped but no single existing row found (inconsistent store)`);
  }
  const stored = existing.rows[0];
  if (stored.snapshot_hash !== row[4]) {
    fail(`append-only violation: day ${row[0]} already has a different snapshot_hash (tampered or stale capture)`);
  }
  return {
    status: 'unchanged',
    day: row[0],
    snapshot_hash: row[4],
    published: stored.snapshot_published === true,
  };
}

const UPSERT_ARCHIVE_SQL = `
INSERT INTO source_refresh_evidence_log_archive (
  run_id, run_number, run_attempt, repository, workflow_name, event_name,
  scheduled_at_tick, head_sha, artifact_name, authority_manifest_sha256,
  log_artifact_digest, log_bytes, storage_key, summary_sha256, archived_by_run_url
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
ON CONFLICT (run_id) DO NOTHING
RETURNING run_id;
`;

/**
 * Idempotently persist the raw-artifact index for one run. The unique insert is first,
 * so a concurrent writer cannot turn a digest conflict into a silent no-op. If another
 * writer won, compare its immutable identity before calling the record unchanged.
 */
export async function persistLogArchiveIndex(client, entry) {
  for (const field of ['run_id', 'repository', 'workflow_name', 'event_name', 'scheduled_at_tick', 'artifact_name', 'storage_key']) {
    if (typeof entry?.[field] !== 'string' || entry[field].length === 0) fail(`${field} must be a non-empty string`);
  }
  for (const field of ['authority_manifest_sha256', 'log_artifact_digest', 'summary_sha256']) {
    if (!/^[0-9a-f]{64}$/.test(entry?.[field] ?? '')) fail(`${field} must be 64-hex`);
  }
  if (!/^[0-9a-f]{40}$/.test(entry?.head_sha ?? '')) fail('head_sha must be full 40-hex');
  if (!Number.isInteger(entry?.run_number) || entry.run_number <= 0) fail('run_number invalid');
  if (!Number.isInteger(entry?.run_attempt) || entry.run_attempt <= 0) fail('run_attempt invalid');
  if (!Number.isInteger(entry?.log_bytes) || entry.log_bytes < 0) fail('log_bytes invalid');

  const { rows } = await client.query(UPSERT_ARCHIVE_SQL, [
    entry.run_id,
    entry.run_number,
    entry.run_attempt,
    entry.repository,
    entry.workflow_name,
    entry.event_name,
    entry.scheduled_at_tick,
    entry.head_sha,
    entry.artifact_name,
    entry.authority_manifest_sha256,
    entry.log_artifact_digest,
    entry.log_bytes,
    entry.storage_key,
    entry.summary_sha256,
    entry.archived_by_run_url ?? null,
  ]);
  if (rows.length > 0) return { status: 'inserted', run_id: entry.run_id };

  const existing = await client.query(
    `SELECT authority_manifest_sha256, log_artifact_digest, summary_sha256
     FROM source_refresh_evidence_log_archive WHERE run_id = $1`,
    [entry.run_id],
  );
  if (existing.rows.length !== 1) {
    fail(`run ${entry.run_id} conflict had no single existing archive row (inconsistent store)`);
  }
  const prev = existing.rows[0];
  const diverged =
    prev.authority_manifest_sha256 !== entry.authority_manifest_sha256 ||
    prev.log_artifact_digest !== entry.log_artifact_digest ||
    prev.summary_sha256 !== entry.summary_sha256;
  if (diverged) fail(`run ${entry.run_id} already archived with different digests (fail closed)`);
  return { status: 'unchanged', run_id: entry.run_id };
}

const UPSERT_ALERT_SQL = `
INSERT INTO source_refresh_evidence_alerts (
  alert_uid, alert_type, evidence_day_utc, severity, status, dedupe_key, payload,
  first_seen_at, last_seen_at, updated_at
) VALUES (
  $1, $2, $3, $4, 'open', $5, $6::jsonb, NOW(), NOW(), NOW()
)
ON CONFLICT (alert_type, evidence_day_utc, dedupe_key) DO UPDATE SET
  last_seen_at = NOW(),
  updated_at = NOW(),
  status = CASE
    WHEN source_refresh_evidence_alerts.status = 'resolved'
         AND source_refresh_evidence_alerts.resolved_at > NOW() - interval '4 hours'
    THEN 'resolved'
    ELSE 'open'
  END,
  resolved_at = CASE
    WHEN source_refresh_evidence_alerts.status = 'resolved'
         AND source_refresh_evidence_alerts.resolved_at > NOW() - interval '4 hours'
    THEN source_refresh_evidence_alerts.resolved_at
    ELSE NULL
  END,
  resolution_reason = CASE
    WHEN source_refresh_evidence_alerts.status = 'resolved'
         AND source_refresh_evidence_alerts.resolved_at > NOW() - interval '4 hours'
    THEN source_refresh_evidence_alerts.resolution_reason
    ELSE NULL
  END
RETURNING (xmax = 0) AS inserted, alert_uid;
`;

function alertUid(alert) {
  return `${alert.alert_type}:${alert.evidence_day_utc}:${alert.dedupe_key}`;
}

/** Persist derived alerts idempotently. Returns per-alert statuses. */
export async function persistAlerts(client, alerts) {
  const out = [];
  for (const alert of alerts) {
    if (!alert.alert_type || !alert.severity || !alert.dedupe_key) fail('alert missing type/severity/dedupe_key');
    assertDay(alert.evidence_day_utc);
    const { rows } = await client.query(UPSERT_ALERT_SQL, [
      alertUid(alert),
      alert.alert_type,
      alert.evidence_day_utc,
      alert.severity,
      alert.dedupe_key,
      JSON.stringify(alert.payload ?? {}),
    ]);
    out.push({
      alert_uid: alertUid(alert),
      status: rows[0]?.inserted === true ? 'inserted' : 'refreshed',
    });
  }
  return out;
}

/**
 * When a previously-missing day arrives in the store, explicitly resolve that day's
 * open missing/late snapshot alerts — with the day recorded in the resolution reason.
 * Alerts stay auditable (resolved + reason), and a day never looks missing after its
 * snapshot has durably landed.
 */
export async function resolveAlertsForRecoveredDay(client, day) {
  assertDay(day);
  const { rowCount } = await client.query(
    `UPDATE source_refresh_evidence_alerts
     SET status = 'resolved', resolved_at = NOW(), updated_at = NOW(),
         resolution_reason = 'recovered: published snapshot captured for ' || $2
     WHERE evidence_day_utc = $1
       AND status = 'open'
       AND alert_type IN ('missing_snapshot', 'late_snapshot')`,
    [day, day],
  );
  return { resolved: rowCount };
}

/**
 * Recompute-and-compare integrity verification of a stored snapshot plus its chain link.
 * Uses the same canonical hashing as the builder toolchain (scripts/lib/coverage-integrity.mjs).
 */
export async function verifySnapshotIntegrity(client, day, hashFn, recomputedFromObjFn) {
  assertDay(day);
  const { rows } = await client.query(
    `SELECT snapshot, snapshot_hash, predecessor_snapshot_hash, day_status
     FROM source_refresh_evidence_snapshots WHERE evidence_day_utc = $1`,
    [day],
  );
  if (rows.length === 0) return { present: false };
  const row = rows[0];
  const recomputed = recomputedFromObjFn(row.snapshot);
  const tampered = recomputed !== row.snapshot_hash;
  let chainBroken = false;
  let chainProblem = null;
  if (!tampered && row.predecessor_snapshot_hash != null) {
    const prevDay = utcOffsetDaysStr(day, -1);
    const prev = await client.query(
      `SELECT snapshot_hash FROM source_refresh_evidence_snapshots WHERE evidence_day_utc = $1`,
      [prevDay],
    );
    if (prev.rows.length === 0) {
      chainBroken = true;
      chainProblem = `predecessor day ${prevDay} missing from evidence store`;
    } else if (prev.rows[0].snapshot_hash !== row.predecessor_snapshot_hash) {
      chainBroken = true;
      chainProblem = `predecessor_snapshot_hash does not match stored hash of ${prevDay}`;
    }
  }
  return {
    present: true,
    day,
    day_status: row.day_status,
    tampered,
    chainBroken,
    chainProblem,
    recomputed_hash: recomputed,
    stored_hash: row.snapshot_hash,
  };
}

function utcOffsetDaysStr(dayStr, delta) {
  const d = new Date(`${dayStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Explicit alert resolution with a reason (audit trail). */
export async function resolveAlert(client, alertUidValue, reason) {
  if (typeof alertUidValue !== 'string' || alertUidValue.length === 0) fail('alert_uid required');
  if (typeof reason !== 'string' || reason.trim().length === 0) fail('resolution reason required');
  const { rowCount } = await client.query(
    `UPDATE source_refresh_evidence_alerts
     SET status = 'resolved', resolved_at = NOW(), resolution_reason = $2, updated_at = NOW()
     WHERE alert_uid = $1 AND status = 'open'`,
    [alertUidValue, reason.trim()],
  );
  return { resolved: rowCount === 1, alert_uid: alertUidValue };
}

/** List open alerts (bounded), newest first. */
export async function listOpenAlerts(client, limit = 50) {
  const { rows } = await client.query(
    `SELECT alert_uid, alert_type, evidence_day_utc, severity, dedupe_key, first_seen_at, last_seen_at
     FROM source_refresh_evidence_alerts WHERE status = 'open'
     ORDER BY last_seen_at DESC LIMIT $1`,
    [Math.max(1, Math.min(500, limit))],
  );
  return rows;
}

export { DAY_MS, assertDay, fail };
