import {
  buildCompanySiteTargets,
  MAX_COMPANY_SITE_TARGETS_PER_RUN,
  type CompanySiteTargetRow,
} from '@/lib/lead-discovery/company-site-targets'

describe('buildCompanySiteTargets', () => {
  it('emits the object form {url, company_name, company_domain} for rows with a domain', () => {
    const targets = buildCompanySiteTargets([
      { id: 1, name: 'АО Ромашка', domain: 'romashka.ru', website_url: null },
    ])
    expect(targets).toHaveLength(1)
    expect(targets[0]).toEqual({
      url: 'https://romashka.ru',
      company_name: 'АО Ромашка',
      company_domain: 'romashka.ru',
    })
  })

  it('prefers an explicit https website_url over the domain', () => {
    const targets = buildCompanySiteTargets([
      { id: 2, name: 'ООО Вектор', domain: 'vector.ru', website_url: 'https://www.vector.ru/careers' },
    ])
    expect(targets[0]?.url).toBe('https://www.vector.ru/careers')
    expect(targets[0]?.company_domain).toBe('vector.ru')
  })

  it('prefixes https:// onto a scheme-less website_url', () => {
    const targets = buildCompanySiteTargets([
      { id: 3, name: null, domain: null, website_url: 'example.com' },
    ])
    expect(targets[0]?.url).toBe('https://example.com')
    // no domain, no name → only url is emitted
    expect(targets[0]?.company_domain).toBeUndefined()
    expect(targets[0]?.company_name).toBeUndefined()
  })

  it('drops rows with no usable URL (no website_url AND no domain)', () => {
    const targets = buildCompanySiteTargets([
      { id: 4, name: 'No Web', domain: null, website_url: null },
      { id: 5, name: 'Blank', domain: '  ', website_url: '   ' },
    ])
    expect(targets).toHaveLength(0)
  })

  it('dedupes by normalized URL (two orgs sharing a domain → one crawl)', () => {
    const targets = buildCompanySiteTargets([
      { id: 6, name: 'First', domain: 'shared.ru', website_url: null },
      { id: 7, name: 'Second', domain: 'SHARED.RU', website_url: 'https://shared.ru' },
    ])
    // both derive to https://shared.ru (case-insensitive) → one target
    expect(targets).toHaveLength(1)
    expect(targets[0]?.url).toBe('https://shared.ru')
  })

  it('trims whitespace in name and lowercases the domain', () => {
    const targets = buildCompanySiteTargets([
      { id: 8, name: '  Trimming Corp  ', domain: '  Trimming.COM  ', website_url: null },
    ])
    expect(targets[0]?.company_name).toBe('Trimming Corp')
    expect(targets[0]?.company_domain).toBe('trimming.com')
  })

  it('preserves row order (freshest-signal orgs first, set by the resolver)', () => {
    const rows: CompanySiteTargetRow[] = [
      { id: 10, name: 'Freshest', domain: 'freshest.ru', website_url: null },
      { id: 9, name: 'Stale', domain: 'stale.ru', website_url: null },
      { id: 8, name: 'Oldest', domain: 'oldest.ru', website_url: null },
    ]
    const targets = buildCompanySiteTargets(rows)
    expect(targets.map(t => t.company_name)).toEqual(['Freshest', 'Stale', 'Oldest'])
  })

  it('emits {url, company_domain} (no name) when the row has only a domain and no name', () => {
    const targets = buildCompanySiteTargets([
      { id: 11, name: null, domain: 'noname.ru', website_url: null },
    ])
    // domain is known → company_domain is populated; only the name is absent.
    expect(targets[0]).toEqual({ url: 'https://noname.ru', company_domain: 'noname.ru' })
  })

  it('handles an empty row list', () => {
    expect(buildCompanySiteTargets([])).toEqual([])
  })

  it('MAX_COMPANY_SITE_TARGETS_PER_RUN is a small, positive bound', () => {
    expect(MAX_COMPANY_SITE_TARGETS_PER_RUN).toBeGreaterThan(0)
    expect(MAX_COMPANY_SITE_TARGETS_PER_RUN).toBeLessThanOrEqual(50)
  })
})
