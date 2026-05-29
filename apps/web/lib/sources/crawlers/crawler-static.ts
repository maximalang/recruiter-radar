/**
 * Static crawler engine.
 *
 * HTTP fetch + raw HTML body return, no JS execution. The default engine
 * for static career pages, listing pages, and any host that serves
 * server-rendered HTML. Cheap and fast — measured in ~50–500ms per page,
 * no chromium binary, no sidecar.
 *
 * Errors: network failures propagate. Non-2xx responses are returned as
 * CrawlerResult with the raw status and body so adapters can decide
 * whether to retry, drop, or escalate to the SPA engine.
 */

import type {
  CrawlerEngine,
  CrawlerFetchInput,
  CrawlerResult,
} from './crawler-contract'
// @ts-expect-error — adapter is .mjs without typings; structural use is safe
import { fetchText } from '@/../../packages/db/scripts/adapters/source-http.mjs'

const DEFAULT_USER_AGENT = 'recruiter-radar/1.0 (+https://recruiter-radar.local)'
const DEFAULT_TIMEOUT_MS = 15_000

export type StaticFetcher = (
  url: string,
  init?: RequestInit,
) => Promise<Response>

export interface CreateStaticEngineOptions {
  /** Inject a fetcher for tests. Defaults to the global fetch. */
  fetcher?: StaticFetcher
  /** Override the default User-Agent (rare — usually set per-request). */
  defaultUserAgent?: string
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    out[key] = value
  })
  return out
}

function mergeHeaders(
  defaultUserAgent: string,
  caller?: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'ru,en;q=0.9',
    'user-agent': defaultUserAgent,
  }
  if (caller) {
    for (const [k, v] of Object.entries(caller)) {
      merged[k.toLowerCase()] = v
    }
  }
  return merged
}

export function createStaticEngine(
  options: CreateStaticEngineOptions = {},
): CrawlerEngine {
  const fetcher: StaticFetcher = options.fetcher ?? ((url, init) => fetch(url, init))
  const defaultUa = options.defaultUserAgent ?? DEFAULT_USER_AGENT

  return {
    id: 'static',
    capabilities: {
      rendersJs: false,
      bypassesCloudflare: false,
      returnsMarkdown: false,
      supportsPdf: false,
      selfHosted: true,
    },
    async fetch(input: CrawlerFetchInput): Promise<CrawlerResult> {
      const { url, options: opts = {} } = input
      const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      const init: RequestInit = {
        method: 'GET',
        headers: mergeHeaders(defaultUa, opts.headers),
        signal: opts.signal ?? controller.signal,
        redirect: 'follow',
      }

      try {
        const { response, body: html } = (await fetchText(url, {
          sourceName: `static crawler fetch`,
          headers: init.headers as Record<string, string>,
          signal: init.signal,
          redirect: 'follow',
        })) as { response: Response; body: string }

        const rawHeaders: Record<string, string> = {}
        response.headers.forEach((value, key) => {
          rawHeaders[key.toLowerCase()] = value
        })

        return {
          url,
          status: response.status,
          html,
          rawHeaders,
          fetchedAt: new Date().toISOString(),
          engine: 'static',
          warnings: [],
        }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
