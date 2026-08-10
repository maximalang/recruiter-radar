import { timingSafeEqual } from 'node:crypto'

import type { PoolClient } from 'pg'

import { getClient } from './db-pool'

export const OPERATOR_MCP_PROTOCOL_VERSION = '2026-07-28'
export const OPERATOR_MCP_LEGACY_PROTOCOL_VERSION = '2025-11-25'
export const OPERATOR_MCP_SERVER_VERSION = '1.0.0'
export const OPERATOR_MCP_MAX_BODY_BYTES = 64 * 1024

const LEGACY_PROTOCOL_VERSIONS = new Set([
  '2025-03-26',
  '2025-06-18',
  '2025-11-25',
])

const ALLOWED_ORIGINS = new Set([
  'https://chatgpt.com',
  'https://chat.openai.com',
])

const TOOL_DEFINITIONS = [
  {
    name: 'get_production_state',
    title: 'Get Recruiter Radar production state',
    description:
      'Read safe runtime deployment metadata and boolean product feature gates. Never returns secrets or raw environment values.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'get_database_state',
    title: 'Get Recruiter Radar database state',
    description:
      'Run a bounded READ ONLY transaction to verify PostgreSQL connectivity and migration state without returning database credentials or tenant data.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'get_quality_validation_state',
    title: 'Get Commercial Signal quality validation state',
    description:
      'Read aggregate Quality v2 snapshot, evidence and exact-lineage coverage. This does not claim HUMAN_REVIEWED or QUALITY_VALIDATED.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'list_quality_review_targets',
    title: 'List anonymized Quality review targets',
    description:
      'List workspace/profile IDs with enough exact v3 + Quality v2 samples for a human-review export. Returns only aggregate counts and timestamps, never company or user PII.',
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'integer',
          minimum: 1,
          maximum: 90,
          default: 30,
          description: 'Lookback window in whole days.',
        },
        minSamples: {
          type: 'integer',
          minimum: 1,
          maximum: 500,
          default: 5,
          description: 'Minimum exact-lineage samples per workspace/profile.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          default: 20,
          description: 'Maximum number of aggregate workspace/profile rows.',
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
] as const

const TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((tool) => tool.name))

type JsonRpcId = string | number | null

type RpcOutcome = {
  status: number
  body: Record<string, unknown> | null
}

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

export function isOperatorMcpEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.RR_MCP_ENABLED === 'true'
}

export function isAllowedOperatorMcpOrigin(origin: string | null): boolean {
  return origin == null || origin === '' || ALLOWED_ORIGINS.has(origin)
}

export function isValidOperatorMcpToken(token: string | undefined): boolean {
  return typeof token === 'string' && token.trim().length >= 32
}

export function isAuthorizedOperatorMcpRequest(
  authorization: string | null,
  expectedToken: string | undefined,
): boolean {
  if (!isValidOperatorMcpToken(expectedToken)) return false
  if (!authorization?.startsWith('Bearer ')) return false

  const supplied = authorization.slice('Bearer '.length).trim()
  const expected = expectedToken!.trim()
  const suppliedBytes = Buffer.from(supplied)
  const expectedBytes = Buffer.from(expected)

  if (suppliedBytes.length !== expectedBytes.length) return false
  return timingSafeEqual(suppliedBytes, expectedBytes)
}

export function getOperatorMcpTools() {
  return TOOL_DEFINITIONS.map((tool) => structuredClone(tool))
}

export function isSupportedOperatorMcpProtocolVersion(version: string | null): boolean {
  if (version == null || version === '') return true
  return version === OPERATOR_MCP_PROTOCOL_VERSION || LEGACY_PROTOCOL_VERSIONS.has(version)
}

export function validateModernMcpHeaders(
  protocolVersion: string | null,
  methodHeader: string | null,
  nameHeader: string | null,
  body: Record<string, unknown>,
): string | null {
  if (protocolVersion !== OPERATOR_MCP_PROTOCOL_VERSION) return null
  if (typeof body.method !== 'string') return 'JSON-RPC method is required'
  if (methodHeader !== body.method) return 'Mcp-Method header must match JSON-RPC method'

  if (body.method === 'tools/call') {
    const params = asObject(body.params)
    const bodyName = typeof params.name === 'string' ? params.name : null
    if (!bodyName || nameHeader !== bodyName) {
      return 'Mcp-Name header must match tools/call params.name'
    }
  }

  return null
}

export async function handleOperatorMcpRequest(
  request: Record<string, unknown>,
  protocolHeader: string | null,
): Promise<RpcOutcome> {
  const id = jsonRpcId(request.id)
  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    return rpcError(id, -32600, 'Invalid Request', 400)
  }

  const currentProtocol = protocolHeader === OPERATOR_MCP_PROTOCOL_VERSION

  if (currentProtocol && request.method === 'initialize') {
    return rpcError(id, -32601, 'Method not found', 404)
  }

  switch (request.method) {
    case 'server/discover':
      return rpcResult(id, {
        resultType: 'complete',
        supportedVersions: [OPERATOR_MCP_PROTOCOL_VERSION, OPERATOR_MCP_LEGACY_PROTOCOL_VERSION],
        capabilities: { tools: {} },
        serverInfo: {
          name: 'recruiter-radar-operator',
          title: 'Recruiter Radar Operator',
          version: OPERATOR_MCP_SERVER_VERSION,
          description: 'Authenticated read-only production diagnostics for Recruiter Radar.',
        },
        instructions:
          'Use only for Recruiter Radar production diagnostics. All tools are read-only and intentionally omit secrets, personal data, raw company evidence, arbitrary SQL and host shell access.',
        ttlMs: 300_000,
        cacheScope: 'private',
      })

    case 'initialize': {
      const params = asObject(request.params)
      const requestedVersion =
        typeof params.protocolVersion === 'string' ? params.protocolVersion : null
      const negotiatedVersion =
        requestedVersion && LEGACY_PROTOCOL_VERSIONS.has(requestedVersion)
          ? requestedVersion
          : OPERATOR_MCP_LEGACY_PROTOCOL_VERSION

      return rpcResult(id, {
        protocolVersion: negotiatedVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: 'recruiter-radar-operator',
          version: OPERATOR_MCP_SERVER_VERSION,
        },
        instructions:
          'Authenticated read-only Recruiter Radar production diagnostics. No shell, arbitrary SQL, secrets or PII are exposed.',
      })
    }

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return { status: 202, body: null }

    case 'ping':
      return rpcResult(id, {})

    case 'tools/list':
      return rpcResult(id, {
        tools: getOperatorMcpTools(),
        ...(currentProtocol ? { ttlMs: 300_000, cacheScope: 'private' } : {}),
      })

    case 'tools/call': {
      const params = asObject(request.params)
      const name = typeof params.name === 'string' ? params.name : ''
      if (!name) return rpcError(id, -32602, 'Tool name is required', 400)
      if (!TOOL_NAMES.has(name as (typeof TOOL_DEFINITIONS)[number]['name'])) {
        return rpcError(id, -32602, 'Unknown tool', 400)
      }
      if (params.arguments !== undefined && !isObject(params.arguments)) {
        return rpcError(id, -32602, 'Tool arguments must be an object', 400)
      }

      const toolResult = await callOperatorTool(name, asObject(params.arguments))
      return rpcResult(id, toolResult)
    }

    default:
      return rpcError(id, -32601, 'Method not found', currentProtocol ? 404 : 200)
  }
}

async function callOperatorTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    switch (name) {
      case 'get_production_state':
        assertNoArguments(args)
        return toolSuccess(getProductionState())
      case 'get_database_state':
        assertNoArguments(args)
        return toolSuccess(await getDatabaseState())
      case 'get_quality_validation_state':
        assertNoArguments(args)
        return toolSuccess(await getQualityValidationState())
      case 'list_quality_review_targets':
        return toolSuccess(await listQualityReviewTargets(args))
      default:
        return toolFailure('unknown_tool')
    }
  } catch (error) {
    const code = error instanceof OperatorInputError ? 'invalid_arguments' : 'operator_query_failed'
    return toolFailure(code)
  }
}

function getProductionState() {
  const env = process.env
  return {
    mode: 'read_only',
    serverTime: new Date().toISOString(),
    deploySha: safeSha(env.RR_DEPLOY_SHA),
    nodeEnv: env.NODE_ENV === 'production' ? 'production' : 'non_production',
    nodeVersion: process.version,
    uptimeSeconds: Math.floor(process.uptime()),
    publicAppOrigin:
      env.PUBLIC_APP_ORIGIN === 'https://recruiter-radar.ru'
        ? 'https://recruiter-radar.ru'
        : 'non_canonical_or_missing',
    dependencies: {
      databaseConfigured: Boolean(env.DATABASE_URL?.trim()),
      redisConfigured: Boolean(env.REDIS_URL?.trim()),
    },
    featureGates: {
      opportunityEngineV1: env.OPPORTUNITY_ENGINE_V1_ENABLED === 'true',
      companyEventsV1: env.COMPANY_EVENTS_V1_ENABLED === 'true',
      companyStateV1: env.COMPANY_STATE_V1_ENABLED === 'true',
      signalEpisodesV2: env.SIGNAL_EPISODES_V2_ENABLED === 'true',
      commercialThesisV1: env.COMMERCIAL_THESIS_V1_ENABLED === 'true',
      externalAgencyPropensityV1: env.EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED === 'true',
      agencyDnaMatchV2: env.AGENCY_DNA_MATCH_V2_ENABLED === 'true',
      opportunityScoringV3: env.OPPORTUNITY_SCORING_V3_ENABLED === 'true',
      commercialSignalQualityV2: env.COMMERCIAL_SIGNAL_QUALITY_V2_ENABLED === 'true',
      commercialSignalQualityPlannerFeedbackV2:
        env.COMMERCIAL_SIGNAL_QUALITY_V2_PLANNER_FEEDBACK_ENABLED === 'true',
      commercialSignalUi: env.OPPORTUNITY_COMMERCIAL_SIGNAL_UI_ENABLED === 'true',
    },
  }
}

async function getDatabaseState() {
  return withReadOnlyClient(async (client) => {
    const database = await client.query<{
      serverVersion: string
      inRecovery: boolean
      serverTime: string
    }>(`
      SELECT
        current_setting('server_version') AS "serverVersion",
        pg_is_in_recovery() AS "inRecovery",
        NOW()::TEXT AS "serverTime"
    `)

    const migrationPresence = await client.query<{ present: boolean }>(`
      SELECT TO_REGCLASS('public.schema_migrations') IS NOT NULL AS present
    `)

    let migrationCount = 0
    let latestMigration: string | null = null
    let latestAppliedAt: string | null = null
    const migrationTablePresent = migrationPresence.rows[0]?.present === true

    if (migrationTablePresent) {
      const migrationState = await client.query<{
        migrationCount: string
        latestMigration: string | null
        latestAppliedAt: string | null
      }>(`
        SELECT
          COUNT(*)::TEXT AS "migrationCount",
          MAX(version) AS "latestMigration",
          MAX(applied_at)::TEXT AS "latestAppliedAt"
        FROM schema_migrations
      `)
      migrationCount = Number(migrationState.rows[0]?.migrationCount ?? 0)
      latestMigration = migrationState.rows[0]?.latestMigration ?? null
      latestAppliedAt = migrationState.rows[0]?.latestAppliedAt ?? null
    }

    return {
      connectivity: 'ok',
      transactionMode: 'read_only',
      ...database.rows[0],
      migrationTablePresent,
      migrationCount,
      latestMigration,
      latestAppliedAt,
    }
  })
}

async function getQualityValidationState() {
  return withReadOnlyClient(async (client) => {
    const presence = await client.query<{
      snapshots: boolean
      evidence: boolean
      lineage: boolean
    }>(`
      SELECT
        TO_REGCLASS('public.commercial_signal_quality_snapshots') IS NOT NULL AS snapshots,
        TO_REGCLASS('public.commercial_signal_quality_evidence') IS NOT NULL AS evidence,
        TO_REGCLASS('public.commercial_signal_quality_opportunity_lineage') IS NOT NULL AS lineage
    `)

    const tables = presence.rows[0]
    if (!tables?.snapshots || !tables.evidence || !tables.lineage) {
      return {
        qualitySchemaPresent: false,
        tables: tables ?? { snapshots: false, evidence: false, lineage: false },
        contractTested: true,
        readyForHumanLabeling: false,
        humanReviewed: false,
        qualityValidated: false,
        note: 'Required Quality v2 production tables are not all present.',
      }
    }

    const aggregate = await client.query<{
      snapshots: string
      workspaces: string
      profiles: string
      organizations: string
      actionableSnapshots: string
      evidenceRows: string
      lineageRows: string
      earliestDecisionAt: string | null
      latestDecisionAt: string | null
    }>(`
      SELECT
        (SELECT COUNT(*)::TEXT FROM commercial_signal_quality_snapshots) AS snapshots,
        (SELECT COUNT(DISTINCT workspace_id)::TEXT FROM commercial_signal_quality_snapshots) AS workspaces,
        (SELECT COUNT(DISTINCT client_profile_id)::TEXT FROM commercial_signal_quality_snapshots) AS profiles,
        (SELECT COUNT(DISTINCT organization_id)::TEXT FROM commercial_signal_quality_snapshots) AS organizations,
        (SELECT COUNT(*) FILTER (WHERE actionable)::TEXT FROM commercial_signal_quality_snapshots) AS "actionableSnapshots",
        (SELECT COUNT(*)::TEXT FROM commercial_signal_quality_evidence) AS "evidenceRows",
        (SELECT COUNT(*)::TEXT FROM commercial_signal_quality_opportunity_lineage) AS "lineageRows",
        (SELECT MIN(decision_at)::TEXT FROM commercial_signal_quality_snapshots) AS "earliestDecisionAt",
        (SELECT MAX(decision_at)::TEXT FROM commercial_signal_quality_snapshots) AS "latestDecisionAt"
    `)

    const row = aggregate.rows[0]
    const snapshotCount = Number(row?.snapshots ?? 0)
    const lineageCount = Number(row?.lineageRows ?? 0)

    return {
      qualitySchemaPresent: true,
      snapshotCount,
      workspaceCount: Number(row?.workspaces ?? 0),
      profileCount: Number(row?.profiles ?? 0),
      organizationCount: Number(row?.organizations ?? 0),
      actionableSnapshotCount: Number(row?.actionableSnapshots ?? 0),
      evidenceRowCount: Number(row?.evidenceRows ?? 0),
      exactOpportunityLineageCount: lineageCount,
      snapshotsWithExactOpportunityLineageRate:
        snapshotCount === 0 ? null : Math.min(1, lineageCount / snapshotCount),
      earliestDecisionAt: row?.earliestDecisionAt ?? null,
      latestDecisionAt: row?.latestDecisionAt ?? null,
      contractTested: true,
      readyForHumanLabeling: snapshotCount > 0 && lineageCount > 0,
      humanReviewed: false,
      qualityValidated: false,
      note:
        'Human review labels are intentionally not inferred from production model output. HUMAN_REVIEWED and QUALITY_VALIDATED require imported independent human labels and frozen evaluation artifacts.',
    }
  })
}

async function listQualityReviewTargets(args: Record<string, unknown>) {
  const days = boundedInteger(args.days, 30, 1, 90)
  const minSamples = boundedInteger(args.minSamples, 5, 1, 500)
  const limit = boundedInteger(args.limit, 20, 1, 50)

  const allowed = new Set(['days', 'minSamples', 'limit'])
  if (Object.keys(args).some((key) => !allowed.has(key))) throw new OperatorInputError()

  return withReadOnlyClient(async (client) => {
    const result = await client.query<{
      workspaceId: string
      profileId: string
      exactSamples: string
      organizationCount: string
      actionableSamples: string
      earliestDecisionAt: string
      latestDecisionAt: string
    }>(`
      SELECT
        quality.workspace_id::TEXT AS "workspaceId",
        quality.client_profile_id::TEXT AS "profileId",
        COUNT(*)::TEXT AS "exactSamples",
        COUNT(DISTINCT quality.organization_id)::TEXT AS "organizationCount",
        COUNT(*) FILTER (WHERE quality.actionable)::TEXT AS "actionableSamples",
        MIN(quality.decision_at)::TEXT AS "earliestDecisionAt",
        MAX(quality.decision_at)::TEXT AS "latestDecisionAt"
      FROM commercial_signal_quality_snapshots quality
      JOIN commercial_signal_quality_opportunity_lineage lineage
        ON lineage.quality_snapshot_id = quality.id
       AND lineage.candidate_id = quality.candidate_id
       AND lineage.workspace_id = quality.workspace_id
       AND lineage.client_profile_id = quality.client_profile_id
      JOIN opportunity_candidates candidate
        ON candidate.id = quality.candidate_id
       AND candidate.organization_id = quality.organization_id
       AND candidate.workspace_id = quality.workspace_id
       AND candidate.client_profile_id = quality.client_profile_id
      WHERE quality.feature_version = 'commercial-signal-quality-v2'
        AND candidate.score_version = 'opportunity-v3'
        AND quality.decision_at >= NOW() - ($1::INTEGER * INTERVAL '1 day')
      GROUP BY quality.workspace_id, quality.client_profile_id
      HAVING COUNT(*) >= $2::INTEGER
      ORDER BY COUNT(*) DESC, quality.workspace_id, quality.client_profile_id
      LIMIT $3::INTEGER
    `, [days, minSamples, limit])

    return {
      lookbackDays: days,
      minimumSamples: minSamples,
      targetCount: result.rows.length,
      targets: result.rows.map((row) => ({
        workspaceId: row.workspaceId,
        profileId: row.profileId,
        exactSamples: Number(row.exactSamples),
        organizationCount: Number(row.organizationCount),
        actionableSamples: Number(row.actionableSamples),
        earliestDecisionAt: row.earliestDecisionAt,
        latestDecisionAt: row.latestDecisionAt,
      })),
      piiIncluded: false,
    }
  })
}

async function withReadOnlyClient<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getClient()
  if (!client) throw new Error('database_unconfigured')

  let transactionStarted = false
  try {
    await client.query('BEGIN READ ONLY')
    transactionStarted = true
    await client.query("SET LOCAL statement_timeout = '5s'")
    await client.query("SET LOCAL lock_timeout = '1s'")
    return await work(client)
  } finally {
    if (transactionStarted) await client.query('ROLLBACK').catch(() => undefined)
    client.release()
  }
}

function toolSuccess(value: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  }
}

function toolFailure(code: string): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: code }) }],
    isError: true,
  }
}

function rpcResult(id: JsonRpcId, result: Record<string, unknown>): RpcOutcome {
  return { status: 200, body: { jsonrpc: '2.0', id, result } }
}

function rpcError(id: JsonRpcId, code: number, message: string, status: number): RpcOutcome {
  return { status, body: { jsonrpc: '2.0', id, error: { code, message } } }
}

function jsonRpcId(value: unknown): JsonRpcId {
  return typeof value === 'string' || typeof value === 'number' || value === null
    ? value
    : null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asObject(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {}
}

function assertNoArguments(args: Record<string, unknown>) {
  if (Object.keys(args).length > 0) throw new OperatorInputError()
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new OperatorInputError()
  }
  return value
}

function safeSha(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? ''
  return /^[a-f0-9]{40}$/.test(normalized) ? normalized : null
}

class OperatorInputError extends Error {}
