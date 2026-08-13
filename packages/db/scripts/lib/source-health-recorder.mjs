export function buildSourceRunMetrics({ sourceId, action, startedAt, completedAt, input, error }) {
  const extractionMethods = {};
  for (const record of input?.normalizedRecords ?? []) {
    const method = typeof record?.extractionMethod === 'string' && record.extractionMethod.trim() ? record.extractionMethod.trim() : input?.inputMode ?? 'unknown';
    extractionMethods[method] = (extractionMethods[method] ?? 0) + 1;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  const outcome = !error ? 'success' : /429|rate.?limit|cooldown/.test(message) ? 'rate_limited' : /blocked|robots|credential|not supplied|forbidden|403/.test(message) ? 'blocked' : 'failure';
  return {
    sourceId, action, startedAt: new Date(startedAt).toISOString(), completedAt: new Date(completedAt).toISOString(), outcome,
    recordsFetched: Number(input?.recordsReceived ?? 0), recordsAccepted: Number(input?.normalizedRecords?.length ?? 0), duplicateRecords: Number(input?.duplicateRecords ?? 0),
    organizationResolutionRejects: Number(input?.organizationResolutionRejects ?? 0), extractionMethods, latencyMs: Math.max(0, Number(completedAt) - Number(startedAt)),
    errorCode: error ? outcome : null,
  };
}

export async function recordSourceRunObservation(client, m) {
  await client.query(`INSERT INTO source_run_observations (source_id, action, started_at, completed_at, outcome, records_fetched, records_accepted, duplicate_records, organization_resolution_rejects, extraction_methods, latency_ms, error_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::JSONB,$11,$12)`, [m.sourceId, m.action, m.startedAt, m.completedAt, m.outcome, m.recordsFetched, m.recordsAccepted, m.duplicateRecords, m.organizationResolutionRejects, JSON.stringify(m.extractionMethods), m.latencyMs, m.errorCode]);
  await client.query(`INSERT INTO source_health_state (source_id, last_attempt_at, last_successful_fetch_at, last_successful_normalization_at, records_fetched, records_accepted, duplicate_records, organization_resolution_rejects, blocked_count, rate_limited_count, extraction_methods, last_latency_ms, consecutive_failures, updated_at) VALUES ($1,$2,CASE WHEN $3='success' THEN $2::TIMESTAMPTZ END,CASE WHEN $3='success' AND $5>0 THEN $2::TIMESTAMPTZ END,$4,$5,$6,$7,CASE WHEN $3='blocked' THEN 1 ELSE 0 END,CASE WHEN $3='rate_limited' THEN 1 ELSE 0 END,$8::JSONB,$9,CASE WHEN $3='success' THEN 0 ELSE 1 END,NOW()) ON CONFLICT (source_id) DO UPDATE SET last_attempt_at=EXCLUDED.last_attempt_at,last_successful_fetch_at=COALESCE(EXCLUDED.last_successful_fetch_at,source_health_state.last_successful_fetch_at),last_successful_normalization_at=COALESCE(EXCLUDED.last_successful_normalization_at,source_health_state.last_successful_normalization_at),records_fetched=source_health_state.records_fetched+EXCLUDED.records_fetched,records_accepted=source_health_state.records_accepted+EXCLUDED.records_accepted,duplicate_records=source_health_state.duplicate_records+EXCLUDED.duplicate_records,organization_resolution_rejects=source_health_state.organization_resolution_rejects+EXCLUDED.organization_resolution_rejects,blocked_count=source_health_state.blocked_count+EXCLUDED.blocked_count,rate_limited_count=source_health_state.rate_limited_count+EXCLUDED.rate_limited_count,extraction_methods=source_health_state.extraction_methods||EXCLUDED.extraction_methods,last_latency_ms=EXCLUDED.last_latency_ms,consecutive_failures=CASE WHEN $3='success' THEN 0 ELSE source_health_state.consecutive_failures + 1 END,updated_at=NOW()`, [m.sourceId, m.completedAt, m.outcome, m.recordsFetched, m.recordsAccepted, m.duplicateRecords, m.organizationResolutionRejects, JSON.stringify(m.extractionMethods), m.latencyMs]);
}
