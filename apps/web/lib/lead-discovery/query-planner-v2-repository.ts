import type { QueryResult } from 'pg'

import { hashCanonicalJson } from '@/lib/opportunities/canonical-hash'

import {
  QUERY_PLANNER_GEOGRAPHY_VERSION_V2,
  QUERY_PLANNER_VERSION_V2,
  QUERY_PLANNER_V2_SOURCES,
  type ProfileScopedQueryPlanV2,
  type QueryPlanMetrics,
} from './query-planner-v2'

export const QUERY_PLAN_METRIC_VERSION_V2 = 'query-plan-yield-v2' as const

export type QueryPlannerV2Db = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
  connect?: () => Promise<QueryPlannerV2Db & { release: () => void }>
}

export type PersistedQueryPlanV2 = {
  planSnapshotId: string
  planGeneration: number
  planIdentity: string
  inserted: boolean
}

export type QueryPlansV2PersistenceResult = {
  plans: PersistedQueryPlanV2[]
  sharedRequestsInserted: number
  consumersLinked: number
}

export type QueryPlanMetricSnapshotInput = {
  planSnapshotId: string
  workspaceId: string
  clientProfileId: string
  measurementWindowStart: string | Date
  measurementWindowEnd: string | Date
  metrics: QueryPlanMetrics
}

export class QueryPlanReplayConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QueryPlanReplayConflictError'
  }
}

export async function persistProfileScopedQueryPlans(
  rawPlans: readonly ProfileScopedQueryPlanV2[],
  db: QueryPlannerV2Db,
): Promise<QueryPlansV2PersistenceResult> {
  const plans = validatePlans(rawPlans)
  const ownsClient = Boolean(db.connect) && !('release' in db)
  const client = ownsClient && db.connect ? await db.connect() : db
  try {
    return await persistPlansTransaction(plans, client)
  } finally {
    if (ownsClient && 'release' in client && typeof client.release === 'function') {
      client.release()
    }
  }
}

async function persistPlansTransaction(
  plans: readonly ProfileScopedQueryPlanV2[],
  db: QueryPlannerV2Db,
): Promise<QueryPlansV2PersistenceResult> {
  await db.query('BEGIN')
  try {
    const persisted: Array<PersistedQueryPlanV2 & {
      plan: ProfileScopedQueryPlanV2
    }> = []
    for (const plan of plans) {
      persisted.push({ ...(await persistPlan(plan, db)), plan })
    }

    let sharedRequestsInserted = 0
    let consumersLinked = 0
    for (const item of persisted) {
      if (item.plan.status !== 'ready') continue
      const shared = await ensureSharedRequest(item.plan, db)
      if (shared.inserted) sharedRequestsInserted += 1
      const consumer = await db.query(
        `INSERT INTO query_plan_request_consumers (
           shared_request_id, plan_snapshot_id, workspace_id, client_profile_id
         ) VALUES ($1, $2, $3, $4)
         ON CONFLICT (
           shared_request_id, workspace_id, client_profile_id, plan_snapshot_id
         ) DO NOTHING`,
        [
          shared.id,
          item.planSnapshotId,
          item.plan.workspaceId,
          item.plan.clientProfileId,
        ],
      )
      consumersLinked += consumer.rowCount ?? 0
    }
    await db.query('COMMIT')
    return {
      plans: persisted.map(({ plan: _plan, ...item }) => item),
      sharedRequestsInserted,
      consumersLinked,
    }
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  }
}

async function persistPlan(
  plan: ProfileScopedQueryPlanV2,
  db: QueryPlannerV2Db,
): Promise<PersistedQueryPlanV2> {
  await db.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [
      `query-planner-v2:${plan.workspaceId}:${plan.clientProfileId}:` +
      plan.planIdentity,
    ],
  )
  const replay = await findPlanReplay(plan, db)
  if (replay) return { ...replay, planIdentity: plan.planIdentity, inserted: false }

  const generationResult = await db.query<{ nextGeneration: number }>(
    `SELECT COALESCE(MAX(plan_generation), 0) + 1 AS "nextGeneration"
     FROM query_plan_snapshots
     WHERE workspace_id = $1
       AND client_profile_id = $2
       AND planner_version = $3
       AND plan_identity = $4`,
    [
      plan.workspaceId,
      plan.clientProfileId,
      plan.plannerVersion,
      plan.planIdentity,
    ],
  )
  const nextGeneration = positiveInteger(
    generationResult.rows[0]?.nextGeneration,
    'plan generation',
  )
  const inserted = await db.query<{ id: string; planGeneration: number }>(
    `INSERT INTO query_plan_snapshots (
       workspace_id, owner_id, client_profile_id, plan_identity,
       plan_generation, planner_version, geography_version, source,
       role_family, role_synonyms, specializations, canonical_region,
       region_snapshot, seniorities, keyword_cluster, negative_terms,
       page_budget, frequency, profile_consumers, historical_yield,
       feedback_adjustments, query_env, status, reason_codes,
       profile_snapshot_hash, feedback_hash, shared_request_hash, input_hash
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::TEXT[], $11::TEXT[],
       $12, $13::JSONB, $14::TEXT[], $15::TEXT[], $16::TEXT[], $17,
       $18, $19::BIGINT[], $20::JSONB, $21::JSONB, $22::JSONB, $23,
       $24::TEXT[], $25, $26, $27, $28
     )
     ON CONFLICT (
       workspace_id, client_profile_id, planner_version, input_hash
     ) DO NOTHING
     RETURNING id::TEXT AS id, plan_generation AS "planGeneration"`,
    [
      plan.workspaceId,
      plan.ownerId,
      plan.clientProfileId,
      plan.planIdentity,
      nextGeneration,
      plan.plannerVersion,
      plan.geographyVersion,
      plan.source,
      plan.roleFamily,
      plan.roleSynonyms,
      plan.specializations,
      plan.region.canonicalRegion,
      JSON.stringify(plan.region),
      plan.seniorities,
      plan.keywordCluster,
      plan.negativeTerms,
      plan.pageBudget,
      plan.frequency,
      plan.profileConsumers,
      JSON.stringify(plan.historicalYield),
      JSON.stringify(plan.feedbackAdjustments),
      JSON.stringify(plan.queryEnv),
      plan.status,
      plan.reasonCodes,
      plan.profileSnapshotHash,
      plan.feedbackHash,
      plan.sharedRequestHash,
      plan.inputHash,
    ],
  )
  const row = inserted.rows[0]
  if (row) {
    return {
      planSnapshotId: positiveId(row.id, 'plan snapshot'),
      planGeneration: positiveInteger(row.planGeneration, 'plan generation'),
      planIdentity: plan.planIdentity,
      inserted: true,
    }
  }
  const reconciled = await findPlanReplay(plan, db)
  if (!reconciled) {
    throw new QueryPlanReplayConflictError(
      'Query plan input replay could not be reconciled.',
    )
  }
  return { ...reconciled, planIdentity: plan.planIdentity, inserted: false }
}

async function findPlanReplay(
  plan: ProfileScopedQueryPlanV2,
  db: QueryPlannerV2Db,
): Promise<Pick<PersistedQueryPlanV2, 'planSnapshotId' | 'planGeneration'> | null> {
  const result = await db.query<{
    id: string
    planGeneration: number
    planIdentity: string
    ownerId: string
    profileSnapshotHash: string
    source: string
    sharedRequestHash: string
  }>(
    `SELECT
       id::TEXT AS id,
       plan_generation AS "planGeneration",
       plan_identity AS "planIdentity",
       owner_id::TEXT AS "ownerId",
       profile_snapshot_hash AS "profileSnapshotHash",
       source,
       shared_request_hash AS "sharedRequestHash"
     FROM query_plan_snapshots
     WHERE workspace_id = $1
       AND client_profile_id = $2
       AND planner_version = $3
       AND input_hash = $4
     FOR UPDATE`,
    [
      plan.workspaceId,
      plan.clientProfileId,
      plan.plannerVersion,
      plan.inputHash,
    ],
  )
  const row = result.rows[0]
  if (!row) return null
  if (
    row.planIdentity !== plan.planIdentity ||
    row.ownerId !== plan.ownerId ||
    row.profileSnapshotHash !== plan.profileSnapshotHash ||
    row.source !== plan.source ||
    row.sharedRequestHash !== plan.sharedRequestHash
  ) {
    throw new QueryPlanReplayConflictError(
      'Query plan input hash resolved to different profile provenance.',
    )
  }
  return {
    planSnapshotId: positiveId(row.id, 'plan snapshot'),
    planGeneration: positiveInteger(row.planGeneration, 'plan generation'),
  }
}

async function ensureSharedRequest(
  plan: ProfileScopedQueryPlanV2,
  db: QueryPlannerV2Db,
): Promise<{ id: string; inserted: boolean }> {
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO query_plan_shared_requests (
       planner_version, source, shared_request_hash, query_env,
       page_budget, frequency
     ) VALUES ($1, $2, $3, $4::JSONB, $5, $6)
     ON CONFLICT (planner_version, source, shared_request_hash) DO NOTHING
     RETURNING id::TEXT AS id`,
    [
      plan.plannerVersion,
      plan.source,
      plan.sharedRequestHash,
      JSON.stringify(plan.queryEnv),
      plan.pageBudget,
      plan.frequency,
    ],
  )
  if (inserted.rows[0]) {
    return { id: positiveId(inserted.rows[0].id, 'shared request'), inserted: true }
  }
  const existing = await db.query<{ id: string }>(
    `SELECT id::TEXT AS id
     FROM query_plan_shared_requests
     WHERE planner_version = $1
       AND source = $2
       AND shared_request_hash = $3
       AND query_env = $4::JSONB
       AND page_budget = $5
       AND frequency = $6
     FOR UPDATE`,
    [
      plan.plannerVersion,
      plan.source,
      plan.sharedRequestHash,
      JSON.stringify(plan.queryEnv),
      plan.pageBudget,
      plan.frequency,
    ],
  )
  const row = existing.rows[0]
  if (!row) {
    throw new QueryPlanReplayConflictError(
      'Shared request hash resolved to different source parameters.',
    )
  }
  return { id: positiveId(row.id, 'shared request'), inserted: false }
}

export async function persistQueryPlanMetricSnapshot(
  raw: QueryPlanMetricSnapshotInput,
  db: QueryPlannerV2Db,
): Promise<{ metricSnapshotId: string; inserted: boolean }> {
  const input = validateMetricInput(raw)
  const inputHash = hashCanonicalJson({
    metricVersion: QUERY_PLAN_METRIC_VERSION_V2,
    ...input,
  })
  const values = [
    input.planSnapshotId,
    input.workspaceId,
    input.clientProfileId,
    QUERY_PLAN_METRIC_VERSION_V2,
    input.measurementWindowStart,
    input.measurementWindowEnd,
    input.metrics.executionCount,
    input.metrics.zeroResultExecutions,
    input.metrics.fetchedRecords,
    input.metrics.uniqueEvents,
    input.metrics.uniqueCompanies,
    input.metrics.episodes,
    input.metrics.qualifiedOpportunities,
    input.metrics.accepted,
    input.metrics.contacted,
    input.metrics.replied,
    input.metrics.meetings,
    input.metrics.duplicateRate,
    input.metrics.zeroResultRate,
    input.metrics.qualifiedRate,
    input.metrics.acceptedRate,
    input.metrics.contactedRate,
    input.metrics.replyRate,
    input.metrics.meetingRate,
    inputHash,
  ]
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO query_plan_metric_snapshots (
       plan_snapshot_id, workspace_id, client_profile_id, metric_version,
       measurement_window_start, measurement_window_end, execution_count,
       zero_result_executions, fetched_records, unique_events,
       unique_companies, episodes, qualified_opportunities, accepted,
       contacted, replied, meetings, duplicate_rate, zero_result_rate,
       qualified_rate, accepted_rate, contacted_rate, reply_rate,
       meeting_rate, input_hash
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
       $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
     )
     ON CONFLICT (plan_snapshot_id, metric_version, input_hash) DO NOTHING
     RETURNING id::TEXT AS id`,
    values,
  )
  if (inserted.rows[0]) {
    return {
      metricSnapshotId: positiveId(inserted.rows[0].id, 'metric snapshot'),
      inserted: true,
    }
  }
  const replay = await db.query<{ id: string }>(
    `SELECT id::TEXT AS id
     FROM query_plan_metric_snapshots
     WHERE plan_snapshot_id = $1
       AND metric_version = $2
       AND input_hash = $3`,
    [input.planSnapshotId, QUERY_PLAN_METRIC_VERSION_V2, inputHash],
  )
  if (!replay.rows[0]) {
    throw new QueryPlanReplayConflictError(
      'Query plan metric replay could not be reconciled.',
    )
  }
  return {
    metricSnapshotId: positiveId(replay.rows[0].id, 'metric snapshot'),
    inserted: false,
  }
}

function validatePlans(
  rawPlans: readonly ProfileScopedQueryPlanV2[],
): ProfileScopedQueryPlanV2[] {
  if (!Array.isArray(rawPlans)) throw new TypeError('Query plans must be an array.')
  const inputHashes = new Set<string>()
  return rawPlans.map((plan) => {
    if (!plan || plan.plannerVersion !== QUERY_PLANNER_VERSION_V2 ||
        plan.geographyVersion !== QUERY_PLANNER_GEOGRAPHY_VERSION_V2 ||
        !(QUERY_PLANNER_V2_SOURCES as readonly string[]).includes(plan.source)) {
      throw new TypeError('Invalid Query Planner v2 plan contract.')
    }
    positiveId(plan.workspaceId, 'workspace')
    positiveId(plan.ownerId, 'owner')
    positiveId(plan.clientProfileId, 'client profile')
    for (const [value, label] of [
      [plan.profileSnapshotHash, 'profile snapshot hash'],
      [plan.feedbackHash, 'feedback hash'],
      [plan.planIdentity, 'plan identity'],
      [plan.sharedRequestHash, 'shared request hash'],
      [plan.inputHash, 'input hash'],
    ] as const) hash(value, label)
    if (inputHashes.has(plan.inputHash)) {
      throw new TypeError('Duplicate Query Planner v2 input hash in batch.')
    }
    inputHashes.add(plan.inputHash)
    if (plan.profileConsumers.length !== 1 ||
        plan.profileConsumers[0] !== plan.clientProfileId) {
      throw new TypeError('Query plan consumers must remain profile scoped.')
    }
    const { inputHash, ...snapshot } = plan
    if (hashCanonicalJson(snapshot) !== inputHash) {
      throw new TypeError('Query plan input hash does not match its snapshot.')
    }
    return plan
  })
}

function validateMetricInput(
  input: QueryPlanMetricSnapshotInput,
): QueryPlanMetricSnapshotInput & {
  measurementWindowStart: string
  measurementWindowEnd: string
} {
  const start = timestamp(input.measurementWindowStart, 'measurement window start')
  const end = timestamp(input.measurementWindowEnd, 'measurement window end')
  if (new Date(end).getTime() <= new Date(start).getTime()) {
    throw new TypeError('Measurement window end must be after start.')
  }
  positiveId(input.planSnapshotId, 'plan snapshot')
  positiveId(input.workspaceId, 'workspace')
  positiveId(input.clientProfileId, 'client profile')
  if (!input.metrics || typeof input.metrics !== 'object') {
    throw new TypeError('Query plan metrics are required.')
  }
  return { ...input, measurementWindowStart: start, measurementWindowEnd: end }
}

function timestamp(value: string | Date, label: string): string {
  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`Invalid ${label}.`)
  return parsed.toISOString()
}

function positiveId(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim()
  if (!/^[1-9]\d{0,18}$/.test(normalized)) throw new TypeError(`Invalid ${label}.`)
  return normalized
}

function positiveInteger(value: unknown, label: string): number {
  const normalized = Number(value)
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new TypeError(`Invalid ${label}.`)
  }
  return normalized
}

function hash(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new TypeError(`Invalid ${label}.`)
  return normalized
}
