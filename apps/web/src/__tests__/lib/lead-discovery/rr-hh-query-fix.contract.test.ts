/**
 * Contract tests for the RR HH generated-query fix (night audit 2026-10-11).
 *
 * SCOPE
 * These tests pin the *generated-tool-call contract* of the source-scoped query
 * builder, not HH's live ranking. They exist to discriminate one specific former
 * defect: `buildProfileSearchEnv('hh', …)` composed the profile keyword list with
 * `keywords.join(' ')`, and HH's query language reads a bare word list as an
 * implicit AND. An all-role profile (11 roles) therefore produced a 21-term
 * conjunction that matched nothing — the audit measured found=0 where the
 * control query 'рекрутер' returned 7085.
 *
 * RED-on-base / GREEN-on-candidate cases are marked [DISCRIMINATOR]: on the
 * frozen base 9b99e3ed61ca479276e52d0c3fcf9edb904d10f4 they fail, because the
 * generated text contains no `OR` operator and the phrase boundaries are lost.
 *
 * Official syntax reference (retrieved 2026-10-13):
 *   https://hh.ru/article/1175 — "Язык поисковых запросов":
 *   OR (at least one operand), "..." (adjacent phrase), AND, NOT, `!` exact
 *   form, `*` wildcard, `field:`, parentheses.
 *
 * INVARIANTS that must NOT change (kill criteria if they do):
 *   - no role is dropped from the generated query;
 *   - an explicit operator/ENV query pin keeps its prior precedence and bytes;
 *   - every non-HH source env is byte-identical to the pre-fix output;
 *   - zero-status classification is untouched (classifyIngestMetrics, adapter).
 */

import {
  buildHhDisjunctiveQuery,
  buildProfileSearchEnv,
  HH_QUERY_MAX_LENGTH,
  ROLE_SEARCH_KEYWORDS,
} from '@/lib/lead-discovery/search-query-builder'
import { VALID_ROLES } from '@/lib/clientProfiles'
import type { SourceId } from '@/lib/sources/source-registry'

function makeInput(overrides: Partial<Parameters<typeof buildProfileSearchEnv>[1]> = {}) {
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

/** Every canonical role that actually contributes keywords. */
const ALL_KEYWORD_ROLES = Object.keys(ROLE_SEARCH_KEYWORDS).filter(
  (role) => ROLE_SEARCH_KEYWORDS[role].length > 0,
)

function hhText(input: Parameters<typeof buildProfileSearchEnv>[1]): string {
  const env = buildProfileSearchEnv('hh' as SourceId, input)
  const text = env.HH_SEARCH_TEXT
  expect(text).toBeDefined()
  return text as string
}

describe('RR HH generated-query contract (night audit 2026-10-11)', () => {
  // ---------------------------------------------------------------- case 1
  it('[DISCRIMINATOR] all-role profile renders as an OR-disjunction, never an implicit-AND word list', () => {
    expect(VALID_ROLES.has('other')).toBe(true)
    // Guard the fixture: this must really be the audited all-role profile.
    expect(ALL_KEYWORD_ROLES.length).toBe(10)

    const text = hhText(makeInput({ roles: ALL_KEYWORD_ROLES }))

    // Former defect: `keywords.join(' ')` => 21 space-separated terms, no OR.
    // HH reads that as "document contains ALL the words" => found=0.
    const termCount = text.split(' OR ').length
    expect(termCount).toBeGreaterThanOrEqual(20)
    expect(text).toContain(' OR ')
    expect(text).not.toMatch(/^[^\s]+(\s+[^\s"]+)+$/)

    // Every generated term survives: no top-N truncation, no role loss.
    for (const role of ALL_KEYWORD_ROLES) {
      for (const kw of ROLE_SEARCH_KEYWORDS[role]) {
        expect(text.toLowerCase()).toContain(kw.toLowerCase())
      }
    }
    // Safety budget from the spec: a generated request stays <= 512 chars.
    expect(text.length).toBeLessThanOrEqual(HH_QUERY_MAX_LENGTH)
  })

  // ---------------------------------------------------------------- case 2
  it('single-role profile emits its keyword without a trailing/dangling OR', () => {
    const text = hhText(makeInput({ roles: ['legal'] }))
    expect(text).toBe('юрист')
    expect(text).not.toMatch(/^\s*OR/)
    expect(text).not.toMatch(/OR\s*$/)
    expect(text).not.toMatch(/\sOR\s+OR\s/)
  })

  // ---------------------------------------------------------------- case 3
  it('multi-word keyword becomes one quoted phrase (not its own implicit AND)', () => {
    // 'менеджер по продажам' is three words: as a bare term HH would require all
    // three anywhere in the document; quoted, it is ONE alternative.
    const text = hhText(makeInput({ roles: ['sales'] }))
    expect(text).toContain('"менеджер по продажам"')
    expect(text).toContain('"sales manager"')
    // A phrase must not be split by an OR in the middle of the words.
    expect(text).not.toMatch(/менеджер OR по OR продажам/)
  })

  // ---------------------------------------------------------------- case 4
  it('duplicate terms are emitted once (case-insensitive dedup preserved)', () => {
      const text = hhText(
        makeInput({ roles: ['marketing'], includeKeywords: ['Маркетолог', 'маркетолог'] }),
      )
      const occurrences = (text.toLowerCase().match(/маркетолог/g) ?? []).length
      expect(occurrences).toBe(1)
    })

  // ---------------------------------------------------------------- case 5
  it('empty roles (disabled profile) yields no generated query at all', () => {
    const env = buildProfileSearchEnv('hh' as SourceId, makeInput({ roles: [] }))
    expect(env).toEqual({})
  })

  // ---------------------------------------------------------------- case 6
  it('operator-pinned keywords lead the query and keep their literal bytes', () => {
    const text = hhText(
      makeInput({ roles: ['hr'], includeKeywords: ['magnet-разработчик'] }),
    )
    expect(text.startsWith('magnet-разработчик')).toBe(true)
    expect(text).toContain('рекрутер')
  })

  // ---------------------------------------------------------------- case 7
  it('hostile quotes/operators in a pinned keyword cannot inject a query branch', () => {
    const text = hhText(
      makeInput({ roles: ['hr'], includeKeywords: ['директор" OR "юрист'] }),
    )
    // The pinned term must be inert: the only OR operators are the ones the
    // builder emits between whole operands, never one smuggled by a keyword.
    expect(text).not.toContain('"директор" OR "юрист"')
    expect(text).toContain('директор')
    // Balance check: quoting is well-formed (even number of unescaped quotes).
    const quotes = (text.match(/"/g) ?? []).length
    expect(quotes % 2).toBe(0)
  })

  // ---------------------------------------------------------------- case 8
  it('oversized input fails closed (null) instead of silently dropping roles', () => {
    const huge: string[] = []
    for (let i = 0; i < 40; i++) huge.push(`оченьдлинныйтерминномер${i}`)
    expect(buildHhDisjunctiveQuery(huge)).toBeNull()
    // A short list is unaffected by the budget.
    expect(buildHhDisjunctiveQuery(['юрист', 'рекрутер'])).toBe('юрист OR рекрутер')
  })

  // ---------------------------------------------------------------- case 9
  it('sources without search params still yield {} (career-pages)', () => {
    const env = buildProfileSearchEnv('career-pages' as SourceId, makeInput({ roles: ['hr'] }))
    expect(env).toEqual({})
  })

  // ---------------------------------------------------------------- case 10
  it('non-HH source (superjob) text stays byte-identical to the pre-fix output', () => {
      const input = makeInput({ roles: ['hr'] })
      const env = buildProfileSearchEnv('superjob' as SourceId, input)
      // Both `text` and `roleKeywords` map to SUPERJOB_KEYWORD, so the
      // comma-joined roleKeywords write has always won. Pre-fix and post-fix are
      // identical here: the fix is source-scoped to HH.
      expect(env.SUPERJOB_KEYWORD).toBe('рекрутер,hr-менеджер')
      expect(env.SUPERJOB_KEYWORD).not.toContain('OR')
    })

  // ---------------------------------------------------------------- case 11
  it('non-HH source (rabota-rossii) text stays byte-identical to the pre-fix join', () => {
    const input = makeInput({ roles: ['legal'] })
    const env = buildProfileSearchEnv('rabota-rossii' as SourceId, input)
    expect(env.RABOTA_ROSSII_SEARCH_TEXT).toBe('юрист')
    expect(env.RABOTA_ROSSII_SEARCH_TEXT).not.toContain('OR')
  })

  // ---------------------------------------------------------------- case 12
  it('generation is deterministic across repeated calls (cache-friendly)', () => {
    const input = makeInput({ roles: ALL_KEYWORD_ROLES, includeKeywords: ['пин'] })
    const first = hhText(input)
    for (let i = 0; i < 5; i++) {
      expect(hhText(input)).toBe(first)
    }
  })

  // ---------------------------------------------------------------- case 13
  it('reserved operator words are quoted, not emitted as bare syntax', () => {
    expect(buildHhDisjunctiveQuery(['or'])).toBe('"or"')
    expect(buildHhDisjunctiveQuery(['and', 'not'])).toBe('"and" OR "not"')
    // A term whose syntax characters were stripped is quoted so the remnant
    // cannot re-join with a neighbouring operand.
    expect(buildHhDisjunctiveQuery(['!юрист'])).toBe('"юрист"')
  })

  // ---------------------------------------------------------------- case 14
  it('empty / whitespace-only keyword list yields null (caller falls back)', () => {
    expect(buildHhDisjunctiveQuery([])).toBeNull()
    expect(buildHhDisjunctiveQuery(['', '   '])).toBeNull()
    expect(buildHhDisjunctiveQuery(['(('])).toBeNull()
  })
})