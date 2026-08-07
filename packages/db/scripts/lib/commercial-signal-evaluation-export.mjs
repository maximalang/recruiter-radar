import { createHmac } from 'node:crypto'

export const DEFAULT_REPLY_MATURITY_HOURS = 168

export function anonymizeEvaluationRow(row, kind, key, options = {}) {
  const sampleKey = pseudonym(
    key,
    `profile:${row.profileId}:episode:${row.episodeId}:item:${row.opportunityId}`,
  )
  const hasOutcome = row.hasOutcome === true
  const progressed = row.accepted === true || row.contacted === true ||
    row.replied === true || row.meeting === true
  const category = progressed ? null : mapFalsePositiveReason(
    row.dismissReasonCode ?? row.lostReasonCode,
  )
  const replied = replyLabel(row, hasOutcome, options)
  return {
    sampleKey,
    agencyProfileKey: pseudonym(key, `profile:${row.profileId}`),
    episodeType: safeIdentifier(row.episodeType, 'unknown'),
    sourceFamilies: jsonStringArray(row.sourceFamilies),
    queryPlanKey: null,
    observedAt: new Date(row.observedAt).toISOString(),
    vacancyCount: row.vacancyCount == null ? null : Number(row.vacancyCount),
    scores: {
      oldFiur: finiteOrNull(row.oldFiur),
      opportunityV2: finiteOrNull(row.opportunityV2),
      opportunityV3: finiteOrNull(row.opportunityV3),
    },
    labels: {
      qualified: kind === 'production_shadow' ? null
        : progressed ? true : category ? false : null,
      accepted: hasOutcome ? row.accepted === true : null,
      contacted: hasOutcome ? row.contacted === true : null,
      replied,
      meeting: hasOutcome ? row.meeting === true : null,
      falsePositiveCategory: category,
    },
  }
}

export function mapFalsePositiveReason(reason) {
  const mappings = {
    bad_fit: 'weak_agency_fit',
    wrong_roles: 'wrong_role',
    wrong_industry: 'weak_agency_fit',
    wrong_region: 'wrong_region',
    company_too_small: 'weak_agency_fit',
    company_too_large: 'weak_agency_fit',
    low_commercial_value: 'bad_economics',
    internal_recruitment_only: 'internal_only',
    no_external_need_signal: 'weak_external_need',
    weak_evidence: 'unverified_company',
    duplicate: 'duplicate_event',
    wrong_timing: 'stale_signal',
    internal_team: 'internal_only',
    price: 'bad_economics',
    no_budget: 'bad_economics',
    procurement_block: 'bad_economics',
    position_closed: 'stale_signal',
  }
  return mappings[reason] ?? null
}

export function pseudonym(key, value) {
  return createHmac('sha256', key).update(value).digest('hex')
}

export function splitBucket(sampleKey) {
  return Number.parseInt(sampleKey.slice(0, 8), 16) % 5
}

export function splitGroup(kind) {
  if (kind === 'holdout') return 'holdout-real'
  if (kind === 'production_shadow') return 'production-shadow'
  return 'labeled-real'
}

export function datasetLimitations(kind) {
  const common = [
    'Identifiers are keyed pseudonyms; no company or contact identity is exported.',
    'The exporter is read-only and workspace scoped.',
    'Missing values remain null and are not inferred as zero.',
  ]
  if (kind === 'production_shadow') return [
    ...common,
    'V3 shadow candidates are not joined to legacy outcomes without an explicit lineage key.',
    'Shadow rows do not constitute rollout or canary acceptance.',
  ]
  return [
    ...common,
    `No-reply remains unlabeled until ${DEFAULT_REPLY_MATURITY_HOURS} hours after first contact unless a terminal outcome makes it mature earlier.`,
    'Observational-only and immature outcomes remain unlabeled.',
    'Legacy outcome reasons are mapped only when they have an unambiguous taxonomy category.',
    'V3 remains null until a reviewed cross-version lineage contract exists.',
  ]
}

function replyLabel(row, hasOutcome, options) {
  if (!hasOutcome) return null
  if (row.replied === true) return true
  if (row.contacted !== true) return false
  if (row.dismissReasonCode || row.lostReasonCode) return false

  const contactedAt = timestampOrNull(row.contactedAt)
  if (!contactedAt) return null
  const evaluatedAt = timestampOrNull(options.evaluatedAt) ?? new Date().toISOString()
  const maturityHours = positiveNumberOrDefault(
    options.replyMaturityHours,
    DEFAULT_REPLY_MATURITY_HOURS,
  )
  return Date.parse(evaluatedAt) - Date.parse(contactedAt) >=
    maturityHours * 60 * 60 * 1000
    ? false
    : null
}

function jsonStringArray(value) {
  const input = Array.isArray(value) ? value : []
  return [...new Set(input.map((item) => String(item).trim().toLowerCase())
    .filter((item) => /^[a-z0-9][a-z0-9._-]{0,127}$/.test(item)))]
    .sort()
}

function safeIdentifier(value, fallback) {
  const normalized = String(value ?? '').trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 128)
  return normalized || fallback
}

function finiteOrNull(value) {
  if (value == null) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function timestampOrNull(value) {
  if (value == null || value === '') return null
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function positiveNumberOrDefault(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}
