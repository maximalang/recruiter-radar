import {
  evaluateTransportHealth,
  selectTransportStages,
} from './source-transport-health.mjs';

export async function loadHistoricalTransportPlan(client, {
  sourceId,
  configuredStages,
  observationLimit = 20,
  now = new Date(),
}) {
  const limit = normalizeLimit(observationLimit);
  const result = await client.query(
    `SELECT completed_at, transport_attempts
     FROM source_run_observations
     WHERE source_id = $1::TEXT
       AND transport_attempts <> '[]'::JSONB
     ORDER BY completed_at DESC, id DESC
     LIMIT $2::INTEGER`,
    [sourceId, limit],
  );

  const attempts = [];
  for (const row of [...result.rows].reverse()) {
    const completedAt = normalizeDate(row.completed_at) ?? now.toISOString();
    const items = Array.isArray(row.transport_attempts) ? row.transport_attempts : [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      attempts.push({
        stage: item.stage,
        outcome: item.outcome,
        at: normalizeDate(item.at) ?? completedAt,
      });
    }
  }

  const health = evaluateTransportHealth(attempts, undefined, now);
  const plan = selectTransportStages(configuredStages, health);
  return Object.freeze({
    sourceId,
    observations: result.rows.length,
    attempts: attempts.length,
    health,
    ...plan,
  });
}

export async function recordTransportObservation(client, {
  sourceId,
  executionSourceId,
  startedAt,
  completedAt = new Date(),
  selectedStage = null,
  attempts = [],
  records = 0,
  stoppedByPolicy = false,
  reason = null,
}) {
  const start = toDate(startedAt);
  const end = toDate(completedAt);
  const normalizedAttempts = normalizeAttempts(attempts, end);
  const lastOutcome = normalizedAttempts.at(-1)?.outcome ?? null;
  const outcome = stoppedByPolicy
    ? lastOutcome === 'deferred' ? 'rate_limited' : 'blocked'
    : Number(records) > 0
      ? 'success'
      : 'failure';
  const extractionMethods = selectedStage ? { [selectedStage]: Math.max(1, Number(records) || 1) } : {};
  const errorCode = outcome === 'success' ? null : boundedCode(reason ?? lastOutcome ?? 'no-records');
  const latencyMs = Math.max(0, end.getTime() - start.getTime());

  const result = await client.query(
    `INSERT INTO source_run_observations (
       source_id, execution_source_id, scope, org_id, target_key, target_url,
       target_outcome, action, started_at, completed_at, outcome,
       records_fetched, records_accepted, duplicate_records,
       organization_resolution_rejects, extraction_methods, transport_attempts,
       latency_ms, error_code
     ) VALUES (
       $1::TEXT, $2::TEXT, 'source', NULL, NULL, NULL,
       NULL, 'fetch', $3::TIMESTAMPTZ, $4::TIMESTAMPTZ, $5::TEXT,
       $6::INTEGER, $6::INTEGER, 0, 0, $7::JSONB, $8::JSONB,
       $9::INTEGER, $10::TEXT
     )
     RETURNING id::TEXT AS id, outcome, completed_at`,
    [
      sourceId,
      executionSourceId ?? sourceId,
      start.toISOString(),
      end.toISOString(),
      outcome,
      Math.max(0, Number(records) || 0),
      JSON.stringify(extractionMethods),
      JSON.stringify(normalizedAttempts),
      latencyMs,
      errorCode,
    ],
  );
  return result.rows[0];
}

function normalizeAttempts(attempts, fallbackAt) {
  if (!Array.isArray(attempts)) return [];
  return attempts
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      stage: nonEmptyText(item.stage),
      outcome: nonEmptyText(item.outcome),
      httpStatus: Number.isInteger(Number(item.httpStatus)) ? Number(item.httpStatus) : null,
      records: Math.max(0, Number(item.records) || 0),
      rejectedRecords: Math.max(0, Number(item.rejectedRecords) || 0),
      reason: boundedText(item.reason),
      at: normalizeDate(item.at) ?? fallbackAt.toISOString(),
    }))
    .filter((item) => item.stage && item.outcome);
}

function normalizeLimit(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 100 ? parsed : 20;
}

function toDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : new Date();
}

function normalizeDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  const text = nonEmptyText(value);
  if (!text || !Number.isFinite(Date.parse(text))) return null;
  return new Date(Date.parse(text)).toISOString();
}

function boundedCode(value) {
  const text = nonEmptyText(String(value ?? ''));
  if (!text) return null;
  return text.toLowerCase().replace(/[^a-z0-9:_-]+/g, '-').slice(0, 120);
}

function boundedText(value) {
  const text = nonEmptyText(value);
  return text ? text.slice(0, 240) : null;
}

function nonEmptyText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}
