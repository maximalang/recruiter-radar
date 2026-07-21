/**
 * Company-site / company-newsrooms targets builder — pure function.
 *
 * SHARED by two no-secrets sources whose live-public mode takes a FILE (a JSON
 * array the script `existsSync`s), not an inline env value: company-site
 * (`COMPANY_SITE_TARGETS_FILE`) and company-newsrooms
 * (`COMPANY_NEWSROOMS_TARGETS_FILE`). Both consume the same `fetchCompanyPages`
 * adapter with the identical target shape, so one builder shapes the rows for
 * both; `source-ingest.ts` owns the per-source query + temp-file write
 * (`resolveCompanySiteTargetsEnv` / `resolveCompanyNewsroomsTargetsEnv`) and
 * injects the path. The temp `.cache/` pattern mirrors career-pages' discovered-
 * targets snapshot.
 *
 * Target shape (matches `fetchCompanyPages` in
 * packages/db/scripts/adapters/company-site-crawl.mjs):
 *   { url: string, company_name?: string, company_domain?: string }
 * A bare string is also accepted by the adapter, but we always emit the object
 * form so the crawled record carries the org's legal name + domain for entity
 * resolution (stronger source keys than a bare URL).
 *
 * Selection mirrors career-pages auto-discovery: orgs that already have a
 * corporate surface (domain / website_url) AND at least one hiring signal from
 * a job-board source, prioritised by freshest signal. Both sources are
 * supporting-evidence-only / context-only (isPrimary:false) — they corroborate
 * existing leads and surface direct company/contact/newsroom pages, so we only
 * target orgs the radar is ALREADY tracking, never cold domains.
 */

export type CompanySiteTarget = {
  url: string
  company_name?: string
  company_domain?: string
}

/** Raw DB row the resolver selects — typed at the boundary, mapped by the pure builder. */
export type CompanySiteTargetRow = {
  id: string | number
  name: string | null
  domain: string | null
  website_url: string | null
}

/**
 * Derive a website URL for a target, preferring the org's explicit website_url
 * and falling back to https://<domain> when only the domain is known. Returns
 * null when neither is usable — the org is skipped (never fabricated). Blank /
 * whitespace-only values are treated as absent (the SQL resolver BTRIMs too,
 * but the pure builder stays robust to any caller).
 */
function deriveTargetUrl(domain: string | null, websiteUrl: string | null): string | null {
  const cleanDomain = domain?.trim() || null
  const cleanWebsite = websiteUrl?.trim() || null
  if (cleanWebsite && /^https?:\/\//i.test(cleanWebsite)) return cleanWebsite
  if (cleanWebsite) {
    // website_url without a scheme — prefix https:// so fetchCompanyPage's
    // `new URL(...)` does not throw. The adapter follows redirects, so http
    // sites still resolve.
    return `https://${cleanWebsite}`
  }
  if (cleanDomain) return `https://${cleanDomain}`
  return null
}

/**
 * Build the company-site target list from org rows.
 *
 * - Drops rows with no usable URL (no website_url AND no domain).
 * - Emits the object form: { url, company_name, company_domain }.
 * - Dedupes by normalized URL (case-insensitive) — two orgs sharing a domain
 *   produce one crawl, not two (the adapter is per-URL, not per-org).
 * - Preserves the row order (the resolver sorts by freshest signal first, so
 *   the most active companies are crawled within the per-run target cap).
 *
 * Pure: no DB, no FS, no env. The resolver in source-ingest.ts owns the query
 * and the temp-file write; this function only shapes the rows into targets.
 */
export function buildCompanySiteTargets(rows: ReadonlyArray<CompanySiteTargetRow>): CompanySiteTarget[] {
  const seen = new Set<string>()
  const targets: CompanySiteTarget[] = []

  for (const row of rows) {
    const url = deriveTargetUrl(row.domain, row.website_url)
    if (!url) continue

    const key = url.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    const target: CompanySiteTarget = { url }
    if (row.name && row.name.trim() !== '') {
      target.company_name = row.name.trim()
    }
    if (row.domain && row.domain.trim() !== '') {
      target.company_domain = row.domain.trim().toLowerCase()
    }
    targets.push(target)
  }

  return targets
}

/**
 * Maximum company-site targets to crawl per run. Each target is one HTTP fetch
 * (concurrency 3 in the adapter), so bounding the count bounds crawl time and
 * load on company sites. The freshest-signal orgs are prioritised by the
 * resolver's ORDER BY, so the cap keeps the crawl focused on the companies the
 * radar is most actively tracking.
 */
export const MAX_COMPANY_SITE_TARGETS_PER_RUN = 30
