export const SOURCE_REGISTRY_VERSION = 'source-registry-v1-2026-08-07' as const

export const SOURCE_ROLES = [
  'hiring',
  'company_registry',
  'contracts_demand',
  'capital_corporate',
  'product_commercial',
  'technology',
  'people_organization',
  'physical_expansion',
  'media_social',
  'risk',
  'first_party',
] as const

export type SourceRole = (typeof SOURCE_ROLES)[number]
export type SourceAccessMethod =
  | 'official_api'
  | 'open_data'
  | 'rss'
  | 'webhook'
  | 'lawful_public_fetch'
  | 'manual'
  | 'contract_feed'
  | 'unavailable'
export type SourceCommercialUse =
  | 'published_allowance'
  | 'contract_required'
  | 'legal_review_required'
  | 'internal_first_party'
  | 'prohibited'
export type SourceAuthorization = 'none' | 'api_key' | 'oauth' | 'account' | 'contract'
export type SourceReliability = 'primary' | 'official_secondary' | 'secondary' | 'unverified'
export type SourceIntegrationStatus = 'connected' | 'prototype' | 'planned' | 'unavailable'
export type SourceLegalReviewStatus = 'pending' | 'approved' | 'contracted' | 'rejected' | 'not_applicable'
export type SourceAutomationPolicy = 'allow' | 'review_required' | 'block'
export type SourceCostClass = 'free' | 'low' | 'medium' | 'high' | 'contract'
export type SourceComplexity = 'low' | 'medium' | 'high'
export type SourcePhase = 'mvp' | 'phase2' | 'phase3'

export type SourceRegistryEntry = {
  id: string
  name: string
  role: SourceRole
  category: string
  accessMethod: SourceAccessMethod
  commercialUse: SourceCommercialUse
  authorization: SourceAuthorization
  requestLimits: string
  refreshCadence: string
  geography: string
  historicalDepth: string
  reliability: SourceReliability
  costClass: SourceCostClass
  entityMatchQuality: 'high' | 'medium' | 'low'
  status: SourceIntegrationStatus
  primaryEvidence: boolean
  attributionRequired: boolean
  personalDataRisk: 'none' | 'low' | 'medium' | 'high'
  retentionPolicy: string
  legalReviewStatus: SourceLegalReviewStatus
  termsReference: string | null
  reviewedAt: string | null
  automationPolicy: SourceAutomationPolicy
  phase: SourcePhase
  priority: number
  complexity: SourceComplexity
  notes: string
}

const source = (entry: SourceRegistryEntry): SourceRegistryEntry => entry

export const SOURCE_REGISTRY: readonly SourceRegistryEntry[] = [
  source({
    id: 'company-career-pages', name: 'Карьерные страницы компаний', role: 'hiring', category: 'Vacancies / employer-owned hiring surface',
    accessMethod: 'lawful_public_fetch', commercialUse: 'legal_review_required', authorization: 'none', requestLimits: 'Per-domain robots/terms and conservative crawl budget', refreshCadence: '6-24h', geography: 'Russia + employer coverage', historicalDepth: 'From first observation', reliability: 'primary', costClass: 'low', entityMatchQuality: 'high', status: 'connected', primaryEvidence: true, attributionRequired: true, personalDataRisk: 'low', retentionPolicy: 'Facts, canonical URL, timestamps and hashes; no unnecessary full-text archive', legalReviewStatus: 'pending', termsReference: null, reviewedAt: null, automationPolicy: 'review_required', phase: 'mvp', priority: 1, complexity: 'medium', notes: 'Adapter must respect per-domain technical and contractual controls.'
  }),
  source({
    id: 'public-ats', name: 'Публичные ATS endpoints', role: 'hiring', category: 'Employer ATS vacancy feeds',
    accessMethod: 'official_api', commercialUse: 'legal_review_required', authorization: 'none', requestLimits: 'Provider-specific documented limits only', refreshCadence: '6-24h', geography: 'Employer coverage', historicalDepth: 'Provider dependent', reliability: 'primary', costClass: 'low', entityMatchQuality: 'high', status: 'prototype', primaryEvidence: true, attributionRequired: true, personalDataRisk: 'low', retentionPolicy: 'Vacancy facts and source reference', legalReviewStatus: 'pending', termsReference: null, reviewedAt: null, automationPolicy: 'review_required', phase: 'mvp', priority: 2, complexity: 'medium', notes: 'Only documented public endpoints; no private ATS APIs.'
  }),
  source({
    id: 'headhunter-api', name: 'HeadHunter API', role: 'hiring', category: 'Vacancies and employer hiring activity',
    accessMethod: 'official_api', commercialUse: 'legal_review_required', authorization: 'oauth', requestLimits: 'Use published API limits and app-specific limits', refreshCadence: '2-6h', geography: 'Russia/CIS subject to API coverage', historicalDepth: 'API-dependent', reliability: 'official_secondary', costClass: 'low', entityMatchQuality: 'medium', status: 'connected', primaryEvidence: false, attributionRequired: true, personalDataRisk: 'medium', retentionPolicy: 'Company/vacancy facts only; no resume/candidate collection', legalReviewStatus: 'pending', termsReference: 'https://api.hh.ru/openapi/redoc', reviewedAt: null, automationPolicy: 'review_required', phase: 'mvp', priority: 1, complexity: 'medium', notes: 'Technical API reference is not itself a commercial-use approval.'
  }),
  source({
    id: 'rabota-rossii-open-data', name: 'Работа России — открытые данные', role: 'hiring', category: 'Official vacancy/open-data feed',
    accessMethod: 'open_data', commercialUse: 'legal_review_required', authorization: 'none', requestLimits: 'Published service limits', refreshCadence: '2-12h', geography: 'Russian Federation', historicalDepth: 'Dataset dependent', reliability: 'official_secondary', costClass: 'free', entityMatchQuality: 'medium', status: 'connected', primaryEvidence: false, attributionRequired: true, personalDataRisk: 'medium', retentionPolicy: 'Company/vacancy facts and source IDs; exclude unnecessary personal fields', legalReviewStatus: 'pending', termsReference: 'https://trudvsem.ru/opendata/api', reviewedAt: null, automationPolicy: 'review_required', phase: 'mvp', priority: 1, complexity: 'low', notes: 'Open-data technical access still requires archived usage/retention review.'
  }),
  source({
    id: 'professional-job-boards', name: 'Профессиональные и отраслевые job boards', role: 'hiring', category: 'Specialized vacancy surfaces',
    accessMethod: 'manual', commercialUse: 'contract_required', authorization: 'account', requestLimits: 'No automation before provider agreement', refreshCadence: 'Manual until contracted', geography: 'Provider dependent', historicalDepth: 'Provider dependent', reliability: 'secondary', costClass: 'contract', entityMatchQuality: 'medium', status: 'planned', primaryEvidence: false, attributionRequired: true, personalDataRisk: 'medium', retentionPolicy: 'No automated retention before contract', legalReviewStatus: 'pending', termsReference: null, reviewedAt: null, automationPolicy: 'block', phase: 'phase2', priority: 6, complexity: 'high', notes: 'Includes specialized and regional boards; each provider requires its own review.'
  }),
  source({
    id: 'public-vacancy-social-channels', name: 'Публичные каналы вакансий', role: 'hiring', category: 'Public Telegram/VK vacancy evidence',
    accessMethod: 'manual', commercialUse: 'legal_review_required', authorization: 'none', requestLimits: 'Manual review by default', refreshCadence: 'Manual', geography: 'Channel dependent', historicalDepth: 'Public history only', reliability: 'unverified', costClass: 'low', entityMatchQuality: 'low', status: 'planned', primaryEvidence: false, attributionRequired: true, personalDataRisk: 'high', retentionPolicy: 'Factual company-level signals only; no personal contact harvesting', legalReviewStatus: 'pending', termsReference: null, reviewedAt: null, automationPolicy: 'block', phase: 'phase3', priority: 10, complexity: 'high', notes: 'Never use private groups/accounts or personal-profile enrichment.'
  }),
  source({
    id: 'egrul-egrip', name: 'ЕГРЮЛ / ЕГРИП', role: 'company_registry', category: 'Canonical legal identity',
    accessMethod: 'open_data', commercialUse: 'legal_review_required', authorization: 'none', requestLimits: 'Use official published datasets/service limits', refreshCadence: 'Daily/weekly depending dataset', geography: 'Russian Federation', historicalDepth: 'Official dataset dependent', reliability: 'primary', costClass: 'free', entityMatchQuality: 'high', status: 'planned', primaryEvidence: true, attributionRequired: true, personalDataRisk: 'medium', retentionPolicy: 'Legal-entity fields needed for resolution; minimize natural-person fields', legalReviewStatus: 'pending', termsReference: 'https://www.nalog.gov.ru/', reviewedAt: null, automationPolicy: 'review_required', phase: 'mvp', priority: 1, complexity: 'medium', notes: 'Use as authoritative identity layer, not as a hiring signal by itself.'
  }),
  source({
    id: 'sme-registry', name: 'Единый реестр субъектов МСП', role: 'company_registry', category: 'Company size / registry context',
    accessMethod: 'open_data', commercialUse: 'legal_review_required', authorization: 'none', requestLimits: 'Official publication limits', refreshCadence: 'Monthly/dataset cadence', geography: 'Russian Federation', historicalDepth: 'Publication dependent', reliability: 'primary', costClass: 'free', entityMatchQuality: 'high', status: 'planned', primaryEvidence: true, attributionRequired: true, personalDataRisk: 'medium', retentionPolicy: 'Company-level registry facts', legalReviewStatus: 'pending', termsReference: 'https://rmsp.nalog.ru/', reviewedAt: null, automationPolicy: 'review_required', phase: 'phase2', priority: 4, complexity: 'medium', notes: 'Supports size/segment context and entity resolution.'
  }),
  source({
    id: 'official-address-license-registers', name: 'Адресные, лицензионные и аккредитационные реестры', role: 'company_registry', category: 'Branches, addresses, licenses and accreditations',
    accessMethod: 'open_data', commercialUse: 'legal_review_required', authorization: 'none', requestLimits: 'Registry-specific', refreshCadence: 'Weekly/monthly', geography: 'Russian Federation', historicalDepth: 'Registry dependent', reliability: 'primary', costClass: 'free', entityMatchQuality: 'high', status: 'planned', primaryEvidence: true, attributionRequired: true, personalDataRisk: 'medium', retentionPolicy: 'Company/object facts with source reference', legalReviewStatus: 'pending', termsReference: null, reviewedAt: null, automationPolicy: 'review_required', phase: 'phase2', priority: 5, complexity: 'high', notes: 'Each registry is a separate adapter and legal review unit.'
  }),
  source({
    id: 'eis-procurement', name: 'ЕИС / государственные закупки', role: 'contracts_demand', category: '44-ФЗ/223-ФЗ procurement and contract demand',
    accessMethod: 'open_data', commercialUse: 'legal_review_required', authorization: 'none', requestLimits: 'Official publication/service limits', refreshCadence: '2-12h', geography: 'Russian Federation', historicalDepth: 'Official archive dependent', reliability: 'primary', costClass: 'free', entityMatchQuality: 'high', status: 'planned', primaryEvidence: true, attributionRequired: true, personalDataRisk: 'low', retentionPolicy: 'Contract facts, identifiers, parties and canonical source', legalReviewStatus: 'pending', termsReference: 'https://zakupki.gov.ru/', reviewedAt: null, automationPolicy: 'review_required', phase: 'mvp', priority: 2, complexity: 'high', notes: 'Extract demand facts; do not infer staffing without corroborating evidence.'
  }),
  source({
    id: 'commercial-tenders', name: 'Коммерческие тендеры', role: 'contracts_demand', category: 'Commercial procurement / staffing tenders',
    accessMethod: 'contract_feed', commercialUse: 'contract_required', authorization: 'contract', requestLimits: 'Contract terms', refreshCadence: 'Contract dependent', geography: 'Provider dependent', historicalDepth: 'Contract dependent', reliability: 'official_secondary', costClass: 'contract', entityMatchQuality: 'medium', status: 'planned', primaryEvidence: true, attributionRequired: true, personalDataRisk: 'medium', retentionPolicy: 'Contract-defined', legalReviewStatus: 'pending', termsReference: null, reviewedAt: null, automationPolicy: 'block', phase: 'phase3', priority: 9, complexity: 'high', notes: 'No scraping substitute for a required commercial license.'
  }),
  source({
    id: 'issuer-disclosures', name: 'Существенные факты и раскрытие эмитентов', role: 'capital_corporate', category: 'Capital, M&A and material corporate events',
    accessMethod: 'lawful_public_fetch', commercialUse: 'legal_review_required', authorization: 'none', requestLimits: 'Publisher-specific', refreshCadence: '1-6h', geography: 'Russia / issuer coverage', historicalDepth: 'Publisher archive', reliability: 'primary', costClass: 'low', entityMatchQuality: 'high', status: 'planned', primaryEvidence: true, attributionRequired: true, personalDataRisk: 'low', retentionPolicy: 'Disclosure facts and canonical identifiers', legalReviewStatus: 'pending', termsReference: null, reviewedAt: null, automationPolicy: 'review_required', phase: 'phase2', priority: 4, complexity: 'medium', notes: 'Funding is context; require downstream hiring/expansion evidence for a lead.'
  }),
  source({
    id: 'funding-business-signals', name: 'Инвестиции, гранты и финансирование', role: 'capital_corporate', category: 'Funding / subsidy / financing context',
    accessMethod: 'manual', commercialUse: 'legal_review_required', authorization: 'none', requestLimits: 'Source-specific', refreshCadence: 'Daily', geography: 'Source dependent', historicalDepth: 'Source dependent', reliability: 'secondary', costClass: 'medium', entityMatchQuality: 'medium', status: 'prototype', primaryEvidence: false, attributionRequired: true, personalDataRisk: 'low', retentionPolicy: 'Factual transaction metadata and source reference', legalReviewStatus: 'pending', termsReference: null, reviewedAt: null, automationPolicy: 'block', phase: 'phase2', priority: 5, complexity: 'medium', notes: 'Prefer issuer/company/government primary source over media copy.'
  }),
  source({
    id: 'official-product-surfaces', name: 'Официальные продукты, changelog, API и документация', role: 'product_commercial', category: 'Product launch / commercial expansion evidence',
    accessMethod: 'lawful_public_fetch', commercialUse: 'legal_review_required', authorization: 'none', requestLimits: 'Per-domain controls', refreshCadence: 'Daily', geography: 'Company coverage', historicalDepth: 'From first observation / public archive', reliability: 'primary', costClass: 'low', entityMatchQuality: 'high', status: 'planned', primaryEvidence: true, attributionRequired: true, personalDataRisk: 'none', retentionPolicy: 'Diff facts, canonical URL and hashes', legalReviewStatus: 'pending', termsReference: null, reviewedAt: null, automationPolicy: 'review_required', phase: 'phase2', priority: 5, complexity: 'medium', notes: 'New product alone is not enough; correlate with team or demand expansion.'
  }),
  source({
    id: 'public-github-repositories', name: 'Публичные GitHub/GitLab репозитории', role: 'technology', category: 'Company-level technology activity',
    accessMethod: 'official_api', commercialUse: 'legal_review_required', authorization: 'api_key', requestLimits: 'Documented API rate limits', refreshCadence: '6-24h', geography: 'Global', historicalDepth: 'Repository history within policy', reliability: 'secondary', costClass: 'low', entityMatchQuality: 'medium', status: 'planned', primaryEvidence: false, attributionRequired: true, personalDataRisk: 'high', retentionPolicy: 'Aggregate organization/repository activity; no developer profiling', legalReviewStatus: 'pending', termsReference: 'https://docs.github.com/en/rest', reviewedAt: null, automationPolicy: 'review_required', phase: 'phase2', priority: 6, complexity: 'high', notes: 'Company-level aggregate only; public contributor activity is not a contact database.'
  }),
  source({
    id: 'domain-infrastructure', name: 'Домены, DNS, сертификаты и status pages', role: 'technology', category: 'Infrastructure expansion context',
    accessMethod: 'lawful_public_fetch', commercialUse: 'legal_review_required', authorization: 'none', requestLimits: 'Provider/domain specific', refreshCadence: 'Daily/weekly', geography: 'Global', historicalDepth: 'Observation dependent', reliability: 'secondary', costClass: 'low', entityMatchQuality: 'medium', status: 'planned', primaryEvidence: false, attributionRequired: true, personalDataRisk: 'low', retentionPolicy: 'Technical facts and hashes only', legalReviewStatus: 'pending', termsReference: null, reviewedAt: null, automationPolicy: 'review_required', phase: 'phase2', priority: 7, complexity: 'high', notes: 'Supporting context only; never a standalone hiring lead.'
  }),
  source({
    id: 'official-leadership-announcements', name: 'Официальные назначения и оргизменения', role: 'people_organization', category: 'Leadership / department changes',
    accessMethod: 'lawful_public_fetch', commercialUse: 'legal_review_required', authorization: 'none', requestLimits: 'Per-domain controls', refreshCadence: 'Daily', geography: 'Company coverage', historicalDepth: 'Public archive', reliability: 'primary', costClass: 'low', entityMatchQuality: 'high', status: 'planned', primaryEvidence: true, attributionRequired: true, personalDataRisk: 'medium', retentionPolicy: 'Role/name only when material and public; no private contact enrichment', legalReviewStatus: 'pending', termsReference: null, reviewedAt: null, automationPolicy: 'review_required', phase: 'phase2', priority: 5, complexity: 'medium', notes: 'A leadership change modifies context; combine with expansion/hiring evidence.'
  }),
  source({
    id: 'physical-expansion-registers', name: 'Открытия объектов, стройка и ввод мощностей', role: 'physical_expansion', category: 'Office/warehouse/production/R&D expansion',
    accessMethod: 'open_data', commercialUse: 'legal_review_required', authorization: 'none', requestLimits: 'Registry/provider specific', refreshCadence: 'Daily/weekly', geography: 'Russian Federation', historicalDepth: 'Registry dependent', reliability: 'primary', costClass: 'low', entityMatchQuality: 'medium', status: 'planned', primaryEvidence: true, attributionRequired: true, personalDataRisk: 'low', retentionPolicy: 'Object/address/company facts and primary-source reference', legalReviewStatus: 'pending', termsReference: null, reviewedAt: null, automationPolicy: 'review_required', phase: 'phase2', priority: 4, complexity: 'high', notes: 'Require resolved organization and object address before map placement.'
  }),
  source({
    id: 'official-company-news', name: 'Официальные новости и пресс-релизы компаний', role: 'media_social', category: 'Employer-owned business event evidence',
    accessMethod: 'lawful_public_fetch', commercialUse: 'legal_review_required', authorization: 'none', requestLimits: 'Per-domain controls', refreshCadence: '6-24h', geography: 'Company coverage', historicalDepth: 'Public archive / observation', reliability: 'primary', costClass: 'low', entityMatchQuality: 'high', status: 'connected', primaryEvidence: true, attributionRequired: true, personalDataRisk: 'low', retentionPolicy: 'Extracted facts, canonical URL, timestamps and hashes', legalReviewStatus: 'pending', termsReference: null, reviewedAt: null, automationPolicy: 'review_required', phase: 'mvp', priority: 2, complexity: 'medium', notes: 'Prefer primary announcement over media republication.'
  }),
  source({
    id: 'government-regional-news', name: 'Сайты администраций, министерств и инвестплощадок', role: 'media_social', category: 'Regional official expansion evidence',
    accessMethod: 'lawful_public_fetch', commercialUse: 'legal_review_required', authorization: 'none', requestLimits: 'Site-specific', refreshCadence: 'Daily', geography: 'Russian regions', historicalDepth: 'Public archive', reliability: 'official_secondary', costClass: 'low', entityMatchQuality: 'medium', status: 'planned', primaryEvidence: false, attributionRequired: true, personalDataRisk: 'low', retentionPolicy: 'Facts, identifiers and canonical source', legalReviewStatus: 'pending', termsReference: null, reviewedAt: null, automationPolicy: 'review_required', phase: 'phase2', priority: 5, complexity: 'high', notes: 'Useful corroboration for local projects and facilities.'
  }),
  source({
    id: 'industry-media', name: 'Деловые, отраслевые и региональные СМИ', role: 'media_social', category: 'Secondary event corroboration',
    accessMethod: 'manual', commercialUse: 'contract_required', authorization: 'account', requestLimits: 'No automated full-text collection without license', refreshCadence: 'Manual/contract feed', geography: 'Publisher dependent', historicalDepth: 'License dependent', reliability: 'secondary', costClass: 'contract', entityMatchQuality: 'medium', status: 'prototype', primaryEvidence: false, attributionRequired: true, personalDataRisk: 'medium', retentionPolicy: 'Facts and citation metadata; no republication', legalReviewStatus: 'pending', termsReference: null, reviewedAt: null, automationPolicy: 'block', phase: 'phase2', priority: 7, complexity: 'high', notes: 'Syndicated copies from the same origin are one confirmation.'
  }),
  source({
    id: 'official-risk-registers', name: 'Банкротство, суды, исполнительные и ликвидационные события', role: 'risk', category: 'Negative/risk evidence',
    accessMethod: 'open_data', commercialUse: 'legal_review_required', authorization: 'none', requestLimits: 'Registry-specific', refreshCadence: 'Daily', geography: 'Russian Federation', historicalDepth: 'Registry dependent', reliability: 'primary', costClass: 'low', entityMatchQuality: 'high', status: 'planned', primaryEvidence: true, attributionRequired: true, personalDataRisk: 'medium', retentionPolicy: 'Company-level risk facts and source identifiers', legalReviewStatus: 'pending', termsReference: null, reviewedAt: null, automationPolicy: 'review_required', phase: 'phase2', priority: 3, complexity: 'high', notes: 'Risk reduces score; never infer layoffs or insolvency without evidence.'
  }),
  source({
    id: 'first-party-crm', name: 'Recruiter Radar first-party CRM', role: 'first_party', category: 'Customer interactions, feedback and manual recruiter notes',
    accessMethod: 'webhook', commercialUse: 'internal_first_party', authorization: 'account', requestLimits: 'Product entitlement and tenant limits', refreshCadence: 'Event-driven', geography: 'Customer workspace', historicalDepth: 'Per retention policy', reliability: 'primary', costClass: 'free', entityMatchQuality: 'high', status: 'connected', primaryEvidence: false, attributionRequired: false, personalDataRisk: 'medium', retentionPolicy: 'Tenant-scoped product data; purpose limitation and configured retention', legalReviewStatus: 'not_applicable', termsReference: 'internal:first-party-data-policy', reviewedAt: '2026-08-07T00:00:00.000Z', automationPolicy: 'allow', phase: 'mvp', priority: 1, complexity: 'low', notes: 'First-party interest can strengthen timing but cannot replace external hiring evidence.'
  }),
]

export function getSourceRegistryEntry(id: string): SourceRegistryEntry | null {
  return SOURCE_REGISTRY.find((entry) => entry.id === id) ?? null
}

export function canAutomateSource(entry: SourceRegistryEntry): boolean {
  if (entry.status !== 'connected') return false
  if (entry.automationPolicy !== 'allow') return false
  if (!['approved', 'contracted', 'not_applicable'].includes(entry.legalReviewStatus)) return false
  if (entry.commercialUse === 'prohibited') return false
  if (entry.accessMethod === 'unavailable' || entry.accessMethod === 'manual') return false
  if (entry.commercialUse === 'contract_required' && entry.legalReviewStatus !== 'contracted') return false
  return true
}

export function validateSourceRegistry(
  registry: readonly SourceRegistryEntry[] = SOURCE_REGISTRY,
): string[] {
  const errors: string[] = []
  const ids = new Set<string>()
  const roles = new Set<SourceRole>()

  for (const entry of registry) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id)) errors.push(`${entry.id}: invalid id`)
    if (ids.has(entry.id)) errors.push(`${entry.id}: duplicate id`)
    ids.add(entry.id)
    roles.add(entry.role)
    if (entry.priority < 1 || entry.priority > 10) errors.push(`${entry.id}: priority outside 1..10`)
    if (['approved', 'contracted'].includes(entry.legalReviewStatus) && (!entry.reviewedAt || !entry.termsReference)) {
      errors.push(`${entry.id}: approved/contracted source lacks review evidence`)
    }
    if (entry.automationPolicy === 'allow' && !['approved', 'contracted', 'not_applicable'].includes(entry.legalReviewStatus)) {
      errors.push(`${entry.id}: automation allowed without legal gate`)
    }
    if (entry.commercialUse === 'prohibited' && entry.automationPolicy !== 'block') {
      errors.push(`${entry.id}: prohibited source is not blocked`)
    }
    if (entry.personalDataRisk === 'high' && entry.automationPolicy === 'allow') {
      errors.push(`${entry.id}: high personal-data risk cannot auto-collect in v1`)
    }
  }

  for (const role of SOURCE_ROLES) {
    if (!roles.has(role)) errors.push(`${role}: source role is not represented`)
  }
  return errors
}

export function sourceRegistryByRole(): ReadonlyMap<SourceRole, readonly SourceRegistryEntry[]> {
  const result = new Map<SourceRole, SourceRegistryEntry[]>()
  for (const role of SOURCE_ROLES) result.set(role, [])
  for (const entry of SOURCE_REGISTRY) result.get(entry.role)?.push(entry)
  return result
}
