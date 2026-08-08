import { writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  COMMERCIAL_SIGNAL_CANARY_RECEIPT_SCHEMA,
  finalizeCommercialSignalCanaryReceipt,
} from './lib/commercial-signal-canary-quality.mjs'

const CONFIRMATION = 'RUN_ONE_WORKSPACE_CANARY'
const DEFAULT_BATCH_SIZE = 25
const DEFAULT_REVIEW_LIMIT = 20
const REQUEST_TIMEOUT_MS = 15 * 60 * 1000
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024

export async function executeOneWorkspaceCanary({
  baseUrl,
  apiKey,
  workspaceId,
  runId,
  connectionString,
  allowedHost,
  batchSize = DEFAULT_BATCH_SIZE,
  reviewLimit = DEFAULT_REVIEW_LIMIT,
  fetchImpl = globalThis.fetch,
  loadReview = defaultLoadReview,
  allowHttpLocalhost = false,
  clock = () => new Date(),
}) {
  const origin = productionOrigin(baseUrl, allowHttpLocalhost)
  const trustedHost = boundedText(allowedHost, 253, 'allowed host').toLowerCase()
  if (origin.host.toLowerCase() !== trustedHost) {
    throw new TypeError('Canary base URL does not match the allowed host.')
  }
  const normalizedWorkspaceId = positiveId(workspaceId, 'workspace')
  const normalizedRunId = boundedText(runId, 160, 'run id')
  const key = boundedText(apiKey, 4096, 'API key')
  const databaseUrl = boundedText(connectionString, 8192, 'database URL')
  const boundedBatch = boundedInteger(batchSize, 1, 100, 'batch size')
  const boundedReviewLimit = boundedInteger(reviewLimit, 5, 100, 'review limit')
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch is unavailable.')

  const endpoints = {
    query_plan_yield: new URL('/api/cron/opportunities/query-plan-yield', origin),
    commercial_signal_canary: new URL(
      '/api/cron/opportunities/run-commercial-signal-canary',
      origin,
    ),
    corporate_enrichment: new URL(
      '/api/cron/opportunities/commercial-signal-enrichment',
      origin,
    ),
  }
  await Promise.all(Object.values(endpoints).map((url) => requestJson({
    url,
    apiKey: key,
    method: 'GET',
    fetchImpl,
  })))

  const startedAt = validDate(clock()).toISOString()
  const stages = []
  const topRanked = []
  let failedStage = null

  try {
    const yieldResult = await runStage({
      name: 'query_plan_yield',
      url: withApply(endpoints.query_plan_yield),
      apiKey: key,
      fetchImpl,
    })
    stages.push({
      name: 'query_plan_yield',
      status: 'succeeded',
      summary: numericSummary(yieldResult.result, [
        'plansScanned', 'snapshotsInserted', 'snapshotsReplayed',
      ]),
    })

    const canaryUrl = withApply(endpoints.commercial_signal_canary)
    canaryUrl.searchParams.set('batchSize', String(boundedBatch))
    const canaryResult = await runStage({
      name: 'commercial_signal_canary',
      url: canaryUrl,
      apiKey: key,
      fetchImpl,
    })
    assertCanaryResult(canaryResult.result, normalizedWorkspaceId)
    stages.push({
      name: 'commercial_signal_canary',
      status: 'succeeded',
      summary: summarizeCanary(canaryResult.result),
    })

    const enrichmentResult = await runStage({
      name: 'corporate_enrichment',
      url: withApply(endpoints.corporate_enrichment),
      apiKey: key,
      fetchImpl,
    })
    stages.push({
      name: 'corporate_enrichment',
      status: 'succeeded',
      summary: numericSummary(enrichmentResult.result, [
        'scanned', 'completed', 'blocked', 'failed',
      ]),
    })

    const review = await loadReview({
      connectionString: databaseUrl,
      workspaceId: normalizedWorkspaceId,
      limit: boundedReviewLimit,
      now: validDate(clock()),
    })
    topRanked.push(...review.opportunities.map((row, index) =>
      reviewOpportunity(row, index + 1)))
    stages.push({
      name: 'top_review_snapshot',
      status: 'succeeded',
      summary: { captured: topRanked.length },
    })
  } catch (error) {
    failedStage = error instanceof CanaryStageError
      ? error.stage
      : 'top_review_snapshot'
    stages.push({
      name: failedStage,
      status: 'failed',
      summary: { reasonCode: safeErrorCode(error) },
    })
  }

  return finalizeCommercialSignalCanaryReceipt({
    schemaVersion: COMMERCIAL_SIGNAL_CANARY_RECEIPT_SCHEMA,
    runId: normalizedRunId,
    workspaceId: normalizedWorkspaceId,
    startedAt,
    completedAt: validDate(clock()).toISOString(),
    targetHost: origin.host,
    completed: failedStage === null,
    failedStage,
    stages,
    topRanked,
  })
}

async function defaultLoadReview(options) {
  const { loadCommercialSignalTopReview } = await import(
    './review-commercial-signal-top20.mjs'
  )
  return loadCommercialSignalTopReview(options)
}

class CanaryStageError extends Error {
  constructor(stage, reasonCode) {
    super(`Commercial Signal canary stage failed: ${stage}.`)
    this.name = 'CanaryStageError'
    this.stage = stage
    this.reasonCode = reasonCode
  }
}

async function runStage({ name, url, apiKey, fetchImpl }) {
  try {
    const body = await requestJson({ url, apiKey, method: 'POST', fetchImpl })
    if (body?.success !== true) throw new Error('stage_unsuccessful')
    return body
  } catch (error) {
    throw new CanaryStageError(name, safeErrorCode(error))
  }
}

async function requestJson({ url, apiKey, method, fetchImpl }) {
  const response = await fetchImpl(url, {
    method,
    headers: { 'x-api-key': apiKey, accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const text = await boundedResponseText(response)
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error('invalid_json_response')
  }
  if (!response.ok) throw new Error(`http_${response.status}`)
  if (method === 'GET' && body?.ok !== true) throw new Error('preflight_failed')
  return body
}

async function boundedResponseText(response) {
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error('response_too_large')
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) throw new Error('response_too_large')
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, size).toString('utf8')
}

function assertCanaryResult(result, workspaceId) {
  if (
    !result || String(result.workspaceId ?? '') !== workspaceId ||
    result.completed !== true || result.failedStage !== null
  ) throw new CanaryStageError(
    'commercial_signal_canary',
    'canary_result_mismatch',
  )
}

function summarizeCanary(result) {
  return {
    profiles: Array.isArray(result.profileIds) ? result.profileIds.length : 0,
    queryPlannerJobs: Array.isArray(result.queryPlanner)
      ? result.queryPlanner.length : 0,
    sourceRequests: safeCount(result.sourceExecution?.requestsExecuted),
    sourceRequestsBlocked: safeCount(result.sourceExecution?.requestsBlocked),
    sourceRequestsFailed: safeCount(result.sourceExecution?.requestsFailed),
    staleSourceExecutionsReconciled: safeCount(
      result.sourceExecution?.staleExecutionsReconciled,
    ),
    fetchedRecords: safeCount(result.sourceExecution?.fetchedRecords),
    uniqueCompanies: safeCount(result.sourceExecution?.uniqueCompanies),
    touchedOrganizations: Array.isArray(result.touchedOrganizationIds)
      ? result.touchedOrganizationIds.length : 0,
    materialized: safeCount(result.writer?.written),
    enrichmentQueued: safeCount(result.writer?.enrichmentQueued),
    writerFailures: safeCount(result.writer?.failed),
  }
}

function numericSummary(value, keys) {
  return Object.fromEntries(keys.map((key) => [key, safeCount(value?.[key])]))
}

function reviewOpportunity(row, rank) {
  const card = row?.commercialSignalCard &&
    typeof row.commercialSignalCard === 'object'
    ? row.commercialSignalCard : {}
  const whyNow = card.whyNow && typeof card.whyNow === 'object'
    ? card.whyNow : {}
  const events = Array.isArray(row?.companyEvents) ? row.companyEvents : []
  const plans = Array.isArray(row?.queryPlans) ? row.queryPlans : []
  const evidence = Array.isArray(row?.evidence) ? row.evidence : []
  const evidenceIds = evidence.map((item) =>
    positiveId(item?.evidenceId, 'evidence')).sort(compareIds)
  const evidenceIdSet = new Set(evidenceIds)
  const agencyReasons = Array.isArray(row?.agencyDnaReasonCodes)
    ? row.agencyDnaReasonCodes.filter(Boolean) : []
  const profileId = positiveId(row?.clientProfileId, 'client profile')
  const episodeId = positiveId(row?.signalEpisodeId, 'signal episode')
  const episodeIdentity = boundedText(
    row?.signalEpisodeIdentity,
    160,
    'signal episode identity',
  )
  const episodeGeneration = boundedInteger(
    row?.signalEpisodeGeneration,
    1,
    2147483647,
    'signal episode generation',
  )
  return {
    rank,
    lineageId: positiveId(row?.lineageId, 'lineage'),
    clientProfileId: profileId,
    organizationId: positiveId(row?.organizationId, 'organization'),
    signalEpisodeId: episodeId,
    situationKey: `${profileId}:${episodeIdentity}:${episodeGeneration}`,
    evidenceSetKey: `${profileId}:${evidenceIds.join(',')}`,
    candidateStatus: String(row?.candidateStatus ?? ''),
    cardStatus: String(card.status ?? ''),
    hasExactEvidenceLineage: plans.length > 0 &&
      evidence.length > 0 && events.length > 0,
    hasWhyNow: typeof whyNow.text === 'string' && whyNow.text.trim() !== '' &&
      whyNow.basis === 'evidence' && Array.isArray(whyNow.evidenceIds) &&
      whyNow.evidenceIds.length > 0 && whyNow.evidenceIds.every((id) =>
        evidenceIdSet.has(positiveId(id, 'why-now evidence'))),
    hasAgencyDnaLineage: typeof row?.agencyDnaMatchBand === 'string' &&
      row.agencyDnaMatchBand.trim() !== '' && agencyReasons.length > 0,
    rawVacancyOnly: events.length > 0 && events.every((event) =>
      event?.eventType === 'job_posting'),
  }
}

function withApply(input) {
  const url = new URL(input)
  url.searchParams.set('apply', 'true')
  return url
}

function productionOrigin(value, allowHttpLocalhost) {
  const url = new URL(String(value ?? ''))
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError('Canary base URL must be a clean origin.')
  }
  const localhost = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(allowHttpLocalhost && localhost)) {
    throw new TypeError('Canary base URL must use HTTPS.')
  }
  return new URL(url.origin)
}

function safeErrorCode(error) {
  const value = error instanceof CanaryStageError
    ? error.reasonCode
    : error instanceof Error
      ? error.message
      : 'unknown_error'
  const normalized = String(value).toLowerCase().replace(/[^a-z0-9_]+/g, '_')
  return normalized.slice(0, 120) || 'unknown_error'
}

function safeCount(value) {
  const number = Number(value ?? 0)
  return Number.isSafeInteger(number) && number >= 0 ? number : 0
}

function compareIds(left, right) {
  const leftId = BigInt(left)
  const rightId = BigInt(right)
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
}

function positiveId(value, label) {
  const normalized = String(value ?? '').trim()
  if (!/^[1-9]\d{0,18}$/.test(normalized) ||
      BigInt(normalized) > 9223372036854775807n) {
    throw new TypeError(`Invalid ${label} identifier.`)
  }
  return BigInt(normalized).toString()
}

function boundedText(value, maximum, label) {
  const normalized = String(value ?? '').trim()
  if (!normalized || normalized.length > maximum) {
    throw new TypeError(`Invalid ${label}.`)
  }
  return normalized
}

function boundedInteger(value, minimum, maximum, label) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(`Invalid ${label}.`)
  }
  return number
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new TypeError('Invalid timestamp.')
  return date
}

function parseArgs(argv) {
  const result = {
    baseUrl: null,
    workspaceId: null,
    runId: null,
    output: null,
    batchSize: DEFAULT_BATCH_SIZE,
    reviewLimit: DEFAULT_REVIEW_LIMIT,
    confirmation: null,
    allowHttpLocalhost: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--base-url') result.baseUrl = argv[++index] ?? null
    else if (arg === '--workspace-id') result.workspaceId = argv[++index] ?? null
    else if (arg === '--run-id') result.runId = argv[++index] ?? null
    else if (arg === '--output') result.output = argv[++index] ?? null
    else if (arg === '--batch-size') result.batchSize = Number(argv[++index])
    else if (arg === '--review-limit') result.reviewLimit = Number(argv[++index])
    else if (arg === '--confirm') result.confirmation = argv[++index] ?? null
    else if (arg === '--allow-http-localhost') result.allowHttpLocalhost = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (result.confirmation !== CONFIRMATION) {
    throw new Error(`--confirm must equal ${CONFIRMATION}.`)
  }
  result.output = safeOutputPath(result.output)
  return result
}

function safeOutputPath(value) {
  const input = boundedText(value, 4096, 'output path')
  if (!isAbsolute(input)) throw new Error('--output must be an absolute path.')
  const output = resolve(input)
  const insideWorkingTree = relative(process.cwd(), output)
  if (!insideWorkingTree.startsWith('..') && !isAbsolute(insideWorkingTree)) {
    throw new Error('--output must be outside the repository working directory.')
  }
  return output
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArgs(process.argv.slice(2))
    const receipt = await executeOneWorkspaceCanary({
      ...args,
      apiKey: process.env.CRON_API_KEY,
      connectionString: process.env.DATABASE_URL,
      allowedHost: process.env.COMMERCIAL_SIGNAL_CANARY_ALLOWED_HOST,
    })
    await writeFile(args.output, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    })
    process.stdout.write(`${JSON.stringify({
      receipt: args.output,
      runId: receipt.runId,
      workspaceId: receipt.workspaceId,
      completed: receipt.completed,
      failedStage: receipt.failedStage,
      integrity: receipt.integrity.value,
    })}\n`)
    if (!receipt.completed) process.exitCode = 2
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
