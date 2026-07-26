import type { Pool, PoolClient } from 'pg'

import { getPool } from './db-pool'
import { LANDING_ANALYTICS_EVENT_NAMES } from './landing-analytics-contract'

export const PRODUCT_EVENT_NAMES = [
  ...LANDING_ANALYTICS_EVENT_NAMES,
  'methodology_stage_selected',
  'preview_submitted',
  'order_paid',
  'sales_request_accepted',
  'profile_created',
  'profile_completed',
  'notification_channel_connected',
  'test_notification_succeeded',
  'digest_generated',
  'digest_delivered',
  'feedback_recorded',
  'source_fetch_succeeded',
  'source_fetch_failed',
  'source_ingest_succeeded',
  'source_ingest_failed',
  'source_pipeline_succeeded',
  'source_pipeline_failed',
  'digest_run_succeeded',
  'digest_run_failed',
  'delivery_succeeded',
  'delivery_failed',
] as const

export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number]
export type TelemetryDbClient = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>
export type TelemetryMetadataValue = string | number | boolean | null | TelemetryMetadataValue[] | {
  [key: string]: TelemetryMetadataValue
}
export type TelemetryMetadata = Record<string, TelemetryMetadataValue>

const EVENT_NAME_SET = new Set<string>(PRODUCT_EVENT_NAMES)
const SENSITIVE_KEY = /(token|secret|password|authorization|cookie|email|phone|contact|payload|evidence|body)/i
const MAX_METADATA_BYTES = 4_096
const MAX_DEPTH = 6

export function isProductEventName(value: unknown): value is ProductEventName {
  return typeof value === 'string' && EVENT_NAME_SET.has(value)
}

export function assertTelemetryMetadataSafe(
  metadata: TelemetryMetadata,
  depth = 0,
): TelemetryMetadata {
  if (depth > MAX_DEPTH) {
    throw new Error('Telemetry metadata is nested too deeply.')
  }

  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_KEY.test(key)) {
      throw new Error(`Telemetry metadata key is not allowed: ${key}`)
    }
    assertTelemetryValueSafe(value, depth + 1)
  }

  const encoded = JSON.stringify(metadata)
  if (Buffer.byteLength(encoded, 'utf8') > MAX_METADATA_BYTES) {
    throw new Error('Telemetry metadata exceeds the 4096-byte limit.')
  }

  return metadata
}

function assertTelemetryValueSafe(value: TelemetryMetadataValue, depth: number): void {
  if (depth > MAX_DEPTH) {
    throw new Error('Telemetry metadata is nested too deeply.')
  }

  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('Telemetry metadata numbers must be finite.')
    }
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) assertTelemetryValueSafe(item, depth + 1)
    return
  }

  assertTelemetryMetadataSafe(value, depth + 1)
}

function normalizeOptionalId(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const normalized = String(value).trim()
  if (!/^\d+$/.test(normalized)) {
    throw new Error('Telemetry relation id must be a positive integer.')
  }
  return normalized
}

export async function recordProductEvent(input: {
  eventName: ProductEventName
  eventKey?: string | null
  ownerId?: string | number | null
  clientProfileId?: string | number | null
  checkoutOrderId?: string | number | null
  provider?: string | null
  outcome?: string | null
  durationMs?: number | null
  metadata?: TelemetryMetadata
  occurredAt?: Date | string | null
}, db?: TelemetryDbClient): Promise<boolean> {
  if (!isProductEventName(input.eventName)) {
    throw new Error(`Unknown product telemetry event: ${String(input.eventName)}`)
  }

  const pool = db ?? getPool()
  if (!pool) return false

  const eventKey = input.eventKey?.trim() || null
  const provider = input.provider?.trim() || null
  const outcome = input.outcome?.trim() || null
  const durationMs = input.durationMs == null ? null : Math.max(0, Math.trunc(input.durationMs))
  const metadata = assertTelemetryMetadataSafe(input.metadata ?? {})
  const occurredAt = input.occurredAt instanceof Date
    ? input.occurredAt.toISOString()
    : input.occurredAt?.trim() || new Date().toISOString()

  const result = await pool.query(
    `
      INSERT INTO product_telemetry_events (
        event_name, event_key, owner_id, client_profile_id, checkout_order_id,
        provider, outcome, duration_ms, metadata, occurred_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::timestamptz)
      ON CONFLICT (event_key) DO NOTHING
      RETURNING id
    `,
    [
      input.eventName,
      eventKey,
      normalizeOptionalId(input.ownerId),
      normalizeOptionalId(input.clientProfileId),
      normalizeOptionalId(input.checkoutOrderId),
      provider,
      outcome,
      durationMs,
      JSON.stringify(metadata),
      occurredAt,
    ],
  )

  return result.rowCount === 1
}

/**
 * Telemetry must never break the product path. Validation errors and DB outages
 * are reported without echoing metadata or provider payloads.
 */
export async function tryRecordProductEvent(
  input: Parameters<typeof recordProductEvent>[0],
  db?: TelemetryDbClient,
): Promise<boolean> {
  try {
    return await recordProductEvent(input, db)
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown telemetry error'
    console.error('Product telemetry write failed', { eventName: input.eventName, reason })
    return false
  }
}
