import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

const ACTION_EVENT = Object.freeze({
  fetch: Object.freeze({ success: 'source_fetch_succeeded', failure: 'source_fetch_failed' }),
  ingest: Object.freeze({ success: 'source_ingest_succeeded', failure: 'source_ingest_failed' }),
  pipeline: Object.freeze({ success: 'source_pipeline_succeeded', failure: 'source_pipeline_failed' }),
});

/**
 * Best-effort source telemetry. Never accepts source output, raw errors, payloads,
 * URLs, credentials or evidence. A telemetry outage must not change source exit status.
 */
export async function recordSourceActionTelemetry({
  sourceId,
  action,
  ok,
  durationMs,
}) {
  const connectionString = process.env.DATABASE_URL?.trim();
  const eventName = ACTION_EVENT[action]?.[ok ? 'success' : 'failure'];
  if (!connectionString || !eventName) return false;

  const normalizedSource = String(sourceId ?? '').trim().slice(0, 100);
  if (!normalizedSource) return false;

  const pool = new Pool({ connectionString, max: 1 });
  try {
    const result = await pool.query(
      `
        INSERT INTO product_telemetry_events (
          event_name, event_key, provider, outcome, duration_ms, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        ON CONFLICT (event_key) DO NOTHING
        RETURNING id
      `,
      [
        eventName,
        `source:${normalizedSource}:${action}:${randomUUID()}`,
        normalizedSource,
        ok ? 'succeeded' : 'failed',
        Math.max(0, Math.trunc(durationMs)),
        JSON.stringify({ action }),
      ],
    );
    return result.rowCount === 1;
  } catch {
    console.error(`Source telemetry unavailable for ${normalizedSource}:${action}`);
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}
