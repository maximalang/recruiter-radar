import { INDUSTRY_KEYWORDS } from '@/lib/clientProfiles'
import { hashCanonicalJson } from '@/lib/opportunities/canonical-hash'

import {
  ROLE_SEARCH_KEYWORDS,
  buildProfileKeywords,
  buildProfileSearchEnv,
  type ProfileSearchInput,
} from './search-query-builder'
import {
  computeClientQueryAdjustments,
  industryDemoteTerms,
  type ClientQueryAdjustments,
  type FeedbackPatternEvent,
} from './query-feedback-tuning'

export const QUERY_PLANNER_VERSION_V2 = 'query-planner-v2' as const
export const QUERY_PLANNER_GEOGRAPHY_VERSION_V2 =
  'rf-source-geography-v2-2026-08-04' as const

export const QUERY_PLANNER_V2_SOURCES = [
  'hh',
  'superjob',
  'habr-career',
  'rabota-rossii',
] as const

export type QueryPlannerV2Source = typeof QUERY_PLANNER_V2_SOURCES[number]
export type QueryPlanStatus = 'ready' | 'review' | 'blocked'
export type QueryPlanFrequency = 'daily'
export type QueryPlanRemoteRelation =
  | 'region_only'
  | 'region_or_remote'
  | 'remote_anywhere'
  | 'unspecified'

export type QueryPlanHistoricalYield = {
  fetchedRecords: number
  uniqueEvents: number
  uniqueCompanies: number
  episodes: number
  qualifiedOpportunities: number
  accepted: number
  contacted: number
  replied: number
  meetings: number
}

export type QueryPlannerV2ProfileInput = {
  workspaceId: string
  ownerId: string
  clientProfileId: string
  profileSnapshotHash: string
  roles: readonly string[]
  industries: readonly string[]
  excludedIndustries: readonly string[]
  includeKeywords: readonly string[]
  excludeKeywords: readonly string[]
  specialization: string | null
  targetCity: string | null
  preferredRegions: readonly string[]
  excludedLocations: readonly string[]
  targetSeniorities: readonly string[]
  remoteFriendly: boolean
  dailyDigestLimit: number
  feedbackEvents: readonly FeedbackPatternEvent[]
  historicalYield: QueryPlanHistoricalYield
  operatorSearchParams?: Partial<
    Record<QueryPlannerV2Source, Readonly<Record<string, string>>>
  >
}

export type QueryPlanGeography = {
  resolution: 'federal' | 'resolved' | 'unresolved' | 'excluded'
  requestedRegion: string | null
  canonicalRegion: string | null
  displayName: string | null
  hhAreaIds: string[]
  rabotaRossiiRegionCodes: string[]
  aliases: string[]
  remoteRelation: QueryPlanRemoteRelation
  mappingVersion: typeof QUERY_PLANNER_GEOGRAPHY_VERSION_V2
}

export type ProfileScopedQueryPlanV2 = {
  plannerVersion: typeof QUERY_PLANNER_VERSION_V2
  geographyVersion: typeof QUERY_PLANNER_GEOGRAPHY_VERSION_V2
  workspaceId: string
  ownerId: string
  clientProfileId: string
  profileSnapshotHash: string
  source: QueryPlannerV2Source
  roleFamily: string
  roleSynonyms: string[]
  specializations: string[]
  region: QueryPlanGeography
  seniorities: string[]
  keywordCluster: string[]
  negativeTerms: string[]
  pageBudget: number
  frequency: QueryPlanFrequency
  profileConsumers: string[]
  historicalYield: QueryPlanHistoricalYield
  feedbackAdjustments: ClientQueryAdjustments
  queryEnv: Record<string, string>
  status: QueryPlanStatus
  reasonCodes: string[]
  feedbackHash: string
  planIdentity: string
  inputHash: string
  sharedRequestHash: string
}

export type SharedQueryPlanV2 = {
  source: QueryPlannerV2Source
  sharedRequestHash: string
  queryEnv: Record<string, string>
  pageBudget: number
  frequency: QueryPlanFrequency
  planIdentities: string[]
  profileConsumers: string[]
}

export type QueryPlanMetricCounts = QueryPlanHistoricalYield & {
  executionCount: number
  zeroResultExecutions: number
}

export type QueryPlanMetrics = QueryPlanMetricCounts & {
  duplicateRate: number | null
  zeroResultRate: number | null
  qualifiedRate: number | null
  acceptedRate: number | null
  contactedRate: number | null
  replyRate: number | null
  meetingRate: number | null
}

type RegionDefinition = {
  canonicalRegion: string
  displayName: string
  hhAreaIds: readonly string[]
  rabotaRossiiRegionCodes: readonly string[]
  aliases: readonly string[]
}

// HH IDs were verified against the official /areas/113 directory. The
// corresponding Rabota Rossii codes are the federal-subject region_code values
// already used by the official open-data adapter. Unknown names fail closed.
// Sources:
// - https://api.hh.ru/openapi/redoc (GET /areas and vacancy search `area`)
// - https://trudvsem.ru/opendata/api (`/vacancies/region/{region_code}`)
const RF_REGIONS: readonly RegionDefinition[] = [
  region('moscow', 'Москва', '1', '7700000000000', [
    'москва', 'мск', 'г москва', 'moscow',
  ]),
  region('saint-petersburg', 'Санкт-Петербург', '2', '7800000000000', [
    'санкт петербург', 'санкт-петербург', 'спб', 'петербург',
  ]),
  region('moscow-oblast', 'Московская область', '2019', '5000000000000', [
    'московская область', 'подмосковье', 'мо',
  ]),
  region('sverdlovsk-oblast', 'Свердловская область', '1261', '6600000000000', [
    'свердловская область', 'екатеринбург',
  ]),
  region('novosibirsk-oblast', 'Новосибирская область', '1202', '5400000000000', [
    'новосибирская область', 'новосибирск',
  ]),
  region('tatarstan', 'Республика Татарстан', '1624', '1600000000000', [
    'республика татарстан', 'татарстан', 'казань',
  ]),
  region('krasnodar-krai', 'Краснодарский край', '1438', '2300000000000', [
    'краснодарский край', 'краснодар', 'кубань',
  ]),
  region('bashkortostan', 'Республика Башкортостан', '1347', '0200000000000', [
    'республика башкортостан', 'башкортостан', 'башкирия', 'уфа',
  ]),
  region('chelyabinsk-oblast', 'Челябинская область', '1384', '7400000000000', [
    'челябинская область', 'челябинск',
  ]),
  region('samara-oblast', 'Самарская область', '1586', '6300000000000', [
    'самарская область', 'самара',
  ]),
  region('nizhny-novgorod-oblast', 'Нижегородская область', '1679', '5200000000000', [
    'нижегородская область', 'нижний новгород',
  ]),
  region('rostov-oblast', 'Ростовская область', '1530', '6100000000000', [
    'ростовская область', 'ростов на дону', 'ростов-на-дону',
  ]),
]

const REGION_BY_ALIAS = new Map<string, RegionDefinition>()
for (const definition of RF_REGIONS) {
  for (const alias of [definition.displayName, ...definition.aliases]) {
    REGION_BY_ALIAS.set(normalizeLookup(alias), definition)
  }
}

const SOURCE_PAGE_BUDGET: Readonly<Record<QueryPlannerV2Source, number>> = {
  hh: 3,
  superjob: 3,
  'habr-career': 3,
  'rabota-rossii': 5,
}

const SOURCE_ALLOWED_OVERRIDE_KEYS: Readonly<
  Record<QueryPlannerV2Source, ReadonlySet<string>>
> = {
  hh: new Set(['HH_SEARCH_TEXT', 'HH_AREA', 'HH_PAGES', 'HH_PER_PAGE']),
  superjob: new Set([
    'SUPERJOB_KEYWORD', 'SUPERJOB_TOWN', 'SUPERJOB_PAGES', 'SUPERJOB_PER_PAGE',
  ]),
  'habr-career': new Set([
    'HABR_CAREER_KEYWORD', 'HABR_CAREER_KEYWORDS', 'HABR_CAREER_CITY',
    'HABR_CAREER_REMOTE', 'HABR_CAREER_PAGES',
  ]),
  'rabota-rossii': new Set([
    'RABOTA_ROSSII_SEARCH_TEXT', 'RABOTA_ROSSII_REGION_CODE',
    'RABOTA_ROSSII_REGION_CODES', 'RABOTA_ROSSII_PAGES',
    'RABOTA_ROSSII_LIMIT',
  ]),
}

export function resolveQueryPlanGeography(input: {
  requestedRegion: string | null
  excludedRegions: readonly string[]
  remoteFriendly: boolean
}): QueryPlanGeography {
  const requested = cleanText(input.requestedRegion)
  const remoteRelation = resolveRemoteRelation(requested, input.remoteFriendly)
  if (!requested) {
    return {
      resolution: 'federal',
      requestedRegion: null,
      canonicalRegion: 'russia',
      displayName: 'Россия',
      hhAreaIds: ['113'],
      rabotaRossiiRegionCodes: [],
      aliases: ['россия', 'рф', 'russia'],
      remoteRelation,
      mappingVersion: QUERY_PLANNER_GEOGRAPHY_VERSION_V2,
    }
  }

  const definition = REGION_BY_ALIAS.get(normalizeLookup(requested))
  if (!definition) {
    return {
      resolution: 'unresolved',
      requestedRegion: requested,
      canonicalRegion: null,
      displayName: requested,
      hhAreaIds: [],
      rabotaRossiiRegionCodes: [],
      aliases: [],
      remoteRelation,
      mappingVersion: QUERY_PLANNER_GEOGRAPHY_VERSION_V2,
    }
  }

  const excluded = input.excludedRegions.some((value) => {
    const excludedDefinition = REGION_BY_ALIAS.get(normalizeLookup(value))
    return excludedDefinition?.canonicalRegion === definition.canonicalRegion ||
      normalizeLookup(value) === normalizeLookup(requested)
  })
  return {
    resolution: excluded ? 'excluded' : 'resolved',
    requestedRegion: requested,
    canonicalRegion: definition.canonicalRegion,
    displayName: definition.displayName,
    hhAreaIds: excluded ? [] : [...definition.hhAreaIds],
    rabotaRossiiRegionCodes: excluded
      ? [] : [...definition.rabotaRossiiRegionCodes],
    aliases: [...definition.aliases],
    remoteRelation,
    mappingVersion: QUERY_PLANNER_GEOGRAPHY_VERSION_V2,
  }
}

export function buildProfileScopedQueryPlans(input: {
  profiles: readonly QueryPlannerV2ProfileInput[]
  sources?: readonly QueryPlannerV2Source[]
}): ProfileScopedQueryPlanV2[] {
  const sources = uniqueStrings(input.sources ?? QUERY_PLANNER_V2_SOURCES)
    .filter((source): source is QueryPlannerV2Source =>
      (QUERY_PLANNER_V2_SOURCES as readonly string[]).includes(source))
  const plans: ProfileScopedQueryPlanV2[] = []
  for (const rawProfile of input.profiles) {
    const profile = normalizeProfile(rawProfile)
    const roleFamilies = profile.roles.length > 0 ? profile.roles : ['general']
    const requestedRegions = profile.preferredRegions.length > 0
      ? profile.preferredRegions
      : [profile.targetCity]
    const feedbackAdjustments = computeClientQueryAdjustments(
      profile.feedbackEvents,
    )
    const feedbackHash = hashCanonicalJson(profile.feedbackEvents)
    const demoteTerms = industryDemoteTerms(feedbackAdjustments)
    const negativeTerms = buildNegativeTerms(profile)

    for (const source of sources) {
      for (const roleFamily of roleFamilies) {
        for (const requestedRegion of requestedRegions) {
          const geography = resolveQueryPlanGeography({
            requestedRegion,
            excludedRegions: profile.excludedLocations,
            remoteFriendly: profile.remoteFriendly,
          })
          plans.push(buildPlan({
            profile,
            source,
            roleFamily,
            geography,
            feedbackAdjustments,
            feedbackHash,
            demoteTerms,
            negativeTerms,
          }))
        }
      }
    }
  }
  return plans.sort(comparePlans)
}

export function groupSharedQueryPlans(
  plans: readonly ProfileScopedQueryPlanV2[],
): SharedQueryPlanV2[] {
  const groups = new Map<string, SharedQueryPlanV2>()
  for (const plan of plans) {
    if (plan.status !== 'ready') continue
    const key = `${plan.source}:${plan.sharedRequestHash}`
    const existing = groups.get(key)
    if (existing) {
      existing.planIdentities = uniqueStrings([
        ...existing.planIdentities,
        plan.planIdentity,
      ]).sort()
      existing.profileConsumers = uniqueStrings([
        ...existing.profileConsumers,
        ...plan.profileConsumers,
      ]).sort(compareIds)
      continue
    }
    groups.set(key, {
      source: plan.source,
      sharedRequestHash: plan.sharedRequestHash,
      queryEnv: { ...plan.queryEnv },
      pageBudget: plan.pageBudget,
      frequency: plan.frequency,
      planIdentities: [plan.planIdentity],
      profileConsumers: [...plan.profileConsumers],
    })
  }
  return [...groups.values()].sort((a, b) =>
    a.source.localeCompare(b.source) ||
    a.sharedRequestHash.localeCompare(b.sharedRequestHash))
}

export function buildQueryPlanMetrics(
  raw: QueryPlanMetricCounts,
): QueryPlanMetrics {
  const counts = normalizeMetricCounts(raw)
  return {
    ...counts,
    duplicateRate: rate(
      counts.fetchedRecords - counts.uniqueEvents,
      counts.fetchedRecords,
    ),
    zeroResultRate: rate(
      counts.zeroResultExecutions,
      counts.executionCount,
    ),
    qualifiedRate: rate(counts.qualifiedOpportunities, counts.episodes),
    acceptedRate: rate(counts.accepted, counts.qualifiedOpportunities),
    contactedRate: rate(counts.contacted, counts.accepted),
    replyRate: rate(counts.replied, counts.contacted),
    meetingRate: rate(counts.meetings, counts.replied),
  }
}

function buildPlan(input: {
  profile: QueryPlannerV2ProfileInput
  source: QueryPlannerV2Source
  roleFamily: string
  geography: QueryPlanGeography
  feedbackAdjustments: ClientQueryAdjustments
  feedbackHash: string
  demoteTerms: ReadonlySet<string>
  negativeTerms: string[]
}): ProfileScopedQueryPlanV2 {
  const roleSynonyms = input.roleFamily === 'general'
    ? [] : [...(ROLE_SEARCH_KEYWORDS[input.roleFamily] ?? [])]
  const specializations = uniqueStrings([
    input.profile.specialization ?? '',
    ...input.profile.industries,
  ].map(normalizeText).filter(Boolean))
  const profileSearchInput: ProfileSearchInput = {
    roles: input.roleFamily === 'general' ? [] : [input.roleFamily],
    industries: input.profile.industries,
    excludedIndustries: input.profile.excludedIndustries,
    includeKeywords: [
      ...input.profile.includeKeywords,
      ...(input.profile.specialization ? [input.profile.specialization] : []),
    ],
    excludeKeywords: input.profile.excludeKeywords,
    targetCity: input.geography.displayName,
  }
  const keywordCluster = buildProfileKeywordsForPlan(
    profileSearchInput,
    input.demoteTerms,
  )
  const defaultPageBudget = SOURCE_PAGE_BUDGET[input.source]
  const queryEnv = buildSourceQueryEnv({
    source: input.source,
    profileSearchInput,
    geography: input.geography,
    demoteTerms: input.demoteTerms,
    pageBudget: defaultPageBudget,
    operatorOverrides: input.profile.operatorSearchParams?.[input.source],
  })
  const pageBudget = resolveEffectivePageBudget(
    input.source,
    queryEnv,
    defaultPageBudget,
  )
  const reasonCodes: string[] = []
  let status: QueryPlanStatus = 'ready'
  if (input.geography.resolution === 'excluded') {
    status = 'blocked'
    reasonCodes.push('GEOGRAPHY_EXCLUDED')
  } else if (input.geography.resolution === 'unresolved') {
    status = 'review'
    reasonCodes.push('GEOGRAPHY_UNRESOLVED')
  }
  if (keywordCluster.length === 0) {
    status = status === 'blocked' ? 'blocked' : 'review'
    reasonCodes.push('KEYWORD_CLUSTER_EMPTY')
  }

  const planIdentity = hashCanonicalJson({
    plannerVersion: QUERY_PLANNER_VERSION_V2,
    workspaceId: input.profile.workspaceId,
    clientProfileId: input.profile.clientProfileId,
    source: input.source,
    roleFamily: input.roleFamily,
    canonicalRegion: input.geography.canonicalRegion,
    requestedRegion: input.geography.requestedRegion,
  })
  const sharedRequestHash = hashCanonicalJson({
    source: input.source,
    queryEnv,
    pageBudget,
    frequency: 'daily',
  })
  const snapshot = {
    plannerVersion: QUERY_PLANNER_VERSION_V2,
    geographyVersion: QUERY_PLANNER_GEOGRAPHY_VERSION_V2,
    workspaceId: input.profile.workspaceId,
    ownerId: input.profile.ownerId,
    clientProfileId: input.profile.clientProfileId,
    profileSnapshotHash: input.profile.profileSnapshotHash,
    source: input.source,
    roleFamily: input.roleFamily,
    roleSynonyms,
    specializations,
    region: input.geography,
    seniorities: [...input.profile.targetSeniorities],
    keywordCluster,
    negativeTerms: input.negativeTerms,
    pageBudget,
    frequency: 'daily' as const,
    profileConsumers: [input.profile.clientProfileId],
    historicalYield: input.profile.historicalYield,
    feedbackAdjustments: input.feedbackAdjustments,
    queryEnv,
    status,
    reasonCodes,
    feedbackHash: input.feedbackHash,
    planIdentity,
    sharedRequestHash,
  }
  return {
    ...snapshot,
    inputHash: hashCanonicalJson(snapshot),
  }
}

function buildProfileKeywordsForPlan(
  input: ProfileSearchInput,
  demoteTerms: ReadonlySet<string>,
): string[] {
  return buildProfileKeywords(input, demoteTerms)
}

function buildSourceQueryEnv(input: {
  source: QueryPlannerV2Source
  profileSearchInput: ProfileSearchInput
  geography: QueryPlanGeography
  demoteTerms: ReadonlySet<string>
  pageBudget: number
  operatorOverrides?: Readonly<Record<string, string>>
}): Record<string, string> {
  const env = buildProfileSearchEnv(
    input.source,
    input.profileSearchInput,
    input.demoteTerms,
  )
  delete env.RABOTA_ROSSII_REGION
  if (input.source === 'hh') {
    env.HH_PAGES = String(input.pageBudget)
    if (input.geography.hhAreaIds.length > 0) {
      env.HH_AREA = input.geography.hhAreaIds.join(',')
    }
  } else if (input.source === 'superjob') {
    env.SUPERJOB_PAGES = String(input.pageBudget)
    if (input.geography.resolution === 'resolved' && input.geography.displayName) {
      env.SUPERJOB_TOWN = input.geography.displayName
    }
  } else if (input.source === 'habr-career') {
    env.HABR_CAREER_PAGES = String(input.pageBudget)
    if (input.geography.resolution === 'resolved' && input.geography.displayName) {
      env.HABR_CAREER_CITY = input.geography.displayName
    }
    if (input.geography.remoteRelation === 'region_or_remote' ||
        input.geography.remoteRelation === 'remote_anywhere') {
      env.HABR_CAREER_REMOTE = 'true'
    }
  } else {
    env.RABOTA_ROSSII_PAGES = String(input.pageBudget)
    if (input.geography.rabotaRossiiRegionCodes.length > 0) {
      env.RABOTA_ROSSII_REGION_CODES =
        input.geography.rabotaRossiiRegionCodes.join(',')
    }
  }
  return {
    ...env,
    ...validatedOverrides(input.source, input.operatorOverrides),
  }
}

function validatedOverrides(
  source: QueryPlannerV2Source,
  overrides: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  if (!overrides) return {}
  const allowed = SOURCE_ALLOWED_OVERRIDE_KEYS[source]
  const result: Record<string, string> = {}
  for (const [key, rawValue] of Object.entries(overrides)) {
    const value = cleanText(rawValue)
    if (allowed.has(key) && value) result[key] = value
  }
  return result
}

function resolveEffectivePageBudget(
  source: QueryPlannerV2Source,
  queryEnv: Record<string, string>,
  fallback: number,
): number {
  const key: Record<QueryPlannerV2Source, string> = {
    hh: 'HH_PAGES',
    superjob: 'SUPERJOB_PAGES',
    'habr-career': 'HABR_CAREER_PAGES',
    'rabota-rossii': 'RABOTA_ROSSII_PAGES',
  }
  const value = Number(queryEnv[key[source]])
  const budget = Number.isInteger(value) && value >= 1 && value <= 50
    ? value : fallback
  queryEnv[key[source]] = String(budget)
  return budget
}

function buildNegativeTerms(profile: QueryPlannerV2ProfileInput): string[] {
  const terms = [...profile.excludeKeywords]
  for (const industry of profile.excludedIndustries) {
    const mapped = INDUSTRY_KEYWORDS.get(industry)
    if (mapped) terms.push(...mapped)
  }
  return uniqueStrings(terms.map(normalizeText).filter(Boolean))
}

function normalizeProfile(
  profile: QueryPlannerV2ProfileInput,
): QueryPlannerV2ProfileInput {
  return {
    ...profile,
    workspaceId: positiveId(profile.workspaceId, 'workspace ID'),
    ownerId: positiveId(profile.ownerId, 'owner ID'),
    clientProfileId: positiveId(profile.clientProfileId, 'client profile ID'),
    profileSnapshotHash: sha256(profile.profileSnapshotHash, 'profile snapshot hash'),
    roles: uniqueStrings(profile.roles.map(normalizeText).filter(Boolean)),
    industries: uniqueStrings(profile.industries.map(normalizeText).filter(Boolean)),
    excludedIndustries: uniqueStrings(
      profile.excludedIndustries.map(normalizeText).filter(Boolean),
    ),
    includeKeywords: uniqueStrings(
      profile.includeKeywords.map(cleanText).filter(isText),
    ),
    excludeKeywords: uniqueStrings(
      profile.excludeKeywords.map(cleanText).filter(isText),
    ),
    specialization: cleanText(profile.specialization),
    targetCity: cleanText(profile.targetCity),
    preferredRegions: uniqueStrings(
      profile.preferredRegions.map(cleanText).filter(isText),
    ),
    excludedLocations: uniqueStrings(
      profile.excludedLocations.map(cleanText).filter(isText),
    ),
    targetSeniorities: uniqueStrings(
      profile.targetSeniorities.map(normalizeText).filter(Boolean),
    ),
    dailyDigestLimit: positiveInteger(
      profile.dailyDigestLimit,
      'daily digest limit',
    ),
    feedbackEvents: profile.feedbackEvents
      .map((event) => ({ ...event }))
      .sort((a, b) =>
        (a.industry ?? '').localeCompare(b.industry ?? '') ||
        (a.role ?? '').localeCompare(b.role ?? '') ||
        a.sentiment.localeCompare(b.sentiment)),
    historicalYield: normalizeHistoricalYield(profile.historicalYield),
  }
}

function normalizeHistoricalYield(
  raw: QueryPlanHistoricalYield,
): QueryPlanHistoricalYield {
  return {
    fetchedRecords: count(raw.fetchedRecords, 'fetched records'),
    uniqueEvents: count(raw.uniqueEvents, 'unique events'),
    uniqueCompanies: count(raw.uniqueCompanies, 'unique companies'),
    episodes: count(raw.episodes, 'episodes'),
    qualifiedOpportunities: count(
      raw.qualifiedOpportunities,
      'qualified opportunities',
    ),
    accepted: count(raw.accepted, 'accepted'),
    contacted: count(raw.contacted, 'contacted'),
    replied: count(raw.replied, 'replied'),
    meetings: count(raw.meetings, 'meetings'),
  }
}

function normalizeMetricCounts(raw: QueryPlanMetricCounts): QueryPlanMetricCounts {
  return {
    executionCount: count(raw.executionCount, 'execution count'),
    zeroResultExecutions: count(
      raw.zeroResultExecutions,
      'zero-result executions',
    ),
    ...normalizeHistoricalYield(raw),
  }
}

function resolveRemoteRelation(
  requestedRegion: string | null,
  remoteFriendly: boolean,
): QueryPlanRemoteRelation {
  if (remoteFriendly) return requestedRegion ? 'region_or_remote' : 'remote_anywhere'
  return requestedRegion ? 'region_only' : 'unspecified'
}

function region(
  canonicalRegion: string,
  displayName: string,
  hhAreaId: string,
  rabotaRossiiRegionCode: string,
  aliases: readonly string[],
): RegionDefinition {
  return {
    canonicalRegion,
    displayName,
    hhAreaIds: [hhAreaId],
    rabotaRossiiRegionCodes: [rabotaRossiiRegionCode],
    aliases,
  }
}

function comparePlans(a: ProfileScopedQueryPlanV2, b: ProfileScopedQueryPlanV2): number {
  return compareIds(a.workspaceId, b.workspaceId) ||
    compareIds(a.clientProfileId, b.clientProfileId) ||
    a.source.localeCompare(b.source) ||
    a.roleFamily.localeCompare(b.roleFamily) ||
    (a.region.canonicalRegion ?? '').localeCompare(b.region.canonicalRegion ?? '')
}

function compareIds(a: string, b: string): number {
  const left = BigInt(a)
  const right = BigInt(b)
  return left < right ? -1 : left > right ? 1 : 0
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const key = value.toLocaleLowerCase('ru-RU')
    if (!value || seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}

function normalizeLookup(value: unknown): string {
  return normalizeText(value)
    .replace(/\b(г|город|обл|область)\b/g, ' ')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
}

function cleanText(value: unknown): string | null {
  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ')
  return normalized || null
}

function isText(value: string | null): value is string {
  return value !== null
}

function positiveId(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim()
  if (!/^[1-9]\d{0,18}$/.test(normalized)) {
    throw new TypeError(`Invalid ${label}.`)
  }
  return normalized
}

function sha256(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError(`Invalid ${label}.`)
  }
  return normalized
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new TypeError(`Invalid ${label}.`)
  }
  return Number(value)
}

function count(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`Invalid ${label}.`)
  }
  return Number(value)
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return Math.round((numerator / denominator) * 100000) / 100000
}
