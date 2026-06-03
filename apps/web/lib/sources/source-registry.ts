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

export type SourceId = 'hh' | 'superjob' | 'habr-career' | 'career-pages' | 'egrul-fns'

export interface SourceConfig {
  /** Unique identifier used in API calls, DB, and n8n workflows. */
  id: SourceId
  /** Human-readable name for API docs and logs. */
  name: string
  /** Short description for the GET /api/sources/ingest endpoint. */
  description: string
  /** Ingestion script filename relative to packages/db/scripts/. */
  script: string
  /** Environment variable names required for this source to work. */
  requiredEnvVars: string[]
  /** Allowed env var prefixes for the `env` parameter of ingestSource(). */
  envPrefixes: string[]
  /** Whether this source is a primary source (included in daily-radar pipeline). */
  isPrimary: boolean
  /** Source category for routing and filtering. */
  category: 'job-board' | 'career-page' | 'registry'
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
    isPrimary: true,
    category: 'job-board',
  },
  {
    id: 'career-pages',
    name: 'Career Pages',
    description: 'Company career page crawl and enrichment',
    script: 'source-career-pages.mjs',
    requiredEnvVars: [],
    envPrefixes: ['CRAWLER_', 'FIRECRAWL_'],
    isPrimary: false,
    category: 'career-page',
  },
  {
    id: 'egrul-fns',
    name: 'EGRUL/FNS Registry',
    description: 'Russian company registry data',
    script: 'source-egrul-fns.mjs',
    requiredEnvVars: [],
    envPrefixes: ['SOURCE_'],
    isPrimary: false,
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

/** Get the full registry (for API docs, etc.). */
export function getSourceRegistry(): readonly SourceConfig[] {
  return SOURCE_REGISTRY
}
