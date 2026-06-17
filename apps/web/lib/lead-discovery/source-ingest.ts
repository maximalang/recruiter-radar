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
  getAllEnvPrefixes,
  getSearchEnvVars,
  type SourceId,
} from '@/lib/sources/source-registry'
import { getPool } from '@/lib/db-pool'

export type { SourceId } from '@/lib/sources/source-registry'

const SCRIPT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/db/scripts'
)

export interface IngestResult {
  source: SourceId
  success: boolean
  /** Items fetched from the API. */
  fetchedCount?: number
  /** Items upserted into signals table. */
  upsertedCount?: number
  /** Stdout lines (for diagnostics). */
  log?: string
  /** Error message if success is false. */
  error?: string
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
    return { source, success: false, error: `Unknown source: ${source}` }
  }
  const scriptPath = resolve(SCRIPT_DIR, config.script)

  // Guard: ensure resolved path doesn't escape scripts dir (path traversal)
  if (!scriptPath.startsWith(SCRIPT_DIR)) {
    return { source, success: false, error: `Script path escapes scripts directory: ${config.script}` }
  }

  // Load search params from user_search_preferences (DB), falling back to ENV
  const dbSearchEnv = await loadSearchPrefsFromDb(source)
  const searchEnvVars = getSearchEnvVars(source)

  return new Promise<IngestResult>((resolvePromise) => {
    // Filter env vars through whitelist — prevent injection of
    // DATABASE_URL, NODE_OPTIONS, PATH, etc.
    // Exclude searchEnvVars from caller-provided env (they come from DB).
    const filteredEnv = env ? filterEnvVars(env, searchEnvVars) : {}
    // Merge: process.env → DB search prefs → caller filtered env
    const mergedEnv = { ...process.env, ...dbSearchEnv, ...filteredEnv }

    // Resolve execFile via the bundler-opaque accessor so Turbopack does not
    // statically analyze this spawn as a `<dynamic>` module import (the script
    // is resolved and path-guarded above, then run in the Node.js runtime —
    // never bundled). See lib/lead-discovery/node-exec.ts.
    const spawnNodeScript = getExecFile()
    spawnNodeScript(
      'node',
      [scriptPath],
      {
        env: mergedEnv,
        timeout: 120_000, // 2 min timeout — API + DB round-trips
        maxBuffer: 1024 * 1024, // 1 MB output buffer
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          const message = stderr?.trim() || error.message
          resolvePromise({
            source,
            success: false,
            error: message,
            log: stdout?.trim() || undefined,
          })
          return
        }

        // Parse JSON metrics from last line of stdout
        const metrics = parseJsonMetrics(stdout)
        const fetchedCount = metrics?.fetchedCount
        const upsertedCount = metrics?.upsertedCount

        resolvePromise({
          source,
          success: true,
          fetchedCount,
          upsertedCount,
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

/** Extract structured metrics from the last JSON line of stdout. */
function parseJsonMetrics(output: string): { fetchedCount?: number; upsertedCount?: number } | undefined {
  if (!output) return undefined
  const lines = output.trim().split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line) continue
    try {
      const parsed = JSON.parse(line)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // Map known output formats to unified metrics
        const fetchedCount =
          typeof parsed.fetchedCount === 'number' ? parsed.fetchedCount
          : typeof parsed.recordsReceived === 'number' ? parsed.recordsReceived
          : undefined
        const upsertedCount =
          typeof parsed.upsertedCount === 'number' ? parsed.upsertedCount
          : typeof parsed.signalUpsertsCompleted === 'number' ? parsed.signalUpsertsCompleted
          : undefined
        if (fetchedCount !== undefined || upsertedCount !== undefined) {
          return { fetchedCount, upsertedCount }
        }
      }
    } catch {
      // not JSON, keep scanning
    }
  }
  return undefined
}
