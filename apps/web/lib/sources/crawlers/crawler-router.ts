/**
 * CrawlerEngine router.
 *
 * Single configuration point that maps a target URL (and an optional caller
 * hint) to the right engine. Adapters call the router, never specific
 * engines, so swapping in a new SPA renderer or markdown sidecar is a
 * one-line change here.
 *
 * Default policy:
 *   - hint='static'   → static engine (overrides host detection)
 *   - hint='spa'      → SPA engine
 *   - hint='newsroom' → LLM-markdown engine (clean text from cluttered HTML)
 *   - hint='pdf'      → LLM-markdown engine (PDF-aware extraction)
 *   - host on the SPA allow-list → SPA engine
 *   - everything else → static engine
 *
 * If the chosen engine is not registered (e.g. SPA picked but Playwright
 * is not installed), the router falls back to the static engine and adds
 * a warning to the result. If even static is missing, it throws — the
 * caller has misconfigured the router.
 */

import type {
  CrawlerEngine,
  CrawlerEngineId,
  CrawlerFetchInput,
  CrawlerOptions,
  CrawlerResult,
} from './crawler-contract'

const SPA_HOSTS = [
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'myworkdayjobs.com',
  'smartrecruiters.com',
] as const

function getHostname(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.toLowerCase()
  } catch {
    return null
  }
}

function hostMatches(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`)
}

export function chooseEngine(
  url: string,
  hint?: CrawlerOptions['hint'],
): CrawlerEngineId {
  if (hint === 'static') return 'static'
  if (hint === 'spa') return 'spa'
  if (hint === 'newsroom' || hint === 'pdf') return 'llm-markdown'

  const host = getHostname(url)
  if (!host) return 'static'

  if (SPA_HOSTS.some((suffix) => hostMatches(host, suffix))) return 'spa'
  return 'static'
}

export type EngineRegistry = Partial<Record<CrawlerEngineId, CrawlerEngine>>

export interface CrawlerRouter {
  fetch(input: CrawlerFetchInput): Promise<CrawlerResult>
}

export function createCrawlerRouter(engines: EngineRegistry): CrawlerRouter {
  return {
    async fetch(input: CrawlerFetchInput): Promise<CrawlerResult> {
      const target = chooseEngine(input.url, input.options?.hint)
      const fallbackWarnings: string[] = []

      let engine = engines[target]
      if (!engine && target !== 'static') {
        fallbackWarnings.push(
          `engine "${target}" not registered — falling back to static`,
        )
        engine = engines.static
      }
      if (!engine) {
        throw new Error(
          `crawler-router: no engine registered to handle ${input.url} (wanted ${target})`,
        )
      }

      const result = await engine.fetch(input)
      if (fallbackWarnings.length > 0) {
        return { ...result, warnings: [...result.warnings, ...fallbackWarnings] }
      }
      return result
    },
  }
}
