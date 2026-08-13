import { validateCrawlerUrl as validateCanonicalCrawlerUrl } from '@/../../packages/db/scripts/adapters/crawler-url-security.mjs'

export interface UrlValidationResult {
  valid: boolean
  reason?: string
}

/** Canonical crawler URL policy; implementation is shared with DB-side browser crawling. */
export function validateCrawlerUrl(url: string): UrlValidationResult {
  return validateCanonicalCrawlerUrl(url)
}
