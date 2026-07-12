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

export type SourceId = 'hh' | 'superjob' | 'habr-career' | 'career-pages' | 'egrul-fns' | 'rabota-rossii'

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
  /** Source category for routing and filtering. */
  category: 'job-board' | 'career-page' | 'registry'
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
      'HH_ORDER_BY', 'HH_SEARCH_FIELD', 'HH_SEARCH_PARAMS_JSON',
    ],
    isPrimary: true,
    category: 'job-board',
  },
  {
    id: 'superjob',
    name: 'SuperJob',
    description: 'Secondary Russian job board',
    script: 'source-superjob.mjs',
    requiredEnvVars: ['SUPERJOB_API_KEY'],
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
    description: 'IT-focused job board',
    script: 'source-habr-career.mjs',
    requiredEnvVars: [],
    envPrefixes: ['HABR_'],
    searchEnvVars: [
      'HABR_CAREER_KEYWORD', 'HABR_CAREER_KEYWORDS', 'HABR_CAREER_PAGES',
      'HABR_CAREER_TYPE', 'HABR_CAREER_QUALIFICATION', 'HABR_CAREER_REMOTE',
      'HABR_CAREER_RELOCATION', 'HABR_CAREER_CITY', 'HABR_CAREER_CURRENCY',
      'HABR_CAREER_SALAY_FROM', 'HABR_CAREER_SALAY_TO',
    ],
    isPrimary: true,
    category: 'job-board',
  },
  {
    id: 'career-pages',
    name: 'Career Pages',
    description: 'Company career page crawl and enrichment',
    script: 'source-career-pages.mjs',
    requiredEnvVars: [],
    envPrefixes: ['CRAWLER_', 'FIRECRAWL_', 'CAREER_PAGES_'],
    searchEnvVars: [],
    // Promoted to primary on 2026-06-30: career-pages is the only DIRECT
    // company-surface, high-signal source (Gate A/B evidence). It was previously
    // excluded from the daily-radar pipeline, so the highest-quality lead surface
    // never ran automatically. The sequential crawl self-limits via a wall-clock
    // fetch budget (CAREER_PAGES_FETCH_BUDGET_MS, default 90s) so partial batches
    // still reach ingestion. Auto-discovery seeds from existing orgs+signals
    // (needs a domain), so it adds nothing until other sources have populated
    // orgs — a no-op, not a failure, on an empty DB.
    //
    // Per-source timeout 240s (raised from the 120s default on 2026-07-12): the
    // crawl (≤90s budget) + the DB upsert (runs once after the whole loop) can
    // exceed 120s on a large candidate set, and a 120s execFile kill discarded
    // EVERY fetched record because the write never reached the DB. 240s gives
    // more headroom. NOTE: the post-loop write is row-by-row (per-record
    // pg_advisory_xact_lock + SELECT + per-source-key INSERTs), so a large batch
    // can still exceed 240s and be killed mid-write — the write is inside one
    // transaction so a kill loses the whole batch. The durable fix is a batched
    // write in the script (deferred); until then, lowering
    // CAREER_PAGES_FETCH_BUDGET_MS via env shrinks the batch so crawl+write fits
    // the timeout, at the cost of per-run coverage.
    isPrimary: true,
    category: 'career-page',
    timeoutMs: 240_000,
  },
  {
    id: 'egrul-fns',
    name: 'EGRUL/FNS Registry',
    description: 'Russian company registry data',
    script: 'source-egrul-fns.mjs',
    requiredEnvVars: [],
    envPrefixes: ['SOURCE_'],
    searchEnvVars: [],
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
