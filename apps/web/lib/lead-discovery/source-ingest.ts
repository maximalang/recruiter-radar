/**
 * Source ingestion service — triggers data-fetch pipelines for lead sources.
 *
 * Instead of duplicating the ingestion logic from packages/db/scripts,
 * this module invokes the existing CLI scripts via child_process.
 * The scripts handle: API auth → fetch → normalize → upsert → signals.
 *
 * Available sources:
 *   - hh: HeadHunter vacancy ingestion (HH_USER_AGENT required)
 *   - superjob: SuperJob vacancy ingestion (SUPERJOB_API_KEY required)
 *   - habr-career: Habr Career vacancy ingestion
 *   - career-pages: Career page crawl + enrichment
 *   - egrul-fns: Company registry data
 *
 * Ingestion is idempotent — re-running for the same source upserts
 * (INSERT ON CONFLICT UPDATE) without creating duplicates.
 *
 * SECURITY: Extra env vars passed via `env` are filtered through a
 * whitelist (ALLOWED_ENV_PREFIXES) to prevent injection of dangerous
 * keys like DATABASE_URL, NODE_OPTIONS, or PATH.
 *
 * RUNTIME: Requires Node.js runtime (child_process). Will not work
 * in Edge/serverless runtimes (Vercel Edge, Cloudflare Workers).
 */

import { execFile } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/db/scripts'
)

export type SourceId = 'hh' | 'superjob' | 'habr-career' | 'career-pages' | 'egrul-fns'

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
 * Allowed env var prefixes for the `env` parameter.
 *
 * Only source-specific config keys are permitted — never infrastructure
 * keys (DATABASE_URL, NODE_OPTIONS, PATH, HOME, etc.) which could be
 * used to redirect DB connections or execute arbitrary code.
 */
const ALLOWED_ENV_PREFIXES = [
  'HH_',
  'SUPERJOB_',
  'HABR_',
  'CRAWLER_',
  'FIRECRAWL_',
  'SOURCE_',
]

function filterEnvVars(env: Record<string, string>): Record<string, string> {
  const filtered: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (ALLOWED_ENV_PREFIXES.some(prefix => key.startsWith(prefix))) {
      filtered[key] = value
    }
  }
  return filtered
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
  const scriptName = SCRIPT_MAP[source]
  if (!scriptName) {
    return { source, success: false, error: `Unknown source: ${source}` }
  }

  const scriptPath = resolve(SCRIPT_DIR, scriptName)

  // Guard: ensure resolved path doesn't escape scripts dir (path traversal)
  if (!scriptPath.startsWith(SCRIPT_DIR)) {
    return { source, success: false, error: `Script path escapes scripts directory: ${scriptName}` }
  }

  return new Promise<IngestResult>((resolvePromise) => {
    // Filter env vars through whitelist — prevent injection of
    // DATABASE_URL, NODE_OPTIONS, PATH, etc.
    const filteredEnv = env ? filterEnvVars(env) : {}
    const mergedEnv = { ...process.env, ...filteredEnv }

    execFile(
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
): Promise<IngestResult[]> {
  const sources: SourceId[] = ['hh', 'superjob', 'habr-career']
  return Promise.all(sources.map(source => ingestSource(source, env)))
}

/** Map source ID to ingestion script filename. */
const SCRIPT_MAP: Record<SourceId, string> = {
  'hh': 'ingest-hh.mjs',
  'superjob': 'source-superjob.mjs',
  'habr-career': 'source-habr-career.mjs',
  'career-pages': 'source-career-pages.mjs',
  'egrul-fns': 'source-egrul-fns.mjs',
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
