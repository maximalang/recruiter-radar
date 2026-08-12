import {
  buildTrackedCompanyGdeltQueries,
  GDELT_CONTEXT_QUERY,
  MAX_GDELT_QUERIES,
} from '@/lib/lead-discovery/gdelt-query-builder'

describe('buildTrackedCompanyGdeltQueries', () => {
  it('binds every query to an existing company name and strong domain identity', () => {
    expect(buildTrackedCompanyGdeltQueries([
      { companyName: 'ООО Рокет Скейл', companyDomain: 'rocketscale.ru' },
    ])).toEqual([{
      query: `"ООО Рокет Скейл" ${GDELT_CONTEXT_QUERY}`,
      company_name: 'ООО Рокет Скейл',
      company_domain: 'rocketscale.ru',
      max_records: 10,
      timespan: '30d',
    }])
  })

  it('rejects industry-only, placeholder, and domainless targets', () => {
    expect(buildTrackedCompanyGdeltQueries([
      { companyName: 'финтех', companyDomain: null },
      { companyName: 'INN 7707083893', companyDomain: 'placeholder.example' },
      { companyName: '', companyDomain: 'empty-name.example' },
    ])).toEqual([])
  })

  it('normalizes and dedupes by company domain', () => {
    const queries = buildTrackedCompanyGdeltQueries([
      { companyName: '  Rocket   Scale  ', companyDomain: 'RocketScale.RU' },
      { companyName: 'Rocket Scale duplicate', companyDomain: 'rocketscale.ru' },
    ])

    expect(queries).toHaveLength(1)
    expect(queries[0].company_name).toBe('Rocket Scale')
    expect(queries[0].company_domain).toBe('rocketscale.ru')
  })

  it('sanitizes quote characters instead of changing GDELT query structure', () => {
    const [query] = buildTrackedCompanyGdeltQueries([
      { companyName: 'АО "Тест"', companyDomain: 'test.ru' },
    ])

    expect(query.query).toBe(`"АО Тест" ${GDELT_CONTEXT_QUERY}`)
  })

  it('keeps the public API request budget bounded', () => {
    const targets = Array.from({ length: MAX_GDELT_QUERIES + 5 }, (_, index) => ({
      companyName: `Company ${index}`,
      companyDomain: `company-${index}.ru`,
    }))

    expect(buildTrackedCompanyGdeltQueries(targets)).toHaveLength(MAX_GDELT_QUERIES)
    expect(MAX_GDELT_QUERIES).toBeGreaterThan(0)
    expect(MAX_GDELT_QUERIES).toBeLessThanOrEqual(4)
  })

  it('uses an explicit context-only business event vocabulary', () => {
    expect(GDELT_CONTEXT_QUERY).toContain('funding')
    expect(GDELT_CONTEXT_QUERY).toContain('investment')
    expect(GDELT_CONTEXT_QUERY).toContain('hiring')
    expect(GDELT_CONTEXT_QUERY).toContain('acquisition')
    expect(GDELT_CONTEXT_QUERY).toContain('new factory')
    expect(GDELT_CONTEXT_QUERY).toContain('government contract')
    expect(GDELT_CONTEXT_QUERY).toContain('restructuring')
    expect(GDELT_CONTEXT_QUERY).toContain('layoffs')
  })
})
