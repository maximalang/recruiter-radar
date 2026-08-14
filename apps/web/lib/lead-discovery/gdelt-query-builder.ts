/**
 * Identity-bound GDELT queries for tracked companies.
 *
 * GDELT is context only. A broad industry query cannot identify the company
 * discussed by an article, so automatic queries are created only for an
 * organization that already has hiring evidence plus a strong domain key.
 */

export interface TrackedCompanyGdeltTarget {
  companyName: string | null
  companyDomain: string | null
}

export interface TrackedCompanyGdeltQuery {
  query: string
  company_name: string
  company_domain: string
  max_records: number
  timespan: string
}

export const MAX_GDELT_QUERIES = 4
export const GDELT_CONTEXT_QUERY = '(funding OR investment OR acquisition OR merger OR expansion OR "new office" OR "new factory" OR launch OR hiring OR "government contract" OR restructuring OR layoffs)'

export function buildTrackedCompanyGdeltQueries(
  targets: TrackedCompanyGdeltTarget[],
): TrackedCompanyGdeltQuery[] {
  const queries: TrackedCompanyGdeltQuery[] = []
  const seenDomains = new Set<string>()

  for (const target of targets) {
    if (queries.length >= MAX_GDELT_QUERIES) break

    const companyName = normalizeCompanyName(target.companyName)
    const companyDomain = normalizeCompanyDomain(target.companyDomain)
    if (!companyName || !companyDomain || seenDomains.has(companyDomain)) continue

    seenDomains.add(companyDomain)
    queries.push({
      query: `"${companyName}" ${GDELT_CONTEXT_QUERY}`,
      company_name: companyName,
      company_domain: companyDomain,
      max_records: 10,
      timespan: '30d',
    })
  }

  return queries
}

function normalizeCompanyName(value: string | null): string | null {
  if (typeof value !== 'string') return null

  const normalized = value
    .replace(/["\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)

  if (normalized.length < 2 || /^(?:INN|OGRN|ИНН|ОГРН)\s+\d+$/i.test(normalized)) {
    return null
  }

  return normalized
}

function normalizeCompanyDomain(value: string | null): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
  if (!/^(?=.{4,253}$)(?:[a-z0-9а-яё](?:[a-z0-9а-яё-]{0,61}[a-z0-9а-яё])?\.)+[a-zа-яё]{2,63}$/iu.test(normalized)) {
    return null
  }

  return normalized
}
