/**
 * Source registry — single configuration point for all lead sources.
 *
 * Every source adapter (job board, career page crawler, registry) is
 * declared here with its metadata, requirements, and scheduling info.
 * Other modules (source-ingest, multi-source-lead-generator, API routes)
 * consult the registry instead of hardcoding source lists.
 *
 * Adding a new source = one entry in this file + the ingestion script.
 */

import { getCanonicalSourcePolicy } from './source-policy'

export type SourceId =
  | 'hh'
  | 'superjob'
  | 'habr-career'
  | 'linkedin-company-pages'
  | 'career-pages'
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'recruitee'
  | 'workable'
  | 'smartrecruiters'
  | 'egrul-fns'
  | 'rabota-rossii'
  | 'company-site'
  | 'funding-business-signals'
  | 'fedresurs'
  | 'transparent-business-fns'
  | 'company-newsrooms'
  | 'industry-media'
  | 'github-company-org'
  | 'youtube-company-channels'
  | 'telegram-company-channels'
  | 'fns-open-data'
  | 'government-procurement'
  | 'cbr-registry'
  | 'rosstat-open-data'
  | 'rospatent-open-data'

export interface SourceConfig {
  /** Unique identifier used in API calls, DB, and n8n workflows. */
  id: SourceId
  /** Human-readable name for API docs and logs. */
  name: string
  /** Short description for the GET /api/sources/ingest endpoint. */
  description: string
  /** Ingestion script filename relative to packages/db/scripts/. */
  script: string
  /** Environment variable names required for this source to work (technical: API keys, tokens). */
  requiredEnvVars: string[]
  /** Allowed env var prefixes for the `env` parameter of ingestSource(). */
  envPrefixes: string[]
  /** Search param env var names that should be loaded from user_search_preferences, not ENV. */
  searchEnvVars: string[]
  /** Whether this source is a primary source (included in daily-radar pipeline). */
  isPrimary: boolean
  /** Optional dependency-ordered daily stage for non-originating enrichment. */
  dailyStage?: 'supporting'
  /** Optional process env gate for large snapshot-backed daily sources. */
  dailyActivationEnvVars?: string[]
  /** Source category for routing and filtering. */
  category: 'job-board' | 'career-page' | 'registry' | 'professional-network' | 'business-signal'
  /**
   * Per-source execFile timeout in ms for ingestSource(). When omitted, the
   * default 120s applies. Set this only for sources that legitimately need more
   * than 120s end-to-end (fetch + DB write). career-pages crawls many company
   * sites sequentially and its DB upsert runs after the whole crawl, so a 120s
   * cap kills the process mid-write and discards every fetched record — see
   * the career-pages entry below. Keep the source's own fetch budget
   * (CAREER_PAGES_FETCH_BUDGET_MS, default 90s) well under this so the write
   * has headroom.
   */
  timeoutMs?: number
}

/**
 * All registered sources. This is the single source of truth.
 */
const SOURCE_REGISTRY: SourceConfig[] = [
  {
    id: 'hh',
    name: 'HeadHunter',
    description: 'Primary Russian job board — fetch vacancies and upsert signals',
    script: 'ingest-hh.mjs',
    requiredEnvVars: ['HH_USER_AGENT'],
    envPrefixes: ['HH_'],
    searchEnvVars: [
      'HH_SEARCH_TEXT', 'HH_PER_PAGE', 'HH_PAGES',
      'HH_AREA', 'HH_EMPLOYMENT', 'HH_SCHEDULE', 'HH_EXPERIENCE',
      'HH_PROFESSIONAL_ROLE', 'HH_INDUSTRY', 'HH_DATE_FROM', 'HH_DATE_TO',
      'HH_ORDER_BY', 'HH_SEARCH_FIELD', 'HH_LABEL', 'HH_SEARCH_PARAMS_JSON',
    ],
    isPrimary: true,
    category: 'job-board',
  },
  {
    id: 'superjob',
    name: 'SuperJob',
    description: 'Secondary Russian job board',
    script: 'source-superjob.mjs',
    // No single variable is universally required: file mode needs only
    // SUPERJOB_INPUT_FILE, while provider/live modes use SUPERJOB_API_APP_ID.
    requiredEnvVars: [],
    envPrefixes: ['SUPERJOB_'],
    searchEnvVars: [
      'SUPERJOB_KEYWORD', 'SUPERJOB_PER_PAGE', 'SUPERJOB_PAGES',
      'SUPERJOB_TOWN', 'SUPERJOB_CATALOGUES', 'SUPERJOB_TYPE_OF_WORK',
      'SUPERJOB_EXPERIENCE', 'SUPERJOB_PAYMENT_FROM', 'SUPERJOB_PAYMENT_TO',
      'SUPERJOB_PERIOD', 'SUPERJOB_ORDER_FIELD', 'SUPERJOB_ORDER_DIRECTION',
    ],
    isPrimary: true,
    category: 'job-board',
  },
  {
    id: 'habr-career',
    name: 'Habr Career',
    description: 'IT job-board evidence from reviewed snapshots or an explicitly permitted provider',
    script: 'source-habr-career.mjs',
    requiredEnvVars: [],
    envPrefixes: ['HABR_'],
    searchEnvVars: [],
    isPrimary: false,
    category: 'job-board',
    // Direct commercial HTML collection is disabled under the current Habr
    // agreement. Manual runs require a reviewed snapshot or permitted provider.
  },
  {
    id: 'linkedin-company-pages',
    name: 'LinkedIn company pages',
    description: 'Compliant company-page snapshots used as confidence-gated employer evidence',
    script: 'source-linkedin-company-pages.mjs',
    requiredEnvVars: [],
    envPrefixes: ['LINKEDIN_'],
    searchEnvVars: [],
    // Provider/file snapshots only. Personal profile, employee, email, and
    // phone fields are rejected by the adapter, and the source remains outside
    // the automatic daily pipeline until its confidence gates are promoted.
    isPrimary: false,
    category: 'professional-network',
  },
  {
    id: 'career-pages',
    name: 'Career Pages',
    description: 'Company career page crawl and enrichment',
    script: 'source-career-pages-runtime.mjs',
    requiredEnvVars: [],
    envPrefixes: ['CRAWLER_', 'FIRECRAWL_', 'CAREER_PAGES_'],
    searchEnvVars: [],
    // Promoted to primary on 2026-06-30: this unified crawler discovers direct
    // same-domain and hosted-ATS company hiring surfaces (Gate A/B evidence). It was previously
    // excluded from the daily-radar pipeline, so the highest-quality lead surface
    // never ran automatically. The sequential crawl self-limits via a wall-clock
    // fetch budget (CAREER_PAGES_FETCH_BUDGET_MS, default 90s) so partial batches
    // still reach ingestion. Auto-discovery seeds from existing orgs+signals
    // (needs a domain), so it adds nothing until other sources have populated
    // orgs — a no-op, not a failure, on an empty DB.
    //
    // Persistence is set-based: a controlled disposable-PostgreSQL benchmark
    // writes 700 normalized vacancies in <120s and must remain at least 3x
    // faster than the retained benchmark-only legacy path. 180s leaves 90s for
    // the bounded fetch phase plus 90s of DB/network headroom without hiding a
    // persistence regression behind the former 420s timeout.
    isPrimary: true,
    category: 'career-page',
    timeoutMs: 180_000,
  },
  {
    id: 'greenhouse',
    name: 'Greenhouse',
    description: 'Auto-discovered public Greenhouse company job boards',
    script: 'source-greenhouse.mjs',
    requiredEnvVars: [],
    envPrefixes: ['CAREER_PAGES_'],
    searchEnvVars: [],
    isPrimary: false,
    category: 'career-page',
    timeoutMs: 180_000,
  },
  {
    id: 'lever',
    name: 'Lever',
    description: 'Auto-discovered public Lever company postings',
    script: 'source-lever.mjs',
    requiredEnvVars: [],
    envPrefixes: ['CAREER_PAGES_'],
    searchEnvVars: [],
    isPrimary: false,
    category: 'career-page',
    timeoutMs: 180_000,
  },
  {
    id: 'ashby',
    name: 'Ashby',
    description: 'Auto-discovered Ashby public Job Posting API boards',
    script: 'source-ashby.mjs',
    requiredEnvVars: [],
    envPrefixes: ['CAREER_PAGES_'],
    searchEnvVars: [],
    isPrimary: false,
    category: 'career-page',
    timeoutMs: 180_000,
  },
  {
    id: 'recruitee',
    name: 'Recruitee',
    description: 'Auto-discovered Recruitee public Careers Site API boards',
    script: 'source-recruitee.mjs',
    requiredEnvVars: [],
    envPrefixes: ['CAREER_PAGES_'],
    searchEnvVars: [],
    isPrimary: false,
    category: 'career-page',
    timeoutMs: 180_000,
  },
  {
    id: 'workable',
    name: 'Workable',
    description: 'Auto-discovered Workable public account job boards',
    script: 'source-workable.mjs',
    requiredEnvVars: [],
    envPrefixes: ['CAREER_PAGES_'],
    searchEnvVars: [],
    isPrimary: false,
    category: 'career-page',
    timeoutMs: 180_000,
  },
  {
    id: 'smartrecruiters',
    name: 'SmartRecruiters',
    description: 'Auto-discovered SmartRecruiters public Posting API boards',
    script: 'source-smartrecruiters.mjs',
    requiredEnvVars: [],
    envPrefixes: ['CAREER_PAGES_'],
    searchEnvVars: [],
    isPrimary: false,
    category: 'career-page',
    timeoutMs: 180_000,
  },
  {
    id: 'egrul-fns',
    name: 'EGRUL/FNS Registry',
    description: 'Reviewed official FNS integration snapshots for legal-entity enrichment',
    script: 'source-egrul-fns.mjs',
    requiredEnvVars: ['EGRUL_FNS_INPUT_FILE'],
    envPrefixes: ['EGRUL_FNS_'],
    searchEnvVars: [],
    isPrimary: false,
    category: 'registry',
  },
  {
    id: 'company-site',
    name: 'Company sites',
    description: 'Direct company websites — corroborating evidence and contact surfaces',
    script: 'source-company-site.mjs',
    requiredEnvVars: [],
    envPrefixes: ['COMPANY_SITE_', 'CRAWLER_'],
    // COMPANY_SITE_TARGETS_FILE is a searchEnvVar so it is EXCLUDED from the
    // caller env whitelist and instead derived from the DB: source-ingest
    // selects orgs the radar is already tracking (domain/website_url + a hiring
    // signal), writes them to a temp .cache/ file as the JSON array the script
    // `existsSync`s, and injects the path here. An operator can still pin
    // COMPANY_SITE_TARGETS_FILE / COMPANY_SITE_INPUT_FILE via ENV or
    // user_search_preferences; the derived default only fills when unset.
    searchEnvVars: ['COMPANY_SITE_TARGETS_FILE'],
    // Not a primary/originating source: company-site is supporting-evidence-only
    // (registry policy 'supporting-evidence-only') — it corroborates existing leads
    // and surfaces direct company/contact pages, but must never originate a lead on
    // its own. It runs only in the dependency-ordered supporting stage after
    // primary hiring ingestion, targeting companies that already have hiring proof.
    isPrimary: false,
    dailyStage: 'supporting',
    category: 'career-page',
  },
  {
    id: 'company-newsrooms',
    name: 'Company newsrooms',
    description: 'Curated company newsroom context that can corroborate, but never originate, a lead',
    script: 'source-company-newsrooms.mjs',
    requiredEnvVars: [],
    envPrefixes: ['COMPANY_NEWSROOMS_'],
    // COMPANY_NEWSROOMS_TARGETS_FILE is a searchEnvVar so it is EXCLUDED from
    // caller env whitelist and instead derived from the DB (same contract
    // as company-site): source-ingest selects orgs the radar is already
    // tracking (domain/website_url + a hiring signal), writes them to a temp
    // .cache/ file as the JSON array the script `existsSync`s, and injects the
    // path here. The target shape {url, company_name?, company_domain?} is
    // identical to company-site's and consumed by the same fetchCompanyPages
    // adapter, so the derivation reuses buildCompanySiteTargets. An operator
    // can still pin COMPANY_NEWSROOMS_TARGETS_FILE /
    // COMPANY_NEWSROOMS_INPUT_FILE via ENV or user_search_preferences; the
    // derived default only fills when unset.
    searchEnvVars: ['COMPANY_NEWSROOMS_TARGETS_FILE'],
    // Not primary: context-only (signal_type 'other',
    // evidence_role 'context', contextOnly:true). Newsroom pages corroborate
    // org identity / Urgency (funding, expansion, leadership changes) but
    // never originate a lead (Gate D). It runs in the supporting stage only
    // after hiring sources establish the candidate company set.
    isPrimary: false,
    dailyStage: 'supporting',
    category: 'career-page',
  },
  {
    id: 'funding-business-signals',
    name: 'Funding & business signals (GDELT)',
    description: 'Funding rounds / venture signals — corroborating context (not a lead trigger)',
    script: 'source-funding-business-signals.mjs',
    // Free live-public mode: set FUNDING_SIGNALS_GDELT_QUERIES to query the
    // public GDELT global news/event database (no paid key). File mode
    // (FUNDING_BUSINESS_SIGNALS_INPUT_FILE) and provider mode
    // (FUNDING_SIGNALS_PROVIDER_API_URL + _TOKEN) are also supported.
    // Automatic query JSON is derived from already tracked companies with
    // hiring evidence plus a strong domain. Broad industry-only queries are
    // rejected because they cannot attribute the article subject safely.
    requiredEnvVars: [],
    envPrefixes: ['FUNDING_BUSINESS_SIGNALS_', 'FUNDING_SIGNALS_'],
    searchEnvVars: ['FUNDING_SIGNALS_GDELT_QUERIES', 'FUNDING_SIGNALS_GDELT_QUERIES_JSON'],
    // CONTEXT-only source (2026-07-15): signal_type 'funding' / 'funding_round'
    // does NOT originate a lead — per Gate D, context without direct hiring
    // proof is supporting context only, never a lead. The digest SQL filters
    // to signal_type='job_posting' for lead candidacy, so these records
    // corroborate org identity (INN/OGRN/domain) but never surface as leads on
    // their own. It runs after primary hiring ingestion and refreshes only
    // existing companies, never cold subjects.
    isPrimary: false,
    dailyStage: 'supporting',
    category: 'business-signal',
  },
  {
    id: 'industry-media',
    name: 'Industry media',
    description: 'Curated public RSS/Atom company mentions used as supporting context only',
    script: 'source-industry-media.mjs',
    requiredEnvVars: [],
    envPrefixes: ['INDUSTRY_MEDIA_'],
    searchEnvVars: ['INDUSTRY_MEDIA_TRACKED_COMPANIES_JSON'],
    isPrimary: false,
    dailyStage: 'supporting',
    category: 'business-signal',
  },
  {
    id: 'github-company-org',
    name: 'GitHub company organizations',
    description: 'Low-confidence public technology activity from identity-verified company organizations; context only',
    script: 'source-github-company-org.mjs',
    requiredEnvVars: [],
    envPrefixes: ['GITHUB_COMPANY_ORG_', 'GITHUB_TOKEN'],
    searchEnvVars: ['GITHUB_COMPANY_ORG_TARGETS_JSON'],
    isPrimary: false,
    dailyStage: 'supporting',
    category: 'business-signal',
  },
  {
    id: 'youtube-company-channels', name: 'YouTube company channels',
    description: 'Company-owned public video events through the quota-aware Data API; context only',
    script: 'source-youtube-company-channels.mjs', requiredEnvVars: ['YOUTUBE_API_KEY'],
    envPrefixes: ['YOUTUBE_'], searchEnvVars: ['YOUTUBE_COMPANY_CHANNELS_TARGETS_JSON'], isPrimary: false, dailyStage: 'supporting', category: 'business-signal',
  },
  {
    id: 'telegram-company-channels', name: 'Telegram company channels',
    description: 'Identity-bound public corporate broadcast channels through MTProto; context only',
    script: 'source-telegram-company-channels.mjs', requiredEnvVars: ['TELEGRAM_API_ID', 'TELEGRAM_API_HASH', 'TELEGRAM_SESSION'],
    envPrefixes: ['TELEGRAM_COMPANY_CHANNELS_', 'TELEGRAM_API_', 'TELEGRAM_SESSION'], searchEnvVars: ['TELEGRAM_COMPANY_CHANNELS_TARGETS_JSON'], isPrimary: false, dailyStage: 'supporting', category: 'business-signal',
  },
  {
    id: 'fedresurs',
    name: 'Fedresurs (corporate events)',
    description: 'Russian Fedresurs corporate-event records — corroborating context (not a lead trigger)',
    script: 'source-fedresurs.mjs',
    // File mode (FEDRESURS_INPUT_FILE) or provider mode
    // (FEDRESURS_PROVIDER_API_URL + _TOKEN). Public-site scraping is NOT
    // supported (the script refuses it) — the operator supplies a feed after a
    // legal review. signal_type 'other', evidence_role 'context'.
    requiredEnvVars: [],
    envPrefixes: ['FEDRESURS_'],
    searchEnvVars: [],
    // CONTEXT-only: corporate events (bankruptcy, reorganization, large
    // transactions) corroborate org identity + Urgency but never originate a
    // lead (Gate D). Digest-lead candidacy stays job_posting-only.
    isPrimary: false,
    category: 'registry',
  },
  {
    id: 'transparent-business-fns',
    name: 'Transparent business (FNS)',
    description: 'Russian FNS transparent-business registry references — org enrichment (not a lead trigger)',
    script: 'source-transparent-business-fns.mjs',
    // File mode (TRANSPARENT_BUSINESS_FNS_INPUT_FILE) or provider mode
    // (TRANSPARENT_BUSINESS_FNS_PROVIDER_API_URL + _TOKEN). Direct pb.nalog.ru
    // scraping is NOT supported. signal_type 'other', evidence_role
    // 'enrichment' — registry references that resolve/enrich org identity
    // (INN/OGRN/name) rather than signal a hiring event.
    requiredEnvVars: [],
    envPrefixes: ['TRANSPARENT_BUSINESS_FNS_'],
    searchEnvVars: [],
    // ENRICHMENT-only: strengthens org identity resolution (legal name, INN,
    // OGRN) which feeds cross-source corroboration, but never originates a
    // lead. Run on demand from the admin panel to enrich the org registry.
    isPrimary: false,
    category: 'registry',
  },
  {
    id: 'rabota-rossii',
    name: 'Rabota Rossii',
    // Promoted to primary on 2026-06-23: the live freshness confidence gate
    // (`npm run verify:rabota-rossii:confidence`, RABOTA_ROSSII_LIVE=1) passed
    // with freshness >=60% within active-30d measured by date_modify (75 live
    // records across the moscow/spb/federal matrix), plus region/salary/
    // identity/privacy contracts. Enrolling in ingestion does NOT bypass the
    // digest confidence gate: per-org digest eligibility is still decided by
    // isDigestEligibleGate (A/B) + matchesClientProfile downstream.
    description: 'Official Rabota Rossii open-data vacancies (trudvsem) — primary signal source',
    script: 'source-rabota-rossii.mjs',
    requiredEnvVars: [],
    envPrefixes: ['RABOTA_ROSSII_'],
    searchEnvVars: [],
    isPrimary: true,
    category: 'job-board',
  },
  {
    id: 'fns-open-data',
    name: 'FNS open data',
    description: 'Official FNS bulk company context selected automatically by tracked legal-entity INN',
    script: 'source-fns-open-data.mjs',
    requiredEnvVars: [],
    envPrefixes: ['FNS_OPEN_DATA_', 'GOVERNMENT_ENRICHMENT_'],
    searchEnvVars: ['GOVERNMENT_ENRICHMENT_INNS'],
    isPrimary: false,
    dailyStage: 'supporting',
    dailyActivationEnvVars: ['SOURCE_SNAPSHOT_ROOT', 'FNS_OPEN_DATA_INPUT_FILE'],
    category: 'registry',
  },
  {
    id: 'government-procurement',
    name: 'Government procurement',
    description: 'Official EIS/Treasury contract context selected automatically by supplier INN',
    script: 'source-government-procurement.mjs',
    requiredEnvVars: [],
    envPrefixes: ['GOVERNMENT_PROCUREMENT_', 'GOVERNMENT_ENRICHMENT_'],
    searchEnvVars: ['GOVERNMENT_ENRICHMENT_INNS'],
    isPrimary: false,
    dailyStage: 'supporting',
    dailyActivationEnvVars: ['SOURCE_SNAPSHOT_ROOT', 'GOVERNMENT_PROCUREMENT_INPUT_FILE'],
    category: 'business-signal',
  },
  {
    id: 'cbr-registry',
    name: 'Bank of Russia registry',
    description: 'Official financial-market participant and licence lookup by tracked INN',
    script: 'source-cbr-registry.mjs',
    requiredEnvVars: [],
    envPrefixes: ['CBR_REGISTRY_', 'GOVERNMENT_ENRICHMENT_'],
    searchEnvVars: ['GOVERNMENT_ENRICHMENT_INNS'],
    isPrimary: false,
    dailyStage: 'supporting',
    category: 'registry',
  },
  {
    id: 'rosstat-open-data',
    name: 'Rosstat open data',
    description: 'Official aggregate industry, regional labour and market baseline context',
    script: 'source-rosstat-open-data.mjs',
    requiredEnvVars: [],
    envPrefixes: ['ROSSTAT_OPEN_DATA_'],
    searchEnvVars: [],
    isPrimary: false,
    dailyStage: 'supporting',
    dailyActivationEnvVars: ['SOURCE_SNAPSHOT_ROOT', 'ROSSTAT_OPEN_DATA_INPUT_FILE'],
    category: 'business-signal',
  },
  {
    id: 'rospatent-open-data',
    name: 'Rospatent open data',
    description: 'Official weak product-expansion context selected automatically by applicant INN',
    script: 'source-rospatent-open-data.mjs',
    requiredEnvVars: [],
    envPrefixes: ['ROSPATENT_OPEN_DATA_', 'GOVERNMENT_ENRICHMENT_'],
    searchEnvVars: ['GOVERNMENT_ENRICHMENT_INNS'],
    isPrimary: false,
    dailyStage: 'supporting',
    dailyActivationEnvVars: ['SOURCE_SNAPSHOT_ROOT', 'ROSPATENT_OPEN_DATA_INPUT_FILE'],
    category: 'registry',
  },
]

/** Fast lookup by source ID. */
const BY_ID = new Map<SourceId, SourceConfig>(
  SOURCE_REGISTRY.map(s => [s.id, s])
)

/** Get a source config by ID. Throws if not found (should never happen). */
export function getSourceConfig(id: SourceId): SourceConfig {
  const config = BY_ID.get(id)
  if (!config) throw new Error(`Unknown source: ${id}`)
  return config
}

/** Get all registered source IDs. */
export function getAllSourceIds(): SourceId[] {
  return SOURCE_REGISTRY.map(s => s.id)
}

/** Get primary source IDs (those included in the daily-radar pipeline). */
export function getPrimarySourceIds(): SourceId[] {
  return SOURCE_REGISTRY.filter(s => s.isPrimary).map(s => s.id)
}

/** Source IDs whose normalized records can constitute direct hiring evidence. */
export function getHiringEvidenceSourceIds(): SourceId[] {
  return SOURCE_REGISTRY.filter((source) => {
    const policy = getCanonicalSourcePolicy(source.id)
    return policy?.leadEligibility === 'digest-lead-originating'
      || policy?.leadEligibility === 'confidence-gated-evidence'
  }).map(source => source.id)
}

/** Non-originating sources run after the primary hiring stage completes. */
export function getDailySupportingSourceIds(): SourceId[] {
  return SOURCE_REGISTRY.filter(s =>
    s.dailyStage === 'supporting'
    && (!s.dailyActivationEnvVars || s.dailyActivationEnvVars.some(name => Boolean(process.env[name])))
  ).map(s => s.id)
}

/** Get source configs for a specific category. */
export function getSourcesByCategory(category: SourceConfig['category']): SourceConfig[] {
  return SOURCE_REGISTRY.filter(s => s.category === category)
}

/** All allowed env prefixes across all sources (for the whitelist filter). */
export function getAllEnvPrefixes(): string[] {
  const prefixes = new Set<string>()
  for (const source of SOURCE_REGISTRY) {
    for (const prefix of source.envPrefixes) {
      prefixes.add(prefix)
    }
  }
  return Array.from(prefixes)
}

/** Get the search env var names for a given source (those loaded from DB, not ENV). */
export function getSearchEnvVars(id: SourceId): string[] {
  const config = BY_ID.get(id)
  return config?.searchEnvVars ?? []
}

/** All search env var names across all sources. */
export function getAllSearchEnvVars(): string[] {
  const vars = new Set<string>()
  for (const source of SOURCE_REGISTRY) {
    for (const v of source.searchEnvVars) {
      vars.add(v)
    }
  }
  return Array.from(vars)
}

/** Get the full registry (for API docs, etc.). */
export function getSourceRegistry(): readonly SourceConfig[] {
  return SOURCE_REGISTRY
}