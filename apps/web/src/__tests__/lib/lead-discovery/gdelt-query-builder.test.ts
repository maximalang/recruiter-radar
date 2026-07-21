import {
  buildProfileGdeltQueries,
  GDELT_CONTEXT_VERBS_LIST,
  MAX_GDELT_QUERIES,
} from '@/lib/lead-discovery/gdelt-query-builder'
import { INDUSTRY_KEYWORDS, VALID_INDUSTRIES } from '@/lib/clientProfiles'

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function makeInput(overrides: {
  roles?: string[]
  industries?: string[]
  excludedIndustries?: string[]
  includeKeywords?: string[]
  excludeKeywords?: string[]
  targetCity?: string | null
} = {}) {
  return {
    roles: [],
    industries: [],
    excludedIndustries: [],
    includeKeywords: [],
    excludeKeywords: [],
    targetCity: null,
    ...overrides,
  }
}

describe('buildProfileGdeltQueries', () => {
  it('pairs each profile industry primary term with every context verb', () => {
    const queries = buildProfileGdeltQueries(makeInput({ industries: ['finance'] }))
    const primaryTerm = INDUSTRY_KEYWORDS.get('finance')![0]
    const list = queries.split('\n')
    // one query per verb, each = "<primaryTerm> <verb>"
    expect(list).toHaveLength(GDELT_CONTEXT_VERBS_LIST.length)
    for (const verb of GDELT_CONTEXT_VERBS_LIST) {
      expect(list).toContain(`${primaryTerm} ${verb}`)
    }
  })

  it('joins queries with newline (parseGdeltQueries splits on \\n|;)', () => {
    const queries = buildProfileGdeltQueries(makeInput({ industries: ['it'] }))
    expect(queries).toContain('\n')
    // Each line is a single non-empty query.
    for (const line of queries.split('\n')) {
      expect(line.trim().length).toBeGreaterThan(0)
    }
  })

  it('uses only the PRIMARY industry term (first INDUSTRY_KEYWORDS entry), not the full list', () => {
    const queries = buildProfileGdeltQueries(makeInput({ industries: ['it'] }))
    const allTerms = INDUSTRY_KEYWORDS.get('it')!
    const primaryTerm = allTerms[0]
    // The primary term appears in every query.
    for (const line of queries.split('\n')) {
      expect(line.startsWith(primaryTerm + ' ')).toBe(true)
    }
    // Non-primary industry terms do NOT appear as the query subject.
    for (const extra of allTerms.slice(1)) {
      expect(queries).not.toMatch(new RegExp(`^${extra} `, 'm'))
    }
  })

  it('skips excluded industries entirely', () => {
    const queries = buildProfileGdeltQueries(
      makeInput({ industries: ['it', 'finance'], excludedIndustries: ['finance'] }),
    )
    const financePrimary = INDUSTRY_KEYWORDS.get('finance')![0]
    const itPrimary = INDUSTRY_KEYWORDS.get('it')![0]
    // finance is excluded → no query line STARTS with the finance primary term.
    // (Substring check would false-positive: 'финанс' is a stem that appears
    // inside the verb 'финансирование' even in it-industry queries. The real
    // contract is that no query is *about* finance, i.e. no line begins with it.)
    expect(queries).not.toMatch(new RegExp(`^${escapeRegex(financePrimary)} `, 'm'))
    // it is included → at least one query line starts with the it primary term.
    expect(queries).toMatch(new RegExp(`^${escapeRegex(itPrimary)} `, 'm'))
  })

  it('ignores unknown industries', () => {
    const queries = buildProfileGdeltQueries(
      makeInput({ industries: ['not-an-industry'] }),
    )
    expect(queries).toBe('')
  })

  it('returns empty string when no industries are declared', () => {
    expect(buildProfileGdeltQueries(makeInput())).toBe('')
    expect(buildProfileGdeltQueries(makeInput({ roles: ['hr'] }))).toBe('')
  })

  it('dedupes case-insensitively when two profiles union the same industry', () => {
    // Simulate the union case: industries list with a repeat (the union helper
    // already dedupes, but the builder must be robust to it).
    const queries = buildProfileGdeltQueries(
      makeInput({ industries: ['it', 'it'] }),
    )
    const list = queries.split('\n')
    expect(new Set(list.map(q => q.toLowerCase())).size).toBe(list.length)
  })

  it('caps total queries at MAX_GDELT_QUERIES even with many industries', () => {
    // All 17 industries × 8 verbs would be 136 queries; must cap.
    const allIndustries = [...VALID_INDUSTRIES]
    const queries = buildProfileGdeltQueries(
      makeInput({ industries: allIndustries }),
    )
    const list = queries.split('\n').filter(Boolean)
    expect(list.length).toBeLessThanOrEqual(MAX_GDELT_QUERIES)
  })

  it('MAX_GDELT_QUERIES is a small bound (protects the public GDELT API load)', () => {
    expect(MAX_GDELT_QUERIES).toBeLessThanOrEqual(16)
    expect(MAX_GDELT_QUERIES).toBeGreaterThanOrEqual(1)
  })

  it('every context verb is a non-empty string', () => {
    for (const verb of GDELT_CONTEXT_VERBS_LIST) {
      expect(typeof verb).toBe('string')
      expect(verb.trim().length).toBeGreaterThan(0)
    }
  })

  it('produces Russia-first queries (Russian verbs present)', () => {
    const queries = buildProfileGdeltQueries(makeInput({ industries: ['it'] }))
    expect(queries).toContain('финансирование')
    expect(queries).toContain('инвестиции')
  })
})
