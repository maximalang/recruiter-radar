export const COMMERCIAL_FIT_VERSION = 'commercial-fit-v2' as const

export type EvidencedValue<T> = {
  value: T | null
  evidenceIds: string[]
}

export type EconomicsFitOutcome = 'match' | 'partial' | 'mismatch' | 'unknown'

export type EconomicsFitInput = {
  expectedRoleCount: EvidencedValue<number>
  roleSeniority: EvidencedValue<string>
  serviceType: EvidencedValue<string>
  companySize: EvidencedValue<string>
  agencyMinimumFeeMinor: number | null
  agencyTypicalFeeMinor: number | null
  engagementType: EvidencedValue<string>
  estimatedScopeMinor: EvidencedValue<number>
  caseSimilarity: number | null
}

export type EconomicsFitResult = {
  featureVersion: typeof COMMERCIAL_FIT_VERSION
  economicsFit: EconomicsFitOutcome
  componentValue: number | null
  componentConfidence: number
  coverage: number
  reasons: string[]
  evidenceIds: string[]
}

export const CASE_SIMILARITY_DIMENSIONS = [
  'company_size',
  'hiring_archetype',
  'industry',
  'region',
  'role_family',
  'seniority',
  'service_type',
  'specialization',
] as const

export type CaseSimilarityDimension =
  typeof CASE_SIMILARITY_DIMENSIONS[number]

export type CaseSimilarityRecord = {
  caseId: string
  roleFamily: string | null
  specialization: string | null
  seniority: string | null
  industry: string | null
  companySize: string | null
  region: string | null
  serviceType: string | null
  hiringArchetype: string | null
}

export type CaseSimilarityInput = {
  opportunity: Omit<CaseSimilarityRecord, 'caseId'>
  cases: CaseSimilarityRecord[]
}

export type CaseSimilarityResult = {
  bestCaseId: string | null
  similarity: number
  matchedDimensions: CaseSimilarityDimension[]
  missingDimensions: CaseSimilarityDimension[]
}

export type MarketDifficultyLevel = 'high' | 'medium' | 'low' | 'unknown'

export type MarketDifficultyInput = {
  decisionDate: string
  roleFamily: string
  seniority: string
  region: string
  observation: null | {
    level: Exclude<MarketDifficultyLevel, 'unknown'>
    evidenceDate: string
    source: string
    approved: boolean
    reproducible: boolean
    evidenceIds: string[]
  }
}

export type MarketDifficultyResult = {
  marketDifficulty: MarketDifficultyLevel
  componentValue: number | null
  componentConfidence: number
  roleFamily: string
  seniority: string
  region: string
  evidenceDate: string | null
  source: string | null
  evidenceIds: string[]
}

export function buildEconomicsFit(
  rawInput: EconomicsFitInput,
): EconomicsFitResult {
  const input = normalizeEconomics(rawInput)
  const known = [
    input.expectedRoleCount.value,
    input.roleSeniority.value,
    input.serviceType.value,
    input.companySize.value,
    input.agencyMinimumFeeMinor,
    input.agencyTypicalFeeMinor,
    input.engagementType.value,
    input.estimatedScopeMinor.value,
    input.caseSimilarity,
  ].filter((value) => value !== null).length
  const coverage = round(known / 9)
  const evidenceIds = ids([
    ...input.expectedRoleCount.evidenceIds,
    ...input.roleSeniority.evidenceIds,
    ...input.serviceType.evidenceIds,
    ...input.companySize.evidenceIds,
    ...input.engagementType.evidenceIds,
    ...input.estimatedScopeMinor.evidenceIds,
  ])

  if (
    input.estimatedScopeMinor.value === null ||
    input.agencyMinimumFeeMinor === null
  ) {
    return {
      featureVersion: COMMERCIAL_FIT_VERSION,
      economicsFit: 'unknown',
      componentValue: null,
      componentConfidence: 0,
      coverage,
      reasons: ['ECONOMICS_SCOPE_UNKNOWN'],
      evidenceIds,
    }
  }

  if (input.estimatedScopeMinor.value < input.agencyMinimumFeeMinor) {
    return {
      featureVersion: COMMERCIAL_FIT_VERSION,
      economicsFit: 'mismatch',
      componentValue: 0,
      componentConfidence: round(coverage),
      coverage,
      reasons: ['ESTIMATED_SCOPE_BELOW_AGENCY_MINIMUM'],
      evidenceIds,
    }
  }

  const typicalFeeCleared =
    input.agencyTypicalFeeMinor !== null &&
    input.estimatedScopeMinor.value >= input.agencyTypicalFeeMinor
  const contextCovered =
    input.expectedRoleCount.value !== null &&
    input.roleSeniority.value !== null &&
    input.serviceType.value !== null &&
    input.engagementType.value !== null
  const match = typicalFeeCleared && contextCovered && coverage >= 0.75
  const componentValue = match
    ? round(0.8 + (0.2 * (input.caseSimilarity ?? 0)))
    : round(0.5 + (0.2 * (input.caseSimilarity ?? 0)))

  return {
    featureVersion: COMMERCIAL_FIT_VERSION,
    economicsFit: match ? 'match' : 'partial',
    componentValue,
    componentConfidence: round(coverage * 0.9),
    coverage,
    reasons: match
      ? ['ECONOMICS_SCOPE_AND_SERVICE_MATCH']
      : ['ECONOMICS_PARTIAL_COVERAGE'],
    evidenceIds,
  }
}

export function buildCaseSimilarity(
  rawInput: CaseSimilarityInput,
): CaseSimilarityResult {
  const opportunity = normalizeCaseFields(rawInput.opportunity)
  const cases = rawInput.cases.map((item) => ({
    caseId: positiveId(item.caseId, 'case id'),
    ...normalizeCaseFields(item),
  })).sort((left, right) => compareIds(left.caseId, right.caseId))

  if (cases.length === 0) {
    return {
      bestCaseId: null,
      similarity: 0,
      matchedDimensions: [],
      missingDimensions: [...CASE_SIMILARITY_DIMENSIONS],
    }
  }

  const evaluated = cases.map((item) => evaluateCase(opportunity, item))
    .sort((left, right) =>
      right.similarity - left.similarity ||
      compareIds(left.bestCaseId!, right.bestCaseId!),
    )
  return evaluated[0]!
}

export function buildMarketDifficulty(
  input: MarketDifficultyInput,
): MarketDifficultyResult {
  const decisionDate = validDateOnly(input.decisionDate)
  const roleFamily = requiredText(input.roleFamily, 'role family')
  const seniority = requiredText(input.seniority, 'seniority')
  const region = requiredText(input.region, 'region')
  if (input.observation === null) {
    return {
      marketDifficulty: 'unknown',
      componentValue: null,
      componentConfidence: 0,
      roleFamily,
      seniority,
      region,
      evidenceDate: null,
      source: null,
      evidenceIds: [],
    }
  }

  const source = requiredText(input.observation.source, 'market source')
  if (source.toLowerCase() === 'llm') {
    throw new Error('LLM cannot provide market difficulty evidence')
  }
  if (!input.observation.approved) {
    throw new Error('market difficulty source must be approved')
  }
  if (!input.observation.reproducible) {
    throw new Error('market difficulty source must be reproducible')
  }
  const evidenceDate = validDateOnly(input.observation.evidenceDate)
  if (evidenceDate > decisionDate) {
    throw new Error('future market evidence cannot enter the decision')
  }
  const componentValues = { high: 0.9, medium: 0.6, low: 0.2 } as const

  return {
    marketDifficulty: input.observation.level,
    componentValue: componentValues[input.observation.level],
    componentConfidence: 0.85,
    roleFamily,
    seniority,
    region,
    evidenceDate,
    source,
    evidenceIds: requiredIds(input.observation.evidenceIds),
  }
}

function normalizeEconomics(input: EconomicsFitInput): EconomicsFitInput {
  const minimum = money(input.agencyMinimumFeeMinor, 'agency minimum fee')
  const typical = money(input.agencyTypicalFeeMinor, 'agency typical fee')
  if (minimum !== null && typical !== null && typical < minimum) {
    throw new Error('agency typical fee cannot be below minimum fee')
  }
  return {
    expectedRoleCount: numericValue(input.expectedRoleCount, 'expected role count'),
    roleSeniority: textValue(input.roleSeniority, 'role seniority'),
    serviceType: textValue(input.serviceType, 'service type'),
    companySize: textValue(input.companySize, 'company size'),
    agencyMinimumFeeMinor: minimum,
    agencyTypicalFeeMinor: typical,
    engagementType: textValue(input.engagementType, 'engagement type'),
    estimatedScopeMinor: numericValue(input.estimatedScopeMinor, 'estimated scope'),
    caseSimilarity: input.caseSimilarity === null
      ? null
      : unitInterval(input.caseSimilarity, 'case similarity'),
  }
}

function evaluateCase(
  opportunity: Omit<CaseSimilarityRecord, 'caseId'>,
  record: CaseSimilarityRecord,
): CaseSimilarityResult {
  const pairs: Array<[
    CaseSimilarityDimension,
    string | null,
    string | null,
  ]> = [
    ['company_size', opportunity.companySize, record.companySize],
    ['hiring_archetype', opportunity.hiringArchetype, record.hiringArchetype],
    ['industry', opportunity.industry, record.industry],
    ['region', opportunity.region, record.region],
    ['role_family', opportunity.roleFamily, record.roleFamily],
    ['seniority', opportunity.seniority, record.seniority],
    ['service_type', opportunity.serviceType, record.serviceType],
    ['specialization', opportunity.specialization, record.specialization],
  ]
  const matchedDimensions = pairs.filter(([, opportunityValue, caseValue]) =>
    opportunityValue !== null && caseValue !== null && opportunityValue === caseValue,
  ).map(([dimension]) => dimension)
  const missingDimensions = pairs.filter(([, opportunityValue, caseValue]) =>
    opportunityValue === null || caseValue === null,
  ).map(([dimension]) => dimension)

  return {
    bestCaseId: record.caseId,
    similarity: round(matchedDimensions.length / CASE_SIMILARITY_DIMENSIONS.length),
    matchedDimensions,
    missingDimensions,
  }
}

function normalizeCaseFields(
  input: Omit<CaseSimilarityRecord, 'caseId'>,
): Omit<CaseSimilarityRecord, 'caseId'> {
  return {
    roleFamily: optionalText(input.roleFamily),
    specialization: optionalText(input.specialization),
    seniority: optionalText(input.seniority),
    industry: optionalText(input.industry),
    companySize: optionalText(input.companySize),
    region: optionalText(input.region),
    serviceType: optionalText(input.serviceType),
    hiringArchetype: optionalText(input.hiringArchetype),
  }
}

function numericValue(
  input: EvidencedValue<number>,
  label: string,
): EvidencedValue<number> {
  if (input.value === null) return { value: null, evidenceIds: [] }
  if (!Number.isFinite(input.value) || input.value < 0) {
    throw new Error(`${label} must be non-negative`)
  }
  return { value: input.value, evidenceIds: requiredIds(input.evidenceIds) }
}

function textValue(
  input: EvidencedValue<string>,
  label: string,
): EvidencedValue<string> {
  if (input.value === null) return { value: null, evidenceIds: [] }
  return {
    value: requiredText(input.value, label),
    evidenceIds: requiredIds(input.evidenceIds),
  }
}

function money(value: number | null, label: string): number | null {
  if (value === null) return null
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be non-negative safe minor units`)
  }
  return value
}

function optionalText(value: string | null): string | null {
  if (value === null) return null
  const normalized = value.trim().toLowerCase()
  return normalized || null
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim().toLowerCase()
  if (!normalized) throw new Error(`${label} is required`)
  return normalized
}

function validDateOnly(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('market evidence date must use YYYY-MM-DD')
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime())) throw new Error('market evidence date is invalid')
  return value
}

function requiredIds(values: readonly string[]): string[] {
  const result = ids(values)
  if (result.length === 0) throw new Error('evidence ids are required')
  return result
}

function ids(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => positiveId(value, 'evidence id')))]
    .sort(compareIds)
}

function positiveId(value: string, label: string): string {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${label} must be positive`)
  return value
}

function compareIds(left: string, right: string): number {
  return left.length - right.length || left.localeCompare(right, 'en')
}

function unitInterval(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be between 0 and 1`)
  }
  return value
}

function round(value: number): number {
  return Math.round(value * 100_000) / 100_000
}
