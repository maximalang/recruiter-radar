/**
 * Source ingestion service — triggers data-fetch pipelines for lead sources.
 *
 * Instead of duplicating the ingestion logic from packages/db/scripts,
 * this module invokes the existing CLI scripts via child_process.
 * The scripts handle: API auth → fetch → normalize → upsert → signals.
 *
 * Source configuration lives in `lib/sources/source-registry.ts`.
 * Adding a new source = one registry entry + the ingestion script.
 *
 * Ingestion is idempotent — re-running for the same source upserts
 * (INSERT ON CONFLICT UPDATE) without creating duplicates.
 *
 * SECURITY: Extra env vars passed via `env` are filtered through a
 * whitelist (prefixes from source-registry) to prevent injection of
 * dangerous keys like DATABASE_URL, NODE_OPTIONS, or PATH.
 *
 * RUNTIME: Requires Node.js runtime (child_process). Will not work
 * in Edge/serverless runtimes (Vercel Edge, Cloudflare Workers).
 */

import { getExecFile } from './node-exec'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getSourceConfig,
  getPrimarySourceIds,
  getHiringEvidenceSourceIds,
  getDailySupportingSourceIds,
  getAllEnvPrefixes,
  getSearchEnvVars,
  type SourceId,
} from '@/lib/sources/source-registry'
import { getPool } from '@/lib/db-pool'
import { deriveHabrKeywordsFromProfiles } from './habr-keywords'
import {
  buildProfileSearchEnv,
  type ProfileSearchInput,
} from './search-query-builder'
import {
  classifyFeedbackSentiment,
  computeClientQueryAdjustments,
  industryDemoteTerms,
  type FeedbackPatternEvent,
} from './query-feedback-tuning'
import { buildProfileGdeltQueries } from './gdelt-query-builder'
import {
  buildCompanySiteTargets,
  MAX_COMPANY_SITE_TARGETS_PER_RUN,
  type CompanySiteTargetRow,
} from './company-site-targets'
import { writeFileSync, mkdirSync } from 'node:fs'

export type { SourceId } from '@/lib/sources/source-registry'

/**
 * Resolve the db scripts directory lazily.
 *
 * WHY lazy: in Next.js's bundled server runtime `import.meta.url` may be
 * undefined or a non-file URL. Calling `fileURLToPath` on it at module top
 * level throws, which crashes the whole module load — turning every request
 * to a route that imports this file into a pre-auth 500 (the symptom we hit
 * on /api/cron/daily-radar). Deferring to first use keeps module load safe
 * and lets us fall back to a cwd-relative path when import.meta.url is absent.
 */
let cachedScriptDir: string | null = null
function getScriptDir(): string {
  if (cachedScriptDir) return cachedScriptDir
  const metaUrl = import.meta.url
  if (metaUrl && metaUrl.startsWith('file:')) {
    cachedScriptDir = resolve(dirname(fileURLToPath(metaUrl)), '../../../../packages/db/scripts')
  } else {
    // Bundled runtime: resolve from the web app root (process.cwd() is apps/web).
    cachedScriptDir = resolve(process.cwd(), '../../packages/db/scripts')
  }
  return cachedScriptDir
}

export interface IngestResult {
  source: SourceId
  success: boolean
  outcome: IngestOutcome
  /** Items fetched from the API. */
  fetchedCount?: number
  /** Items upserted into signals table. */
  upsertedCount?: number
  /** Stdout lines (for diagnostics). */
  log?: string
  /** Error message if success is false. */
  error?: string
  diagnostics?: IngestDiagnostics
}

export type IngestOutcome =
  | 'ingested'
  | 'ingested-with-duplicates'
  | 'expected-zero'
  | 'unexpected-zero'
  | 'normalization-zero'
  | 'ingestion-zero'
  | 'missing-summary'
  | 'invalid-summary'
  | 'failed'

export interface IngestDiagnostics {
  parsedCount?: number
  normalizedCount?: number
  duplicateCount?: number
  skippedCount?: number
  organizationCount?: number
  evidenceCount?: number
  zeroReason?: string
}

/**
 * Sentinel returned by ingestAllPrimarySources() when there are no active
 * client profiles to ingest for. Distinct from IngestResult[] so callers can
 * short-circuit (e.g. respond HTTP 422) instead of running an empty pipeline.
 */
export interface NoActiveProfilesResult {
  error: 'no_active_profiles'
  hint: string
}

/** Type guard: did ingestAllPrimarySources() bail out with no active profiles? */
export function isNoActiveProfiles(
  result: IngestResult[] | NoActiveProfilesResult
): result is NoActiveProfilesResult {
  return !Array.isArray(result) && result.error === 'no_active_profiles'
}

const NO_ACTIVE_PROFILES_HINT = 'run scripts/e2e/seed-test-profile.sql'

/**
 * Count active client profiles.
 *
 * "Active" = client_profiles.is_active = TRUE (the only activation flag in
 * schema; there is no separate status/subscription column). Telegram linkage
 * is intentionally NOT required here — ingestion fills the signal pool that
 * any active profile can draw from; delivery-time checks (telegram_chat_id)
 * live in the digest/delivery step, not in ingestion.
 *
 * Returns null when no DB pool is configured — callers should treat that as
 * "cannot determine, proceed" rather than "zero profiles".
 */
async function countActiveProfiles(): Promise<number | null> {
  const pool = getPool()
  if (!pool) return null
  const { rows } = await pool.query<{ count: string }>(`
    SELECT COUNT(*)::TEXT AS count
    FROM client_profiles
    WHERE is_active = TRUE
  `)
  return Number(rows[0]?.count ?? '0')
}

/**
 * Filter env vars through the whitelist from the source registry.
 *
 * Only source-specific config keys are permitted — never infrastructure
 * keys (DATABASE_URL, NODE_OPTIONS, PATH, HOME, etc.) which could be
 * used to redirect DB connections or execute arbitrary code.
 *
 * Search params (listed in source-registry searchEnvVars) are excluded:
 * they should come from user_search_preferences in DB, not from ENV.
 */
function filterEnvVars(env: Record<string, string>, searchEnvVars: string[]): Record<string, string> {
  const allowedPrefixes = getAllEnvPrefixes()
  const searchSet = new Set(searchEnvVars)
  const filtered: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (searchSet.has(key)) continue
    if (allowedPrefixes.some(prefix => key.startsWith(prefix))) {
      filtered[key] = value
    }
  }
  return filtered
}

/**
 * Load search preferences from user_search_preferences for a given source.
 * Returns env-style key-value pairs ready to merge into the ingestion env.
 */
async function loadSearchPrefsFromDb(source: SourceId): Promise<Record<string, string>> {
  const pool = getPool()
  if (!pool) return {}

  const searchEnvVars = getSearchEnvVars(source)
  if (searchEnvVars.length === 0) return {}

  const { rows } = await pool.query<{ params: Record<string, string> }>(`
    SELECT params
    FROM user_search_preferences
    WHERE source = $1
    LIMIT 1
  `, [source])

  if (rows.length === 0) return {}
  return rows[0].params ?? {}
}

/**
 * Load the `roles` arrays of every active client profile.
 *
 * Used only by habr-career keyword derivation: ingestion is global, so the
 * search must reflect the union of all active profiles' ICP roles, not one
 * profile's. Returns [] when no pool (test/dev) — caller falls back to ENV.
 */
async function loadActiveProfileRoles(): Promise<string[][]> {
  const pool = getPool()
  if (!pool) return []
  const { rows } = await pool.query<{ roles: string[] | null }>(`
    SELECT roles
    FROM client_profiles
    WHERE is_active = TRUE
  `)
  return rows.map(r => r.roles ?? [])
}

/**
 * Load the ICP search fields of every active client profile.
 *
 * Ingestion is global: `ingestAllPrimarySources()` fills ONE shared signal
 * pool before per-profile digest runs, so a source search must reflect the
 * UNION of all active profiles' ICP, not one profile's. This loads the fields
 * `buildProfileSearchEnv` consumes (roles, industries, exclusions, operator
 * keywords, target city) for every active profile so the per-source query is
 * derived from the combined ICP. Returns [] when no pool (test/dev) — caller
 * falls back to ENV / source defaults.
 */
async function loadActiveProfileSearchInputs(): Promise<ProfileSearchInput[]> {
  const pool = getPool()
  if (!pool) return []
  const { rows } = await pool.query<{
    roles: string[] | null
    industries: string[] | null
    excluded_industries: string[] | null
    include_keywords: string[] | null
    exclude_keywords: string[] | null
    target_city: string | null
  }>(`
    SELECT
      roles,
      industries,
      excluded_industries,
      include_keywords,
      exclude_keywords,
      target_city
    FROM client_profiles
    WHERE is_active = TRUE
  `)
  return rows.map(r => ({
    roles: r.roles ?? [],
    industries: r.industries ?? [],
    excludedIndustries: r.excluded_industries ?? [],
    includeKeywords: r.include_keywords ?? [],
    excludeKeywords: r.exclude_keywords ?? [],
    targetCity: r.target_city ?? null,
  }))
}

/**
 * Merge a list of per-profile search inputs into ONE union input for global
 * ingestion. Operator includeKeywords and excludeKeywords are unioned across
 * profiles; role/industry/exclusion arrays are unioned and deduped. This keeps
 * ingestion global (one fetch per source) while the query reflects every
 * active profile's ICP — the same pattern `loadActiveProfileRoles` uses for
 * habr-career, generalised to all supported search sources.
 */
function unionProfileSearchInputs(inputs: readonly ProfileSearchInput[]): ProfileSearchInput {
  const union = (arrs: ReadonlyArray<readonly string[]>): string[] => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const arr of arrs) {
      for (const v of arr ?? []) {
        if (typeof v !== 'string') continue
        const key = v.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push(v)
      }
    }
    return out
  }
  return {
    roles: union(inputs.map(i => i.roles)),
    industries: union(inputs.map(i => i.industries)),
    excludedIndustries: union(inputs.map(i => i.excludedIndustries)),
    includeKeywords: union(inputs.map(i => i.includeKeywords)),
    excludeKeywords: union(inputs.map(i => i.excludeKeywords)),
    targetCity: inputs.find(i => i.targetCity)?.targetCity ?? null,
  }
}

/**
 * Load the feedback history of every active client profile, projected onto the
 * (industry, role, sentiment) axes the query tuner reads.
 *
 * Ingestion is global (one shared signal pool), so feedback tuning is also
 * global: we union every active profile's feedback so a source query learns
 * from the combined client experience. The join is client_digest_org_state
 * (feedback_status) × orgs (industry) — the same join `computeClientOverrides`
 * uses for score reweighting, read here for query tuning. Returns [] when no
 * pool (test/dev) — caller skips tuning and builds the query from the profile
 * alone (Foundation 1 behaviour).
 *
 * The role axis is left null for now (role extraction from vacancy headlines is
 * a future increment); only industry is populated today, which is the axis
 * already reliably persisted on orgs.
 */
async function loadActiveFeedbackPatterns(): Promise<FeedbackPatternEvent[]> {
  const pool = getPool()
  if (!pool) return []
  const { rows } = await pool.query<{
    feedback_status: string
    industry: string | null
  }>(`
    SELECT
      state.feedback_status,
      LOWER(TRIM(orgs.industry)) AS industry
    FROM client_digest_org_state AS state
    JOIN orgs ON orgs.id = state.org_id
    WHERE state.feedback_status IN ('badfit', 'dismissed', 'contacted', 'replied', 'won')
  `)
  const events: FeedbackPatternEvent[] = []
  for (const r of rows) {
    const sentiment = classifyFeedbackSentiment(r.feedback_status)
    if (!sentiment) continue
    events.push({ industry: r.industry ?? null, role: null, sentiment })
  }
  return events
}

/**
 * Resolve the profile-derived search env for a source from the UNION of all
 * active client profiles, with feedback-driven demote terms applied.
 *
 * Precedence (matches the habr-career contract): an explicit operator override
 * already present in `dbSearchEnv` (from `user_search_preferences`) or in the
 * caller's filtered env ALWAYS wins — operators can pin a query. Only keys the
 * operator has NOT set are derived from profiles. When the profile union yields
 * no keywords for a key, that key is left unset and the source adapter falls
 * back to its own built-in default (unchanged from today).
 *
 * Feedback tuning: the union of all active profiles' feedback history is
 * turned into industry demote terms via `computeClientQueryAdjustments` +
 * `industryDemoteTerms`. These terms are NOT removed from the query — the
 * builder re-orders them to the back (bounded effect), so the query stays
 * inside the operator's ICP while poor-fit industries are de-emphasised.
 * Operator-pinned includeKeywords are exempt from demotion (human pin > loop).
 *
 * Sources with no supported search params (career-pages, tech-job-boards) get
 * an empty env — their ingestion is not keyword-driven.
 */
async function resolveProfileSearchEnv(
  source: SourceId,
  dbSearchEnv: Record<string, string>
): Promise<Record<string, string>> {
  const inputs = await loadActiveProfileSearchInputs()
  if (inputs.length === 0) return {}
  const unionInput = unionProfileSearchInputs(inputs)

  // Feedback self-tuning: demote terms from the combined feedback history.
  // Computed once per ingestion; empty when there is insufficient feedback
  // (MIN_SAMPLES_PER_AXIS gate inside computeClientQueryAdjustments).
  const feedbackEvents = await loadActiveFeedbackPatterns()
  const adjustments = computeClientQueryAdjustments(feedbackEvents)
  const demoteTerms = industryDemoteTerms(adjustments)

  const derived = buildProfileSearchEnv(source, unionInput, demoteTerms)

  // Strip any key the operator already pinned (manual override wins).
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(derived)) {
    if (key in dbSearchEnv) continue
    result[key] = value
  }
  return result
}

/**
 * Resolve the habr-career keyword search env from active profiles' roles.
 *
 * Precedence: an explicit DB/ENV keyword pref (HABR_CAREER_KEYWORD or the
 * multi-value HABR_CAREER_KEYWORDS already present in `dbSearchEnv`) always
 * wins — operators can override the heuristic. Otherwise we derive keywords
 * from the union of active profiles' roles and inject them as
 * HABR_CAREER_KEYWORDS. When neither yields anything, we inject nothing and the
 * adapter falls back to its own default keyword.
 */
async function resolveHabrKeywordEnv(
  dbSearchEnv: Record<string, string>
): Promise<Record<string, string>> {
  if (dbSearchEnv.HABR_CAREER_KEYWORD || dbSearchEnv.HABR_CAREER_KEYWORDS) return {}

  const roleLists = await loadActiveProfileRoles()
  const keywords = deriveHabrKeywordsFromProfiles(roleLists)
  if (keywords.length === 0) return {}

  return { HABR_CAREER_KEYWORDS: keywords.join(',') }
}

/**
 * Maximum 10-digit legal-entity INNs to enrich per egrul-fns run. Each INN is
 * one request to the public JSON mirror, so bounding the count bounds load on
 * the public endpoint. The most-recently-seen orgs are prioritised so the
 * enrichment tracks the freshest signal pool.
 */
const MAX_EGRUL_INNS_PER_RUN = 50

/**
 * Resolve the egrul-fns INN list from the DB: 10-digit legal-entity INNs on
 * orgs that still need registry verification (ogrn IS NULL), most-recent first,
 * capped to MAX_EGRUL_INNS_PER_RUN.
 *
 * Precedence (matches the other resolvers): an explicit operator override in
 * `dbSearchEnv` (EGRUL_FNS_INNS pinned via user_search_preferences), in
 * process.env, file mode, or provider mode ALWAYS wins — derivation only fills
 * when nobody pinned the input. Returns {} when there are no candidate orgs or
 * no pool — the source then falls back to its own no-input error (unchanged).
 *
 * Only 10-digit INNs (юрлицо) are selected; 12-digit ИП/person INNs are
 * excluded per the source readiness policy (enrichment-only, never
 * lead-originating). This is enforced at the SQL level (inn ~ '^\d{10}$').
 */
async function resolveEgrulInnsEnv(
  dbSearchEnv: Record<string, string>
): Promise<Record<string, string>> {
  if (dbSearchEnv.EGRUL_FNS_INNS) return {}
  if (process.env.EGRUL_FNS_INNS) return {}
  if (process.env.EGRUL_FNS_INPUT_FILE) return {}
  if (process.env.EGRUL_FNS_PROVIDER_API_URL) return {}

  const pool = getPool()
  if (!pool) return {}
  const { rows } = await pool.query<{ inn: string }>(`
    SELECT inn
    FROM orgs
    WHERE inn ~ '^\\d{10}$'
      AND ogrn IS NULL
    ORDER BY updated_at DESC
    LIMIT $1
  `, [MAX_EGRUL_INNS_PER_RUN])

  if (rows.length === 0) return {}
  return { EGRUL_FNS_INNS: rows.map(r => r.inn).join(',') }
}

/**
 * Config for `resolveCompanyPageTargetsEnv` — the two sources that share the
 * `fetchCompanyPages` live-public contract (company-site and company-newsrooms)
 * differ ONLY in the env-var names they pin, the `source` literal used in the
 * "already crawled" NOT EXISTS guard, and the temp-file name. Everything else
 * (the org-selection SQL, the `buildCompanySiteTargets` shaping, the temp-file
 * write + FS-error fallback) is identical, so the resolver is parameterised
 * once and each source declares a small config below.
 */
interface CompanyPageTargetsConfig {
  /** Source id, used as the `source` literal in the NOT EXISTS guard. */
  source: 'company-site' | 'company-newsrooms'
  /** Env var that points at the targets FILE (injected as the derived path). */
  targetsFileEnv: 'COMPANY_SITE_TARGETS_FILE' | 'COMPANY_NEWSROOMS_TARGETS_FILE'
  /** Env var for operator file mode (operator override). */
  inputFileEnv: 'COMPANY_SITE_INPUT_FILE' | 'COMPANY_NEWSROOMS_INPUT_FILE'
  /** Optional provider env var (company-newsrooms has one; company-site does not). */
  providerApiEnv?: 'COMPANY_NEWSROOMS_PROVIDER_API_URL'
  /** Temp-file basename written under packages/db/scripts/.cache/. */
  tempFileName: 'company-site-derived-targets.json' | 'company-newsrooms-derived-targets.json'
  /** Minimum age of the latest completed crawl before an org is eligible again. */
  refreshInterval: string
}

/**
 * Resolve a company-page targets FILE from the DB for either company-site or
 * company-newsrooms: orgs the radar is already tracking (a domain/website_url
 * AND at least one hiring signal from a job-board source), prioritised by
 * freshest signal, capped to MAX_COMPANY_SITE_TARGETS_PER_RUN.
 *
 * Both sources' live-public mode takes a FILE the script `existsSync`s (not an
 * inline env value), so this resolver writes the derived target list to a temp
 * `.cache/<tempFileName>` file and injects the path as `<targetsFileEnv>`. The
 * temp file lives under packages/db/scripts/.cache/ (same dir career-pages uses
 * for its discovered-targets snapshot) and is overwritten each run — no
 * accumulation, no secret content (just public company URLs already in the DB).
 *
 * Precedence (matches the other resolvers): an explicit operator override in
 * `dbSearchEnv` (the targets/input/provider env pinned via
 * user_search_preferences), process.env, or the source's file-mode env ALWAYS
 * wins — derivation only fills when nobody pinned the input. With a DB but no
 * eligible orgs, an empty target file is written so the source reports an
 * explicit expected-zero result. With no pool, or on any FS write error,
 * derivation is skipped (returns {}) so the source falls back without crashing
 * the whole ingestion batch.
 *
 * Both sources are never lead-originating (company-site is
 * supporting-evidence-only; company-newsrooms is context-only, Gate D) — we
 * only target orgs the radar is ALREADY tracking (HAVING a hiring signal),
 * never cold domains, so the crawl corroborates existing leads instead of
 * originating new ones. A freshness guard permits recurring refresh without
 * re-crawling the same company inside the configured interval.
 */
async function resolveCompanyPageTargetsEnv(
  dbSearchEnv: Record<string, string>,
  cfg: CompanyPageTargetsConfig,
): Promise<Record<string, string>> {
  const { source, targetsFileEnv, inputFileEnv, providerApiEnv, tempFileName, refreshInterval } = cfg
  if (dbSearchEnv[targetsFileEnv]) return {}
  if (dbSearchEnv[inputFileEnv]) return {}
  if (process.env[targetsFileEnv]) return {}
  if (process.env[inputFileEnv]) return {}
  if (providerApiEnv && process.env[providerApiEnv]) return {}

  const pool = getPool()
  if (!pool) return {}
  const { rows } = await pool.query<CompanySiteTargetRow>(`
    SELECT
      orgs.id::text AS id,
      orgs.name,
      orgs.domain,
      orgs.website_url
    FROM orgs
    WHERE COALESCE(NULLIF(BTRIM(orgs.domain), ''), NULLIF(BTRIM(orgs.website_url), '')) IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM signals
        WHERE signals.org_id = orgs.id
          AND signals.signal_type = 'job_posting'
          AND signals.source = ANY($4::text[])
      )
      AND NOT EXISTS (
        SELECT 1
        FROM signals
        WHERE signals.org_id = orgs.id
          AND signals.source = $2
          AND signals.updated_at >= NOW() - $3::interval
      )
    ORDER BY (
      SELECT MAX(signals.occurred_at)
      FROM signals
      WHERE signals.org_id = orgs.id
    ) DESC NULLS LAST, orgs.id DESC
    LIMIT $1
  `, [MAX_COMPANY_SITE_TARGETS_PER_RUN, source, refreshInterval, getHiringEvidenceSourceIds()])

  const targets = buildCompanySiteTargets(rows)

  const cacheDir = resolve(getScriptDir(), '.cache')
  const targetsFilePath = resolve(cacheDir, tempFileName)
  try {
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(targetsFilePath, `${JSON.stringify(targets, null, 2)}\n`, 'utf8')
  } catch {
    // FS write failed (read-only FS, permissions, …) — skip derivation so the
    // source falls back to its own no-input error instead of crashing the
    // ingestion batch. The operator can still pin the targets-file env.
    return {}
  }
  return { [targetsFileEnv]: targetsFilePath }
}

/** company-site config for the shared company-page targets resolver. */
const COMPANY_SITE_TARGETS_CONFIG: CompanyPageTargetsConfig = {
  source: 'company-site',
  targetsFileEnv: 'COMPANY_SITE_TARGETS_FILE',
  inputFileEnv: 'COMPANY_SITE_INPUT_FILE',
  tempFileName: 'company-site-derived-targets.json',
  refreshInterval: '7 days',
}

/** company-newsrooms config for the shared company-page targets resolver. */
const COMPANY_NEWSROOMS_TARGETS_CONFIG: CompanyPageTargetsConfig = {
  source: 'company-newsrooms',
  targetsFileEnv: 'COMPANY_NEWSROOMS_TARGETS_FILE',
  inputFileEnv: 'COMPANY_NEWSROOMS_INPUT_FILE',
  providerApiEnv: 'COMPANY_NEWSROOMS_PROVIDER_API_URL',
  tempFileName: 'company-newsrooms-derived-targets.json',
  refreshInterval: '23 hours',
}

/** Resolve the company-site targets FILE (thin wrapper over the shared resolver). */
function resolveCompanySiteTargetsEnv(
  dbSearchEnv: Record<string, string>
): Promise<Record<string, string>> {
  return resolveCompanyPageTargetsEnv(dbSearchEnv, COMPANY_SITE_TARGETS_CONFIG)
}

/** Resolve the company-newsrooms targets FILE (thin wrapper over the shared resolver). */
function resolveCompanyNewsroomsTargetsEnv(
  dbSearchEnv: Record<string, string>
): Promise<Record<string, string>> {
  return resolveCompanyPageTargetsEnv(dbSearchEnv, COMPANY_NEWSROOMS_TARGETS_CONFIG)
}

/**
 * Resolve the funding-business-signals GDELT query env from the union of all
 * active client profiles' ICP.
 *
 * Precedence (matches the habr/job-board contract): an explicit operator
 * override already present in `dbSearchEnv` (FUNDING_SIGNALS_GDELT_QUERIES
 * pinned via user_search_preferences) or in process.env ALWAYS wins. Only when
 * nobody pinned it do we derive GDELT queries from the profiles' industries and
 * inject them as FUNDING_SIGNALS_GDELT_QUERIES (newline-joined, the shape
 * parseGdeltQueries consumes). When the profile union yields no industries, we
 * inject nothing and the source falls back to file/provider/no-input.
 *
 * This unlocks funding-business-signals' FREE live-public GDELT mode with zero
 * manual ENV curation: the source runs live-public whenever at least one
 * active profile declares an industry, no paid key needed. The source stays
 * isPrimary:false (admin-triggered, not daily-cron) and context-only (Gate D).
 */
async function resolveFundingGdeltEnv(
  dbSearchEnv: Record<string, string>
): Promise<Record<string, string>> {
  if (dbSearchEnv.FUNDING_SIGNALS_GDELT_QUERIES) return {}
  if (process.env.FUNDING_SIGNALS_GDELT_QUERIES) return {}
  if (process.env.FUNDING_SIGNALS_GDELT_QUERIES_JSON) return {}
  if (process.env.FUNDING_BUSINESS_SIGNALS_INPUT_FILE) return {}
  if (process.env.FUNDING_SIGNALS_PROVIDER_API_URL) return {}

  const inputs = await loadActiveProfileSearchInputs()
  if (inputs.length === 0) return {}
  const unionInput = unionProfileSearchInputs(inputs)
  const queries = buildProfileGdeltQueries(unionInput)
  if (queries.length === 0) return {}

  return { FUNDING_SIGNALS_GDELT_QUERIES: queries }
}

/**
 * Run a source ingestion script.
 *
 * Returns a promise that resolves when the script finishes.
 * The script runs with the current process environment (DATABASE_URL, etc.)
 * plus any extra env vars passed in `env` (whitelist-filtered).
 */
export async function ingestSource(
  source: SourceId,
  env?: Record<string, string>
): Promise<IngestResult> {
  let config: import('@/lib/sources/source-registry').SourceConfig
  try {
    config = getSourceConfig(source)
  } catch {
    return { source, success: false, outcome: 'failed', error: `Unknown source: ${source}` }
  }
  const scriptDir = getScriptDir()
  const scriptPath = resolve(scriptDir, config.script)

  // Guard: ensure resolved path doesn't escape scripts dir (path traversal)
  if (!scriptPath.startsWith(scriptDir)) {
    return { source, success: false, outcome: 'failed', error: `Script path escapes scripts directory: ${config.script}` }
  }

  // Load search params from user_search_preferences (DB), falling back to ENV
  const dbSearchEnv = await loadSearchPrefsFromDb(source)
  const searchEnvVars = getSearchEnvVars(source)

  // habr-career: derive search keywords from the union of active profiles'
  // roles (ingestion is global), unless an explicit keyword pref is set.
  const habrDerivedEnv =
    source === 'habr-career' ? await resolveHabrKeywordEnv(dbSearchEnv) : {}
  // funding-business-signals: derive free live-public GDELT queries from the
  // union of active profiles' industries, unless an operator pinned them.
  const fundingDerivedEnv =
    source === 'funding-business-signals' ? await resolveFundingGdeltEnv(dbSearchEnv) : {}
  // egrul-fns: derive the INN list from orgs that still need registry
  // verification (10-digit legal-entity INNs, ogrn IS NULL), unless an
  // operator pinned the input.
  const egrulDerivedEnv =
    source === 'egrul-fns' ? await resolveEgrulInnsEnv(dbSearchEnv) : {}
  // company-site: derive the targets FILE from orgs the radar is already
  // tracking (domain/website_url + a hiring signal), written to a temp
  // .cache/ file, unless an operator pinned the targets/input file. The
  // source has no keyword search params, so the generalised profile resolver
  // is skipped for it.
  const companySiteDerivedEnv =
    source === 'company-site' ? await resolveCompanySiteTargetsEnv(dbSearchEnv) : {}
  // company-newsrooms: same FILE contract as company-site (reuses
  // buildCompanySiteTargets + fetchCompanyPages), written to its own temp
  // .cache/ file, unless an operator pinned the targets/input/provider.
  const companyNewsroomsDerivedEnv =
    source === 'company-newsrooms' ? await resolveCompanyNewsroomsTargetsEnv(dbSearchEnv) : {}
  // Generalised profile-derived search env for the other search-capable
  // sources (hh, superjob, rabota-rossii). For habr-career,
  // funding-business-signals, egrul-fns, company-site, and company-newsrooms
  // the specialised resolvers above already emit their keys (or nothing —
  // neither company-* source has keyword params), so the generalised resolver
  // is skipped for them to avoid double-deriving / unnecessary profile loads.
  // Operator overrides in dbSearchEnv always win (resolver strips already-pinned
  // keys).
  const profileDerivedEnv =
    (source === 'habr-career' || source === 'funding-business-signals' || source === 'egrul-fns' || source === 'company-site' || source === 'company-newsrooms')
      ? {}
      : await resolveProfileSearchEnv(source, dbSearchEnv)
  const derivedSearchEnv = { ...profileDerivedEnv, ...habrDerivedEnv, ...fundingDerivedEnv, ...egrulDerivedEnv, ...companySiteDerivedEnv, ...companyNewsroomsDerivedEnv }

  return new Promise<IngestResult>((resolvePromise) => {
    // Filter env vars through whitelist — prevent injection of
    // DATABASE_URL, NODE_OPTIONS, PATH, etc.
    // Exclude searchEnvVars from caller-provided env (they come from DB).
    const filteredEnv = env ? filterEnvVars(env, searchEnvVars) : {}
    // Merge precedence (last wins):
    //   process.env → DB operator search prefs → profile-derived defaults → caller filtered env
    // Operator DB prefs and caller env override the profile-derived defaults; the
    // derived defaults only fill keys nobody pinned. This keeps a human able to
    // pin a query while letting the profile shape the default search.
    const mergedEnv = { ...process.env, ...dbSearchEnv, ...derivedSearchEnv, ...filteredEnv }
    // Windows exposes the inherited path case-insensitively (often as `Path`),
    // while Node child processes and our allowlist contract use `PATH`.
    if (process.env.PATH) mergedEnv.PATH = process.env.PATH

    // Resolve execFile via the bundler-opaque accessor so Turbopack does not
    // statically analyze this spawn as a `<dynamic>` module import (the script
    // is resolved and path-guarded above, then run in the Node.js runtime —
    // never bundled). See lib/lead-discovery/node-exec.ts.
    const spawnNodeScript = getExecFile()
    spawnNodeScript(
      'node',
      [scriptPath, 'pipeline'],
      {
        env: mergedEnv,
        // Per-source timeout (SourceConfig.timeoutMs) falling back to 120s.
        // Sources that legitimately exceed 120s end-to-end (career-pages: crawl
        // + post-loop DB write) declare a higher timeoutMs so the execFile kill
        // doesn't discard their fetched records.
        timeout: config.timeoutMs ?? 120_000,
        maxBuffer: 1024 * 1024, // 1 MB output buffer
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          const message = stderr?.trim() || error.message
          resolvePromise({
            source,
            success: false,
            outcome: 'failed',
            error: message,
            log: stdout?.trim() || undefined,
          })
          return
        }

        // Parse the final structured summary. Source CLIs pretty-print JSON,
        // so line-by-line parsing silently lost metrics while still reporting
        // success to daily-radar.
        const metrics = parseJsonMetrics(stdout)
        if (!metrics) {
          resolvePromise({
            source,
            success: false,
            outcome: 'missing-summary',
            error: 'Source process exited successfully without a structured runtime summary.',
            log: stdout?.trim() || undefined,
          })
          return
        }

        const classification = classifyIngestMetrics(metrics)

        resolvePromise({
          source,
          success: classification.success,
          outcome: classification.outcome,
          fetchedCount: metrics.fetchedCount,
          upsertedCount: metrics.upsertedCount,
          diagnostics: metrics.diagnostics,
          error: classification.error,
          log: stdout?.trim() || undefined,
        })
      }
    )
  })
}

/**
 * Run ingestion for all primary sources in parallel.
 * Returns results for each source, including failures.
 */
export async function ingestAllPrimarySources(
  env?: Record<string, string>
): Promise<IngestResult[] | NoActiveProfilesResult> {
  // Skip the pipeline when a DB is configured but holds zero active profiles.
  // A null count means no pool (test/dev without DB) — proceed as before, since
  // we cannot distinguish "no DB" from "empty DB" and downstream scripts handle
  // the no-DB case themselves.
  const activeProfiles = await countActiveProfiles()
  if (activeProfiles === 0) {
    return { error: 'no_active_profiles', hint: NO_ACTIVE_PROFILES_HINT }
  }
  const sources = getPrimarySourceIds()
  return Promise.all(sources.map(source => ingestSource(source, env)))
}

/**
 * Daily dependency-ordered source pipeline: hiring originators first, then
 * bounded company-owned supporting/context crawls derived from the resulting
 * organizations. Supporting failures remain visible in the combined result.
 */
export async function ingestDailyRadarSources(
  env?: Record<string, string>
): Promise<IngestResult[] | NoActiveProfilesResult> {
  const primaryResults = await ingestAllPrimarySources(env)
  if (isNoActiveProfiles(primaryResults)) return primaryResults

  const supportingSources = getDailySupportingSourceIds()
  const supportingResults = await Promise.all(
    supportingSources.map(source => ingestSource(source, env)),
  )
  return [...primaryResults, ...supportingResults]
}

interface ParsedSourceMetrics {
  fetchedCount?: number
  upsertedCount?: number
  diagnostics: IngestDiagnostics
}

/** Extract structured metrics from the final JSON object in stdout. */
function parseJsonMetrics(output: string): ParsedSourceMetrics | undefined {
  if (!output) return undefined
  const trimmed = output.trim()

  for (const candidate of extractJsonObjectCandidates(trimmed).reverse()) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const fetchedCount =
          typeof parsed.fetchedCount === 'number' ? parsed.fetchedCount
          : typeof parsed.recordsReceived === 'number' ? parsed.recordsReceived
          : undefined
        const upsertedCount =
          typeof parsed.upsertedCount === 'number' ? parsed.upsertedCount
          : typeof parsed.signalUpsertsCompleted === 'number' ? parsed.signalUpsertsCompleted
          : undefined
        if (fetchedCount !== undefined || upsertedCount !== undefined) {
          return {
            fetchedCount,
            upsertedCount,
            diagnostics: {
              parsedCount: numberValue(parsed.parsedRecords),
              normalizedCount: numberValue(parsed.normalizedRecords),
              duplicateCount: numberValue(parsed.duplicateRecords),
              skippedCount: numberValue(parsed.skippedRecords),
              organizationCount: numberValue(parsed.orgsCreated),
              evidenceCount: numberValue(parsed.evidenceUpsertsCompleted),
              zeroReason: stringValue(parsed.zeroReason),
            },
          }
        }
      }
    } catch {
      // not JSON, keep scanning
    }
  }
  return undefined
}

function extractJsonObjectCandidates(value: string): string[] {
  const starts: number[] = []
  const candidates: string[] = []
  let inString = false
  let escaped = false

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }
    if (character === '"' && starts.length > 0) {
      inString = true
      continue
    }
    if (character === '{') {
      starts.push(index)
      continue
    }
    if (character === '}' && starts.length > 0) {
      const start = starts.pop()
      if (start !== undefined) candidates.push(value.slice(start, index + 1))
    }
  }

  return candidates
}

function classifyIngestMetrics(metrics: ParsedSourceMetrics): {
  success: boolean
  outcome: IngestOutcome
  error?: string
} {
  const { fetchedCount, upsertedCount, diagnostics } = metrics

  if (fetchedCount === undefined || upsertedCount === undefined) {
    return {
      success: false,
      outcome: 'invalid-summary',
      error: 'Source runtime summary must report records received and signal upserts.',
    }
  }
  if (fetchedCount === 0) {
    return diagnostics.zeroReason
      ? { success: true, outcome: 'expected-zero' }
      : {
          success: false,
          outcome: 'unexpected-zero',
          error: 'Source returned zero records without an explicit zeroReason.',
        }
  }
  if (diagnostics.normalizedCount === 0) {
    return {
      success: false,
      outcome: 'normalization-zero',
      error: `Source received ${fetchedCount} records but normalized none.`,
    }
  }
  if (upsertedCount === 0) {
    return {
      success: false,
      outcome: 'ingestion-zero',
      error: 'Source normalized records but completed zero signal upserts.',
    }
  }
  return {
    success: true,
    outcome: (diagnostics.duplicateCount ?? 0) > 0
      ? 'ingested-with-duplicates'
      : 'ingested',
  }
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}
