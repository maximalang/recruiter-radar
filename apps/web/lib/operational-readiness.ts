import { getPool } from './db-pool'

export type DeliveryReadinessReason =
  | 'delivered'
  | 'no_digest_run'
  | 'digest_failed'
  | 'empty_digest'
  | 'delivery_failed'
  | 'not_delivered'

export type DeliveryReadinessProfile = {
  clientProfileId: string
  channels: string[]
  latestRunId: string | null
  latestRunStatus: string | null
  selectedCount: number | null
  lastDeliveredAt: string | null
  lastFailureAt: string | null
  reason: DeliveryReadinessReason
}

export type OperationalReadinessReport = {
  windowHours: number
  generatedAt: string
  profiles: {
    eligible: number
    delivered: number
    missed: number
    reasons: Record<Exclude<DeliveryReadinessReason, 'delivered'>, number>
    details: DeliveryReadinessProfile[]
  }
  delivery: Array<{
    provider: string
    succeeded: number
    failed: number
  }>
  sourceActions: Array<{
    source: string
    succeeded: number
    failed: number
    lastEventAt: string | null
  }>
  performance: {
    digestRunP95Ms: number | null
    deliveryP95Ms: number | null
  }
  externalBlockers: string[]
}

const MAX_WINDOW_HOURS = 24 * 7

export function normalizeReadinessWindowHours(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 24
  return Math.min(MAX_WINDOW_HOURS, Math.max(1, Math.trunc(value)))
}

export function classifyDeliveryReadiness(input: {
  latestRunId: string | null
  latestRunStatus: string | null
  selectedCount: number | null
  lastDeliveredAt: string | null
  lastFailureAt: string | null
}): DeliveryReadinessReason {
  if (input.lastDeliveredAt) return 'delivered'
  if (!input.latestRunId) return 'no_digest_run'
  if (input.latestRunStatus === 'failed') return 'digest_failed'
  if (input.latestRunStatus === 'completed' && input.selectedCount === 0) return 'empty_digest'
  if (input.lastFailureAt) return 'delivery_failed'
  return 'not_delivered'
}

export async function getOperationalReadinessReport(
  windowHoursInput?: number | null,
): Promise<OperationalReadinessReport> {
  const windowHours = normalizeReadinessWindowHours(windowHoursInput)
  const pool = getPool()
  if (!pool) throw new Error('DATABASE_URL is not configured.')

  const profileResult = await pool.query<{
    client_profile_id: string
    channels: string[] | null
    latest_run_id: string | null
    latest_run_status: string | null
    selected_count: number | null
    last_delivered_at: string | null
    last_failure_at: string | null
  }>(
    `
      WITH eligible_profiles AS (
        SELECT
          cp.id,
          ARRAY_REMOVE(ARRAY[
            CASE WHEN cp.telegram_chat_id IS NOT NULL THEN 'telegram' END,
            CASE WHEN cp.email_digest_enabled = true AND cp.digest_email IS NOT NULL THEN 'email' END,
            CASE WHEN cp.web_push_enabled = true AND EXISTS (
              SELECT 1 FROM web_push_subscriptions wps
              WHERE wps.client_profile_id = cp.id AND wps.is_active = true
            ) THEN 'web_push' END,
            CASE WHEN EXISTS (
              SELECT 1
              FROM notification_routes nr
              JOIN notification_endpoints ne ON ne.id = nr.endpoint_id
              JOIN notification_provider_accounts npa ON npa.id = ne.provider_account_id
              WHERE nr.client_profile_id = cp.id
                AND nr.event_kind = 'daily_digest'
                AND nr.status = 'active'
                AND ne.status = 'active'
                AND ne.destination_id IS NOT NULL
                AND npa.status IN ('active', 'degraded')
                AND npa.provider = 'telegram'
            ) THEN 'telegram_byob' END,
            CASE WHEN EXISTS (
              SELECT 1
              FROM notification_routes nr
              JOIN notification_endpoints ne ON ne.id = nr.endpoint_id
              JOIN notification_provider_accounts npa ON npa.id = ne.provider_account_id
              WHERE nr.client_profile_id = cp.id
                AND nr.event_kind = 'daily_digest'
                AND nr.status = 'active'
                AND ne.status = 'active'
                AND ne.destination_id IS NOT NULL
                AND npa.status IN ('active', 'degraded')
                AND npa.provider = 'vk'
            ) THEN 'vk' END,
            CASE WHEN EXISTS (
              SELECT 1
              FROM notification_routes nr
              JOIN notification_endpoints ne ON ne.id = nr.endpoint_id
              JOIN notification_provider_accounts npa ON npa.id = ne.provider_account_id
              WHERE nr.client_profile_id = cp.id
                AND nr.event_kind = 'daily_digest'
                AND nr.status = 'active'
                AND ne.status = 'active'
                AND ne.destination_id IS NOT NULL
                AND npa.status IN ('active', 'degraded')
                AND npa.provider = 'webhook'
            ) THEN 'webhook' END
          ], NULL)::TEXT[] AS channels
        FROM client_profiles cp
        WHERE cp.is_active = true
          AND cp.delivery_enabled = true
          AND (
            cp.delivery_frequency <> 'weekly'
            OR EXTRACT(ISODOW FROM NOW() AT TIME ZONE 'Europe/Moscow') = 1
          )
          AND (
            cp.telegram_chat_id IS NOT NULL
            OR (cp.email_digest_enabled = true AND cp.digest_email IS NOT NULL)
            OR (
              cp.web_push_enabled = true
              AND EXISTS (
                SELECT 1 FROM web_push_subscriptions wps
                WHERE wps.client_profile_id = cp.id AND wps.is_active = true
              )
            )
            OR EXISTS (
              SELECT 1
              FROM notification_routes nr
              JOIN notification_endpoints ne ON ne.id = nr.endpoint_id
              JOIN notification_provider_accounts npa ON npa.id = ne.provider_account_id
              WHERE nr.client_profile_id = cp.id
                AND nr.event_kind = 'daily_digest'
                AND nr.status = 'active'
                AND ne.status = 'active'
                AND ne.destination_id IS NOT NULL
                AND npa.status IN ('active', 'degraded')
            )
          )
      ),
      latest_runs AS (
        SELECT DISTINCT ON (dr.client_profile_id)
          dr.client_profile_id,
          dr.id::TEXT AS latest_run_id,
          dr.status::TEXT AS latest_run_status,
          dr.selected_count
        FROM digest_runs dr
        WHERE dr.created_at >= NOW() - ($1::INT * INTERVAL '1 hour')
        ORDER BY dr.client_profile_id, dr.created_at DESC
      ),
      delivered AS (
        SELECT client_profile_id, MAX(occurred_at)::TEXT AS last_delivered_at
        FROM product_telemetry_events
        WHERE event_name = 'digest_delivered'
          AND occurred_at >= NOW() - ($1::INT * INTERVAL '1 hour')
        GROUP BY client_profile_id
      ),
      failed AS (
        SELECT client_profile_id, MAX(occurred_at)::TEXT AS last_failure_at
        FROM product_telemetry_events
        WHERE event_name = 'delivery_failed'
          AND occurred_at >= NOW() - ($1::INT * INTERVAL '1 hour')
        GROUP BY client_profile_id
      )
      SELECT
        ep.id::TEXT AS client_profile_id,
        ep.channels,
        lr.latest_run_id,
        lr.latest_run_status,
        lr.selected_count,
        d.last_delivered_at,
        f.last_failure_at
      FROM eligible_profiles ep
      LEFT JOIN latest_runs lr ON lr.client_profile_id = ep.id
      LEFT JOIN delivered d ON d.client_profile_id = ep.id
      LEFT JOIN failed f ON f.client_profile_id = ep.id
      ORDER BY ep.id
    `,
    [windowHours],
  )

  const details: DeliveryReadinessProfile[] = profileResult.rows.map((row) => {
    const base = {
      clientProfileId: row.client_profile_id,
      channels: row.channels ?? [],
      latestRunId: row.latest_run_id,
      latestRunStatus: row.latest_run_status,
      selectedCount: row.selected_count,
      lastDeliveredAt: row.last_delivered_at,
      lastFailureAt: row.last_failure_at,
    }
    return { ...base, reason: classifyDeliveryReadiness(base) }
  })

  const deliveryResult = await pool.query<{
    provider: string | null
    succeeded: number
    failed: number
  }>(
    `
      SELECT
        COALESCE(provider, 'unknown') AS provider,
        COUNT(*) FILTER (WHERE event_name = 'delivery_succeeded')::INT AS succeeded,
        COUNT(*) FILTER (WHERE event_name = 'delivery_failed')::INT AS failed
      FROM product_telemetry_events
      WHERE event_name IN ('delivery_succeeded', 'delivery_failed')
        AND occurred_at >= NOW() - ($1::INT * INTERVAL '1 hour')
      GROUP BY COALESCE(provider, 'unknown')
      ORDER BY provider
    `,
    [windowHours],
  )

  const sourceResult = await pool.query<{
    source: string
    succeeded: number
    failed: number
    last_event_at: string | null
  }>(
    `
      SELECT
        COALESCE(provider, 'unknown') AS source,
        COUNT(*) FILTER (WHERE event_name LIKE '%_succeeded')::INT AS succeeded,
        COUNT(*) FILTER (WHERE event_name LIKE '%_failed')::INT AS failed,
        MAX(occurred_at)::TEXT AS last_event_at
      FROM product_telemetry_events
      WHERE event_name IN (
        'source_fetch_succeeded', 'source_fetch_failed',
        'source_ingest_succeeded', 'source_ingest_failed',
        'source_pipeline_succeeded', 'source_pipeline_failed'
      )
        AND occurred_at >= NOW() - ($1::INT * INTERVAL '1 hour')
      GROUP BY COALESCE(provider, 'unknown')
      ORDER BY source
    `,
    [windowHours],
  )

  const performanceResult = await pool.query<{
    digest_run_p95_ms: number | null
    delivery_p95_ms: number | null
  }>(
    `
      SELECT
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)
          FILTER (WHERE event_name IN ('digest_run_succeeded', 'digest_run_failed'))::FLOAT8
          AS digest_run_p95_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)
          FILTER (WHERE event_name IN ('delivery_succeeded', 'delivery_failed'))::FLOAT8
          AS delivery_p95_ms
      FROM product_telemetry_events
      WHERE duration_ms IS NOT NULL
        AND occurred_at >= NOW() - ($1::INT * INTERVAL '1 hour')
    `,
    [windowHours],
  )

  const reasons: OperationalReadinessReport['profiles']['reasons'] = {
    no_digest_run: 0,
    digest_failed: 0,
    empty_digest: 0,
    delivery_failed: 0,
    not_delivered: 0,
  }
  for (const profile of details) {
    if (profile.reason !== 'delivered') reasons[profile.reason] += 1
  }

  const delivered = details.filter((profile) => profile.reason === 'delivered').length
  const performance = performanceResult.rows[0]

  return {
    windowHours,
    generatedAt: new Date().toISOString(),
    profiles: {
      eligible: details.length,
      delivered,
      missed: details.length - delivered,
      reasons,
      details,
    },
    delivery: deliveryResult.rows.map((row) => ({
      provider: row.provider ?? 'unknown',
      succeeded: row.succeeded,
      failed: row.failed,
    })),
    sourceActions: sourceResult.rows.map((row) => ({
      source: row.source,
      succeeded: row.succeeded,
      failed: row.failed,
      lastEventAt: row.last_event_at,
    })),
    performance: {
      digestRunP95Ms: performance?.digest_run_p95_ms ?? null,
      deliveryP95Ms: performance?.delivery_p95_ms ?? null,
    },
    externalBlockers: [
      'External monitoring and alert routing are not configured by application code.',
      'Historical periods before the telemetry migration have incomplete event coverage.',
      'Provider credentials and live endpoint health require production-shaped configuration.',
    ],
  }
}
