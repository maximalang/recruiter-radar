export const EVIDENCE_RADAR_VERSION = 'evidence-radar-v1' as const
export const EVIDENCE_RADAR_SCORE_VERSION = 'evidence-lead-score-v1' as const

export const NORMALIZED_SIGNAL_TYPES = [
  'hiring_growth',
  'mass_hiring',
  'new_region',
  'new_office',
  'new_department',
  'leadership_change',
  'recruiter_hiring',
  'funding_received',
  'major_contract',
  'product_launch',
  'technology_expansion',
  'production_expansion',
  'international_expansion',
  'team_growth',
  'talent_shortage',
  'urgent_hiring',
  'hiring_freeze',
  'downsizing',
  'financial_risk',
  'legal_risk',
] as const

export type NormalizedSignalType = (typeof NORMALIZED_SIGNAL_TYPES)[number]
export type SignalPolarity = 'positive' | 'negative' | 'context'

export type SignalTaxonomyDefinition = {
  type: NormalizedSignalType
  label: string
  polarity: SignalPolarity
  baseWeight: number
  halfLifeDays: number
  minimumIndependentConfirmations: number
  affectedFunctions: readonly string[]
  industryCoefficients: Readonly<Record<string, number>>
  regionCoefficients: Readonly<Record<string, number>>
  dedupeWindowDays: number
}

const taxonomy = (
  type: NormalizedSignalType,
  label: string,
  polarity: SignalPolarity,
  baseWeight: number,
  halfLifeDays: number,
  minimumIndependentConfirmations: number,
  affectedFunctions: readonly string[],
  dedupeWindowDays: number,
  industryCoefficients: Readonly<Record<string, number>> = {},
  regionCoefficients: Readonly<Record<string, number>> = {},
): SignalTaxonomyDefinition => ({
  type,
  label,
  polarity,
  baseWeight,
  halfLifeDays,
  minimumIndependentConfirmations,
  affectedFunctions,
  industryCoefficients,
  regionCoefficients,
  dedupeWindowDays,
})

export const SIGNAL_TAXONOMY: readonly SignalTaxonomyDefinition[] = [
  taxonomy('hiring_growth', 'Hiring Growth', 'positive', .82, 30, 2, ['recruiting', 'target_roles'], 14),
  taxonomy('mass_hiring', 'Mass Hiring', 'positive', .95, 21, 2, ['operations', 'recruiting', 'hr'], 10),
  taxonomy('new_region', 'New Region', 'positive', .80, 60, 2, ['operations', 'sales', 'recruiting'], 45),
  taxonomy('new_office', 'New Office', 'positive', .76, 60, 2, ['operations', 'facilities', 'hr'], 45),
  taxonomy('new_department', 'New Department', 'positive', .78, 45, 2, ['target_roles', 'management', 'recruiting'], 30),
  taxonomy('leadership_change', 'Leadership Change', 'context', .48, 45, 1, ['management', 'hr'], 30),
  taxonomy('recruiter_hiring', 'Recruiter Hiring', 'context', .58, 21, 1, ['recruiting', 'hr'], 14),
  taxonomy('funding_received', 'Funding Received', 'positive', .68, 75, 2, ['engineering', 'product', 'sales', 'recruiting'], 45),
  taxonomy('major_contract', 'Major Contract', 'positive', .88, 60, 2, ['project', 'engineering', 'operations'], 30),
  taxonomy('product_launch', 'Product Launch', 'positive', .66, 45, 2, ['engineering', 'product', 'sales', 'customer_success'], 21),
  taxonomy('technology_expansion', 'Technology Expansion', 'positive', .64, 45, 2, ['engineering', 'data', 'devops', 'security'], 21),
  taxonomy('production_expansion', 'Production Expansion', 'positive', .92, 90, 2, ['production', 'maintenance', 'quality', 'hse', 'hr'], 45),
  taxonomy('international_expansion', 'International Expansion', 'positive', .76, 75, 2, ['sales', 'operations', 'legal', 'support'], 45),
  taxonomy('team_growth', 'Team Growth', 'positive', .72, 30, 2, ['target_roles', 'recruiting'], 14),
  taxonomy('talent_shortage', 'Talent Shortage', 'positive', .84, 21, 2, ['target_roles', 'recruiting'], 14),
  taxonomy('urgent_hiring', 'Urgent Hiring', 'positive', .94, 10, 2, ['target_roles', 'recruiting'], 7),
  taxonomy('hiring_freeze', 'Hiring Freeze', 'negative', .92, 21, 1, ['all'], 14),
  taxonomy('downsizing', 'Downsizing', 'negative', .96, 45, 2, ['all'], 30),
  taxonomy('financial_risk', 'Financial Risk', 'negative', .82, 60, 2, ['all'], 30),
  taxonomy('legal_risk', 'Legal Risk', 'negative', .72, 60, 1, ['all'], 30),
]

const TAXONOMY_BY_TYPE = new Map(SIGNAL_TAXONOMY.map((item) => [item.type, item]))

export type OrganizationResolutionCandidate = {
  organizationId: string
  legalName?: string | null
  brand?: string | null
  inn?: string | null
  ogrn?: string | null
  domains?: readonly string[]
  addresses?: readonly string[]
  confidence?: number
}

export type OrganizationResolutionInput = OrganizationResolutionCandidate

export type OrganizationResolutionResult = {
  status: 'resolved' | 'review' | 'no_match'
  organizationId: string | null
  confidence: number
  reasons: string[]
  candidates: Array<{ organizationId: string; score: number; reasons: string[] }>
}

export function resolveOrganization(
  input: OrganizationResolutionInput,
  candidates: readonly OrganizationResolutionCandidate[],
): OrganizationResolutionResult {
  const normalizedInn = normalizeDigits(input.inn)
  const normalizedOgrn = normalizeDigits(input.ogrn)
  const exactInn = normalizedInn
    ? candidates.filter((candidate) => normalizeDigits(candidate.inn) === normalizedInn)
    : []
  if (exactInn.length === 1) return exactResolution(exactInn[0], 'exact_inn')
  if (exactInn.length > 1) return reviewResolution(exactInn, 'duplicate_exact_inn')

  const exactOgrn = normalizedOgrn
    ? candidates.filter((candidate) => normalizeDigits(candidate.ogrn) === normalizedOgrn)
    : []
  if (exactOgrn.length === 1) return exactResolution(exactOgrn[0], 'exact_ogrn')
  if (exactOgrn.length > 1) return reviewResolution(exactOgrn, 'duplicate_exact_ogrn')

  const scored = candidates
    .map((candidate) => scoreOrganizationMatch(input, candidate))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.organizationId.localeCompare(right.organizationId))

  if (scored.length === 0) {
    return { status: 'no_match', organizationId: null, confidence: 0, reasons: ['no_supported_match'], candidates: [] }
  }

  const best = scored[0]
  const runnerUp = scored[1]
  const uniquelyStrong = best.score >= .86 && (!runnerUp || best.score - runnerUp.score >= .18)
  if (uniquelyStrong) {
    return {
      status: 'resolved',
      organizationId: best.organizationId,
      confidence: best.score,
      reasons: best.reasons,
      candidates: scored.slice(0, 5),
    }
  }

  return {
    status: 'review',
    organizationId: null,
    confidence: best.score,
    reasons: ['ambiguous_identity_match', ...best.reasons],
    candidates: scored.slice(0, 5),
  }
}

function exactResolution(candidate: OrganizationResolutionCandidate, reason: string): OrganizationResolutionResult {
  return {
    status: 'resolved',
    organizationId: candidate.organizationId,
    confidence: 1,
    reasons: [reason],
    candidates: [{ organizationId: candidate.organizationId, score: 1, reasons: [reason] }],
  }
}

function reviewResolution(candidates: readonly OrganizationResolutionCandidate[], reason: string): OrganizationResolutionResult {
  return {
    status: 'review',
    organizationId: null,
    confidence: 1,
    reasons: [reason],
    candidates: candidates.map((candidate) => ({ organizationId: candidate.organizationId, score: 1, reasons: [reason] })),
  }
}

function scoreOrganizationMatch(input: OrganizationResolutionInput, candidate: OrganizationResolutionCandidate) {
  let score = 0
  const reasons: string[] = []
  const inputDomains = new Set((input.domains ?? []).map(normalizeDomain).filter(Boolean))
  const candidateDomains = new Set((candidate.domains ?? []).map(normalizeDomain).filter(Boolean))
  const sharedDomain = [...inputDomains].some((domain) => candidateDomains.has(domain))
  if (sharedDomain) { score += .62; reasons.push('exact_domain') }

  const legalSimilarity = normalizedText(input.legalName) && normalizedText(input.legalName) === normalizedText(candidate.legalName)
  if (legalSimilarity) { score += .28; reasons.push('exact_legal_name') }
  const brandSimilarity = normalizedText(input.brand) && normalizedText(input.brand) === normalizedText(candidate.brand)
  if (brandSimilarity) { score += .18; reasons.push('exact_brand') }

  const inputAddresses = new Set((input.addresses ?? []).map(normalizedText).filter(Boolean))
  const candidateAddresses = new Set((candidate.addresses ?? []).map(normalizedText).filter(Boolean))
  if ([...inputAddresses].some((address) => candidateAddresses.has(address))) {
    score += .20
    reasons.push('exact_address')
  }

  score = Math.min(1, score * clamp01(candidate.confidence ?? 1))
  return { organizationId: candidate.organizationId, score: round(score, 4), reasons }
}

export type EvidenceEvent = {
  id: string
  organizationId: string
  eventType: string
  sourceRegistryId: string
  sourceFamily: string
  occurredAt: string
  detectedAt: string
  canonicalUrl: string | null
  documentId?: string | null
  locationId?: string | null
  facts: Readonly<Record<string, unknown>>
  staffingNeed?: Readonly<Record<string, unknown>> | null
  confidence: number
  independentConfirmations: number
  validUntil: string
  polarity: SignalPolarity
  verificationStatus: 'unverified' | 'verified' | 'rejected' | 'expired'
  contentFingerprint: string
  primarySource?: boolean
}

export function dedupeEvents(events: readonly EvidenceEvent[]): EvidenceEvent[] {
  const ordered = [...events].sort((left, right) =>
    Date.parse(left.detectedAt) - Date.parse(right.detectedAt) || left.id.localeCompare(right.id),
  )
  const seen = new Set<string>()
  const result: EvidenceEvent[] = []
  for (const event of ordered) {
    const key = eventDeduplicationKey(event)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(event)
  }
  return result
}

export function eventDeduplicationKey(event: EvidenceEvent): string {
  const canonical = canonicalizeUrl(event.canonicalUrl)
  const document = normalizedText(event.documentId)
  const fingerprint = normalizedText(event.contentFingerprint)
  if (fingerprint) return `${event.organizationId}:content:${fingerprint}`
  if (document) return `${event.organizationId}:document:${event.sourceFamily}:${document}`
  if (canonical) return `${event.organizationId}:url:${canonical}`
  return `${event.organizationId}:event:${event.id}`
}

export type NormalizedSignal = {
  id: string
  organizationId: string
  type: NormalizedSignalType
  startedAt: string
  lastSeenAt: string
  validUntil: string
  confidence: number
  strength: number
  eventIds: string[]
  sourceFamilies: string[]
  affectedFunctions: string[]
  regionCode?: string | null
  city?: string | null
}

export type CorrelationRule = {
  id: string
  label: string
  requiredTypes: readonly NormalizedSignalType[]
  optionalTypes: readonly NormalizedSignalType[]
  windowDays: number
  minimumSourceFamilies: number
  intentBoost: number
  explanation: string
}

export const CORRELATION_RULES: readonly CorrelationRule[] = [
  { id: 'funding-hiring-recruiter', label: 'Funding → hiring growth → recruiter', requiredTypes: ['funding_received', 'hiring_growth'], optionalTypes: ['recruiter_hiring'], windowDays: 60, minimumSourceFamilies: 2, intentBoost: .12, explanation: 'Capital event followed by direct hiring activity.' },
  { id: 'contract-project-hiring', label: 'Major contract → project hiring', requiredTypes: ['major_contract', 'hiring_growth'], optionalTypes: ['urgent_hiring', 'talent_shortage'], windowDays: 45, minimumSourceFamilies: 2, intentBoost: .15, explanation: 'Contract demand followed by project staffing evidence.' },
  { id: 'region-office-local-hiring', label: 'New region → local hiring', requiredTypes: ['new_region', 'hiring_growth'], optionalTypes: ['new_office', 'leadership_change'], windowDays: 90, minimumSourceFamilies: 2, intentBoost: .13, explanation: 'Geographic expansion corroborated by local hiring.' },
  { id: 'product-tech-hiring', label: 'Product launch → technology expansion', requiredTypes: ['product_launch', 'technology_expansion'], optionalTypes: ['hiring_growth', 'team_growth'], windowDays: 60, minimumSourceFamilies: 2, intentBoost: .10, explanation: 'Product activity is corroborated by technology/team expansion.' },
  { id: 'production-mass-hiring', label: 'Production expansion → hiring', requiredTypes: ['production_expansion', 'hiring_growth'], optionalTypes: ['mass_hiring', 'urgent_hiring'], windowDays: 120, minimumSourceFamilies: 2, intentBoost: .18, explanation: 'Physical production growth is corroborated by workforce demand.' },
  { id: 'customer-demand-support', label: 'Commercial demand → support growth', requiredTypes: ['major_contract', 'team_growth'], optionalTypes: ['new_department', 'urgent_hiring'], windowDays: 60, minimumSourceFamilies: 2, intentBoost: .10, explanation: 'New demand is corroborated by team expansion.' },
  { id: 'first-party-external-hiring', label: 'First-party interest + external hiring', requiredTypes: ['hiring_growth'], optionalTypes: ['urgent_hiring', 'recruiter_hiring'], windowDays: 30, minimumSourceFamilies: 2, intentBoost: .08, explanation: 'First-party interest may improve timing only when external evidence also exists.' },
]

export type CorrelationMatch = {
  ruleId: string
  organizationId: string
  signalIds: string[]
  sourceFamilies: string[]
  intentBoost: number
  explanation: string
}

export function correlateSignals(
  signals: readonly NormalizedSignal[],
  now = new Date(),
): CorrelationMatch[] {
  const byOrganization = groupBy(signals, (signal) => signal.organizationId)
  const matches: CorrelationMatch[] = []

  for (const [organizationId, organizationSignals] of byOrganization) {
    const live = organizationSignals.filter((signal) =>
      Date.parse(signal.validUntil) >= now.getTime() && signal.confidence > 0,
    )
    for (const rule of CORRELATION_RULES) {
      const required = rule.requiredTypes.map((type) => live.filter((signal) => signal.type === type))
      if (required.some((group) => group.length === 0)) continue
      const chosen = chooseCorrelationSignals(required, rule, live)
      if (!chosen) continue
      const optional = live.filter((signal) =>
        rule.optionalTypes.includes(signal.type) && withinWindow(chosen, signal, rule.windowDays),
      )
      const all = uniqueById([...chosen, ...optional])
      const sourceFamilies = uniqueSorted(all.flatMap((signal) => signal.sourceFamilies))
      if (sourceFamilies.length < rule.minimumSourceFamilies) continue
      matches.push({
        ruleId: rule.id,
        organizationId,
        signalIds: all.map((signal) => signal.id).sort(),
        sourceFamilies,
        intentBoost: rule.intentBoost,
        explanation: rule.explanation,
      })
    }
  }
  return matches.sort((a, b) => a.organizationId.localeCompare(b.organizationId) || a.ruleId.localeCompare(b.ruleId))
}

function chooseCorrelationSignals(
  required: readonly NormalizedSignal[][],
  rule: CorrelationRule,
  all: readonly NormalizedSignal[],
): NormalizedSignal[] | null {
  const candidates = cartesian(required)
  for (const combination of candidates) {
    const timestamps = combination.flatMap((signal) => [Date.parse(signal.startedAt), Date.parse(signal.lastSeenAt)])
    const span = Math.max(...timestamps) - Math.min(...timestamps)
    if (span > rule.windowDays * DAY_MS) continue
    const sourceFamilies = uniqueSorted(combination.flatMap((signal) => signal.sourceFamilies))
    if (sourceFamilies.length >= rule.minimumSourceFamilies) return combination
    const optionalIndependent = all.some((signal) =>
      rule.optionalTypes.includes(signal.type) && withinWindow(combination, signal, rule.windowDays) &&
      signal.sourceFamilies.some((family) => !sourceFamilies.includes(family)),
    )
    if (optionalIndependent) return combination
  }
  return null
}

function withinWindow(base: readonly NormalizedSignal[], candidate: NormalizedSignal, windowDays: number): boolean {
  const times = [...base, candidate].flatMap((signal) => [Date.parse(signal.startedAt), Date.parse(signal.lastSeenAt)])
  return Math.max(...times) - Math.min(...times) <= windowDays * DAY_MS
}

export type LeadScoreContribution = {
  eventId: string
  component: 'hiring_intent' | 'confidence' | 'freshness' | 'urgency' | 'commercial_fit' | 'contactability' | 'risk'
  delta: number
  reason: string
}

export type LeadScoreInput = {
  hiringIntent: number
  confidence: number
  freshness: number
  urgency: number
  commercialFit: number
  contactability: number
  risk: number
  eventContributions: readonly LeadScoreContribution[]
}

export type LeadScoreResult = {
  version: typeof EVIDENCE_RADAR_SCORE_VERSION
  leadScore: number
  opportunityScore: number
  confidenceScore: number
  urgencyScore: number
  contactabilityScore: number
  riskScore: number
  components: {
    hiringIntent: number
    confidence: number
    freshness: number
    urgency: number
    commercialFit: number
    contactability: number
    risk: number
    riskPenalty: number
  }
  contributions: LeadScoreContribution[]
}

export function calculateLeadScore(input: LeadScoreInput): LeadScoreResult {
  const components = {
    hiringIntent: clamp01(input.hiringIntent),
    confidence: clamp01(input.confidence),
    freshness: clamp01(input.freshness),
    urgency: clamp01(input.urgency),
    commercialFit: clamp01(input.commercialFit),
    contactability: clamp01(input.contactability),
    risk: clamp01(input.risk),
  }
  const opportunity = components.hiringIntent * components.confidence * components.freshness *
    components.urgency * components.commercialFit * components.contactability
  const riskPenalty = components.risk * 35
  return {
    version: EVIDENCE_RADAR_SCORE_VERSION,
    leadScore: round(Math.max(0, opportunity * 100 - riskPenalty), 1),
    opportunityScore: round(opportunity * 100, 1),
    confidenceScore: round(components.confidence * 100, 1),
    urgencyScore: round(components.urgency * 100, 1),
    contactabilityScore: round(components.contactability * 100, 1),
    riskScore: round(components.risk * 100, 1),
    components: { ...components, riskPenalty: round(riskPenalty, 2) },
    contributions: input.eventContributions.map((item) => ({ ...item })),
  }
}

export function decaySignalStrength(
  initialStrength: number,
  observedAt: string,
  halfLifeDays: number,
  now = new Date(),
): number {
  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0) throw new Error('halfLifeDays must be positive')
  const observed = Date.parse(observedAt)
  if (!Number.isFinite(observed)) throw new Error('observedAt must be a valid timestamp')
  const ageDays = Math.max(0, (now.getTime() - observed) / DAY_MS)
  return clamp01(initialStrength) * 2 ** (-ageDays / halfLifeDays)
}

export type StaffingForecast = {
  functions: string[]
  professions: string[]
  seniorities: string[]
  minHeadcount: number
  maxHeadcount: number
  mode: 'targeted' | 'project' | 'mass'
  expectedStart: string | null
  city: string | null
  federalSubjectCode: string | null
  externalAgencyProbability: number
  decisionMakerRoles: string[]
  basisSignalIds: string[]
  confidence: number
}

type StaffingRule = Omit<StaffingForecast, 'basisSignalIds' | 'confidence' | 'city' | 'federalSubjectCode' | 'expectedStart'> & {
  expectedStartDays: number | null
}

const STAFFING_RULES: Partial<Record<NormalizedSignalType, StaffingRule>> = {
  production_expansion: { functions: ['production', 'maintenance', 'quality', 'hse', 'hr'], professions: ['операторы', 'инженеры', 'техники', 'специалисты по качеству', 'охрана труда', 'HR'], seniorities: ['specialist', 'lead', 'manager'], minHeadcount: 20, maxHeadcount: 200, mode: 'mass', expectedStartDays: 30, externalAgencyProbability: .82, decisionMakerRoles: ['HRD', 'Head of Recruitment', 'Plant Director', 'Operations Director'] },
  major_contract: { functions: ['project', 'engineering', 'analytics', 'operations'], professions: ['project managers', 'engineers', 'analysts', 'delivery specialists'], seniorities: ['specialist', 'senior', 'lead'], minHeadcount: 5, maxHeadcount: 60, mode: 'project', expectedStartDays: 21, externalAgencyProbability: .72, decisionMakerRoles: ['HRD', 'Project Director', 'Head of Recruitment'] },
  funding_received: { functions: ['engineering', 'product', 'sales', 'recruiting'], professions: ['developers', 'product managers', 'sales managers', 'recruiters'], seniorities: ['middle', 'senior', 'lead'], minHeadcount: 4, maxHeadcount: 35, mode: 'project', expectedStartDays: 30, externalAgencyProbability: .62, decisionMakerRoles: ['CEO', 'HRD', 'CTO', 'CPO', 'Head of Recruitment'] },
  product_launch: { functions: ['engineering', 'devops', 'sales', 'customer_success', 'support'], professions: ['developers', 'DevOps engineers', 'sales managers', 'customer success', 'support'], seniorities: ['middle', 'senior'], minHeadcount: 3, maxHeadcount: 25, mode: 'targeted', expectedStartDays: 21, externalAgencyProbability: .58, decisionMakerRoles: ['CTO', 'CPO', 'HRD', 'Head of Recruitment', 'Sales Director'] },
  new_region: { functions: ['sales', 'operations', 'recruiting', 'support'], professions: ['regional managers', 'sales managers', 'operations specialists', 'recruiters'], seniorities: ['specialist', 'manager', 'lead'], minHeadcount: 4, maxHeadcount: 50, mode: 'project', expectedStartDays: 30, externalAgencyProbability: .70, decisionMakerRoles: ['HRD', 'Regional Director', 'Head of Recruitment'] },
  mass_hiring: { functions: ['operations', 'recruiting', 'hr'], professions: ['mass hiring roles', 'recruiters', 'HR coordinators'], seniorities: ['entry', 'specialist', 'manager'], minHeadcount: 30, maxHeadcount: 500, mode: 'mass', expectedStartDays: 7, externalAgencyProbability: .90, decisionMakerRoles: ['HRD', 'Head of Recruitment', 'Operations Director'] },
  urgent_hiring: { functions: ['target_roles', 'recruiting'], professions: ['priority vacancies'], seniorities: ['specialist', 'senior', 'lead'], minHeadcount: 1, maxHeadcount: 15, mode: 'targeted', expectedStartDays: 3, externalAgencyProbability: .78, decisionMakerRoles: ['HRD', 'Head of Recruitment', 'Hiring Manager'] },
}

export function forecastStaffing(
  signals: readonly NormalizedSignal[],
  now = new Date(),
): StaffingForecast | null {
  const applicable = signals
    .map((signal) => ({ signal, rule: STAFFING_RULES[signal.type] }))
    .filter((item): item is { signal: NormalizedSignal; rule: StaffingRule } => Boolean(item.rule))
    .sort((left, right) => staffingRuleWeight(right) - staffingRuleWeight(left) || left.signal.id.localeCompare(right.signal.id))
  if (applicable.length === 0) return null

  const primary = applicable[0]
  const supporting = applicable.filter((item) => item.signal.organizationId === primary.signal.organizationId)
  const functions = uniqueSorted(supporting.flatMap((item) => item.rule.functions))
  const professions = uniqueSorted(supporting.flatMap((item) => item.rule.professions))
  const seniorities = uniqueSorted(supporting.flatMap((item) => item.rule.seniorities))
  const minHeadcount = Math.max(primary.rule.minHeadcount, ...supporting.map((item) => item.rule.minHeadcount))
  const maxHeadcount = Math.max(primary.rule.maxHeadcount, ...supporting.map((item) => item.rule.maxHeadcount))
  const confidence = clamp01(
    supporting.reduce((sum, item) => sum + item.signal.confidence * item.signal.strength, 0) /
    supporting.reduce((sum, item) => sum + Math.max(item.signal.strength, .01), 0),
  )
  const expectedStartDays = primary.rule.expectedStartDays
  return {
    functions,
    professions,
    seniorities,
    minHeadcount,
    maxHeadcount,
    mode: primary.rule.mode,
    expectedStart: expectedStartDays == null
      ? null
      : new Date(now.getTime() + expectedStartDays * DAY_MS).toISOString(),
    city: primary.signal.city ?? null,
    federalSubjectCode: primary.signal.regionCode ?? null,
    externalAgencyProbability: round(Math.max(...supporting.map((item) => item.rule.externalAgencyProbability)), 3),
    decisionMakerRoles: uniqueSorted(supporting.flatMap((item) => item.rule.decisionMakerRoles)),
    basisSignalIds: supporting.map((item) => item.signal.id).sort(),
    confidence: round(confidence, 3),
  }
}

function staffingRuleWeight(item: { signal: NormalizedSignal; rule: StaffingRule }): number {
  const taxonomyDefinition = TAXONOMY_BY_TYPE.get(item.signal.type)
  return (taxonomyDefinition?.baseWeight ?? 0) * item.signal.confidence * item.signal.strength
}

export type EvidenceRadarLocation = {
  city: string
  federalSubjectCode: string
  federalSubjectName: string
  latitude: number
  longitude: number
  confidence: number
  locationType?: 'head_office' | 'office' | 'branch' | 'warehouse' | 'production' | 'service_center'
  address?: string | null
}

export type EvidenceRadarMetadata = {
  version: typeof EVIDENCE_RADAR_VERSION
  location: EvidenceRadarLocation
  hiringIntent: number
  freshness: number
  risk: number
  independentSourceCount: number
  specialization: string
  legalName: string | null
  brand: string | null
  staffingNeed: StaffingForecast | null
  contactPaths: Array<{ type: 'company_form' | 'corporate_email' | 'generic_hr_email' | 'switchboard' | 'official_channel'; label: string; href: string | null }>
  riskReasons: string[]
  evidenceEventIds: string[]
}

export function buildEvidenceRadarMetadata(input: {
  location: EvidenceRadarLocation
  hiringIntent: number
  freshness: number
  risk: number
  independentSourceCount: number
  specialization: string
  legalName?: string | null
  brand?: string | null
  staffingNeed?: StaffingForecast | null
  contactPaths?: EvidenceRadarMetadata['contactPaths']
  riskReasons?: readonly string[]
  evidenceEventIds?: readonly string[]
}): EvidenceRadarMetadata {
  projectRussianCoordinates(input.location.latitude, input.location.longitude)
  if (!input.location.city.trim() || !input.location.federalSubjectCode.trim() || !input.location.federalSubjectName.trim()) {
    throw new Error('verified geography requires city, federal subject code and name')
  }
  if (!Number.isInteger(input.independentSourceCount) || input.independentSourceCount < 1) {
    throw new Error('independentSourceCount must be a positive integer')
  }
  const contactPaths = input.contactPaths ?? []
  for (const contact of contactPaths) {
    if (!contact.label.trim()) throw new Error('contact path label is required')
    if (contact.href && !isSafeCompanyContactHref(contact.href)) throw new Error('unsupported contact path')
  }
  return {
    version: EVIDENCE_RADAR_VERSION,
    location: { ...input.location, confidence: clamp01(input.location.confidence) },
    hiringIntent: clamp01(input.hiringIntent),
    freshness: clamp01(input.freshness),
    risk: clamp01(input.risk),
    independentSourceCount: input.independentSourceCount,
    specialization: input.specialization.trim().slice(0, 120) || 'unknown',
    legalName: input.legalName?.trim() || null,
    brand: input.brand?.trim() || null,
    staffingNeed: input.staffingNeed ?? null,
    contactPaths: contactPaths.map((item) => ({ ...item })),
    riskReasons: uniqueSorted(input.riskReasons ?? []),
    evidenceEventIds: uniqueSorted(input.evidenceEventIds ?? []),
  }
}

export function parseEvidenceRadarMetadata(value: unknown): EvidenceRadarMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.version !== EVIDENCE_RADAR_VERSION) return null
  const location = parseLocation(record.location)
  if (!location) return null
  const hiringIntent = boundedNumber(record.hiringIntent)
  const freshness = boundedNumber(record.freshness)
  const risk = boundedNumber(record.risk)
  const sourceCount = typeof record.independentSourceCount === 'number' && Number.isInteger(record.independentSourceCount) && record.independentSourceCount >= 1
    ? record.independentSourceCount : null
  const specialization = typeof record.specialization === 'string' ? record.specialization.trim() : ''
  if (hiringIntent == null || freshness == null || risk == null || sourceCount == null || !specialization) return null
  try {
    return buildEvidenceRadarMetadata({
      location,
      hiringIntent,
      freshness,
      risk,
      independentSourceCount: sourceCount,
      specialization,
      legalName: typeof record.legalName === 'string' ? record.legalName : null,
      brand: typeof record.brand === 'string' ? record.brand : null,
      staffingNeed: parseStaffingForecast(record.staffingNeed),
      contactPaths: parseContactPaths(record.contactPaths),
      riskReasons: stringArray(record.riskReasons),
      evidenceEventIds: stringArray(record.evidenceEventIds),
    })
  } catch {
    return null
  }
}

function parseLocation(value: unknown): EvidenceRadarLocation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.city !== 'string' || typeof record.federalSubjectCode !== 'string' || typeof record.federalSubjectName !== 'string') return null
  if (typeof record.latitude !== 'number' || typeof record.longitude !== 'number' || typeof record.confidence !== 'number') return null
  return {
    city: record.city,
    federalSubjectCode: record.federalSubjectCode,
    federalSubjectName: record.federalSubjectName,
    latitude: record.latitude,
    longitude: record.longitude,
    confidence: record.confidence,
    locationType: isLocationType(record.locationType) ? record.locationType : undefined,
    address: typeof record.address === 'string' ? record.address : null,
  }
}

function parseStaffingForecast(value: unknown): StaffingForecast | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const mode = record.mode === 'targeted' || record.mode === 'project' || record.mode === 'mass' ? record.mode : null
  if (!mode || typeof record.minHeadcount !== 'number' || typeof record.maxHeadcount !== 'number') return null
  if (record.minHeadcount < 0 || record.maxHeadcount < record.minHeadcount) return null
  const probability = boundedNumber(record.externalAgencyProbability)
  const confidence = boundedNumber(record.confidence)
  if (probability == null || confidence == null) return null
  return {
    functions: stringArray(record.functions), professions: stringArray(record.professions), seniorities: stringArray(record.seniorities),
    minHeadcount: Math.trunc(record.minHeadcount), maxHeadcount: Math.trunc(record.maxHeadcount), mode,
    expectedStart: typeof record.expectedStart === 'string' ? record.expectedStart : null,
    city: typeof record.city === 'string' ? record.city : null,
    federalSubjectCode: typeof record.federalSubjectCode === 'string' ? record.federalSubjectCode : null,
    externalAgencyProbability: probability,
    decisionMakerRoles: stringArray(record.decisionMakerRoles),
    basisSignalIds: stringArray(record.basisSignalIds),
    confidence,
  }
}

function parseContactPaths(value: unknown): EvidenceRadarMetadata['contactPaths'] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const record = item as Record<string, unknown>
    const type = record.type
    if (type !== 'company_form' && type !== 'corporate_email' && type !== 'generic_hr_email' && type !== 'switchboard' && type !== 'official_channel') return []
    if (typeof record.label !== 'string') return []
    const href = typeof record.href === 'string' ? record.href : null
    return [{ type, label: record.label, href }]
  })
}

export function projectRussianCoordinates(latitude: number, longitude: number): { x: number; y: number } {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('coordinates must be finite')
  const normalizedLongitude = longitude < 0 ? longitude + 360 : longitude
  if (latitude < 41 || latitude > 82 || normalizedLongitude < 19 || normalizedLongitude > 190) {
    throw new Error('coordinates are outside supported Russian geography')
  }
  const x = ((normalizedLongitude - 19) / (190 - 19)) * 100
  const y = ((82 - latitude) / (82 - 41)) * 100
  return { x: round(x, 4), y: round(y, 4) }
}

function isSafeCompanyContactHref(value: string): boolean {
  if (value.startsWith('mailto:')) {
    const mailbox = value.slice('mailto:'.length).split('?')[0].trim().toLowerCase()
    return /^(info|hello|hr|jobs|career|careers|recruit|recruiting|talent|office|contact)@[^@\s]+$/.test(mailbox)
  }
  if (value.startsWith('tel:')) return true
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
  } catch {
    return false
  }
}

function isLocationType(value: unknown): value is NonNullable<EvidenceRadarLocation['locationType']> {
  return value === 'head_office' || value === 'office' || value === 'branch' || value === 'warehouse' || value === 'production' || value === 'service_center'
}

function canonicalizeUrl(value: string | null): string {
  if (!value) return ''
  try {
    const url = new URL(value)
    url.hash = ''
    ;['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'yclid', 'gclid'].forEach((key) => url.searchParams.delete(key))
    url.hostname = url.hostname.toLowerCase()
    return url.toString().replace(/\/$/, '')
  } catch {
    return value.trim().toLowerCase()
  }
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
}

function normalizedText(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[«»"'`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()
    : ''
}

function normalizeDigits(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\D/g, '') : ''
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return uniqueSorted(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))
}

function boundedNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

function uniqueById<T extends { id: string }>(values: readonly T[]): T[] {
  const map = new Map<string, T>()
  for (const value of values) map.set(value.id, value)
  return [...map.values()]
}

function groupBy<T, K>(values: readonly T[], key: (value: T) => K): Map<K, T[]> {
  const result = new Map<K, T[]>()
  for (const value of values) {
    const group = result.get(key(value)) ?? []
    group.push(value)
    result.set(key(value), group)
  }
  return result
}

function cartesian<T>(groups: readonly T[][]): T[][] {
  return groups.reduce<T[][]>((acc, group) => acc.flatMap((prefix) => group.map((item) => [...prefix, item])), [[]])
}

const DAY_MS = 86_400_000
