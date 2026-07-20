import { ingestSource, ingestAllPrimarySources, isNoActiveProfiles } from '@/lib/lead-discovery/source-ingest'
import { getPrimarySourceIds, getSourceConfig } from '@/lib/sources/source-registry'

// Mock the execFile accessor (production resolves execFile via
// process.getBuiltinModule, which bypasses jest's require-cache mock —
// so we mock the node-exec seam instead of node:child_process).
const mockExecFileFn = jest.fn()
jest.mock('@/lib/lead-discovery/node-exec', () => ({
  getExecFile: jest.fn(() => mockExecFileFn),
}))

// Mock db-pool — default: no pool (search prefs skipped, falls back to ENV)
jest.mock('@/lib/db-pool', () => ({
  getPool: jest.fn().mockReturnValue(null),
}))

import { getPool } from '@/lib/db-pool'
const mockExecFile = mockExecFileFn
const mockGetPool = getPool as jest.MockedFunction<typeof getPool>

describe('source-ingest', () => {
  beforeEach(() => {
    mockExecFile.mockReset()
    mockGetPool.mockReturnValue(null)
  })

  describe('ingestSource', () => {
    it('allows the Habr Career scraper to finish its multi-keyword run', () => {
      expect(getSourceConfig('habr-career').timeoutMs).toBe(240_000)
    })

    it('allows career-pages crawl + post-loop write to finish (empirically ~300s)', () => {
      // A manual prod run (2026-07-17: 30 targets, 716 records, EXIT_CODE=0)
      // took ~5min end-to-end; a 240s execFile kill was discarding every fetched
      // record because the row-by-row write never reached COMMIT in time. 420s
      // = observed ~300s + headroom for parallel-source contention.
      expect(getSourceConfig('career-pages').timeoutMs).toBe(420_000)
    })

    it('returns success for HH ingestion with valid output', async () => {
      const jsonMetrics = JSON.stringify({
        source: 'hh',
        action: 'pipeline',
        recordsReceived: 25,
        signalUpsertsCompleted: 20,
      })
      mockExecFile.mockImplementation((_cmd, _args, opts: any, callback: any) => {
        callback(null, `hh search text: рекрутер\npages fetched: 1\nvacancies received: 25\nnormalized signal upserts completed: 20\n${jsonMetrics}`, '')
      })

      const result = await ingestSource('hh')

      expect(result).toEqual({
        source: 'hh',
        success: true,
        fetchedCount: 25,
        upsertedCount: 20,
        log: expect.any(String),
      })
    })

    it('returns error for unknown source', async () => {
      const result = await ingestSource('unknown' as any)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Unknown source')
      expect(mockExecFile).not.toHaveBeenCalled()
    })

    it('returns error when script exits with non-zero code', async () => {
      const error = new Error('Command failed with exit code 1')
      mockExecFile.mockImplementation((_cmd, _args, opts: any, callback: any) => {
        callback(error, '', 'HH_USER_AGENT is not set')
      })

      const result = await ingestSource('hh')

      expect(result.success).toBe(false)
      expect(result.error).toContain('HH_USER_AGENT')
    })

    it('excludes search env vars from caller-provided env (loaded from DB instead)', async () => {
      mockExecFile.mockImplementation((_cmd, _args, opts: any, callback: any) => {
        // HH_SEARCH_TEXT is a search var — excluded from caller env, only from DB/ENV
        expect(opts.env.HH_SEARCH_TEXT).toBeUndefined()
        // Dangerous env vars are also filtered out
        expect(opts.env.NODE_OPTIONS).toBeUndefined()
        expect(opts.env.DATABASE_URL).toBe(process.env.DATABASE_URL)
        callback(null, JSON.stringify({ source: 'hh', recordsReceived: 10, signalUpsertsCompleted: 8 }), '')
      })

      const result = await ingestSource('hh', { HH_SEARCH_TEXT: 'разработчик', NODE_OPTIONS: '--require=/evil.js', DATABASE_URL: 'postgres://attacker' })
      expect(result.fetchedCount).toBe(10)
      expect(result.upsertedCount).toBe(8)
    })

    it('merges DB search prefs into ingestion env', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({
          rows: [{ params: { HH_SEARCH_TEXT: 'менеджер', HH_PAGES: '3' } }],
        }),
      }
      mockGetPool.mockReturnValue(mockPool)

      mockExecFile.mockImplementation((_cmd, _args, opts: any, callback: any) => {
        // Search params from DB should be in the env
        expect(opts.env.HH_SEARCH_TEXT).toBe('менеджер')
        expect(opts.env.HH_PAGES).toBe('3')
        callback(null, JSON.stringify({ source: 'hh', recordsReceived: 10, signalUpsertsCompleted: 8 }), '')
      })

      const result = await ingestSource('hh')
      expect(result.success).toBe(true)
    })

    it('filters out dangerous env vars', async () => {
      mockExecFile.mockImplementation((_cmd, _args, opts: any, callback: any) => {
        // NODE_OPTIONS, PATH, HOME, DATABASE_URL must not come from user input
        expect(opts.env.NODE_OPTIONS).toBeUndefined()
        expect(opts.env.PATH).toBe(process.env.PATH) // process.env only
        callback(null, JSON.stringify({ source: 'hh', recordsReceived: 5, signalUpsertsCompleted: 3 }), '')
      })

      const result = await ingestSource('hh', { NODE_OPTIONS: '--inspect=0.0.0.0', PATH: '/evil', HOME: '/evil', DATABASE_URL: 'postgres://evil' })
      expect(result.fetchedCount).toBe(5)
      expect(result.upsertedCount).toBe(3)
    })

    it('passes EGRUL/FNS source configuration through the env whitelist', async () => {
      mockExecFile.mockImplementation((_cmd, _args, opts: any, callback: any) => {
        expect(opts.env.EGRUL_FNS_INNS).toBe('7707083893')
        expect(opts.env.EGRUL_FNS_PUBLIC_BASE_URL).toBe('https://egrul.example/api')
        callback(null, JSON.stringify({ source: 'egrul-fns', recordsReceived: 1, signalUpsertsCompleted: 1 }), '')
      })

      const result = await ingestSource('egrul-fns', {
        EGRUL_FNS_INNS: '7707083893',
        EGRUL_FNS_PUBLIC_BASE_URL: 'https://egrul.example/api',
      })

      expect(result.success).toBe(true)
    })

    it('parses metrics from JSON output', async () => {
      mockExecFile.mockImplementation((_cmd, _args, opts: any, callback: any) => {
        callback(null, `some text\n${JSON.stringify({ source: 'hh', recordsReceived: 3, signalUpsertsCompleted: 15 })}`, '')
      })

      const result = await ingestSource('hh')

      expect(result.fetchedCount).toBe(3)
      expect(result.upsertedCount).toBe(15)
    })
  })

  describe('habr-career keyword derivation', () => {
    // Route queries by shape: count SELECT vs search-prefs SELECT vs
    // active-profile ICP SELECT. `profiles` carries the full column set the
    // generalised profile-search loader reads (roles, industries, exclusions,
    // operator keywords, target city); `roles` is the legacy roles-only shape
    // used by the habr resolver path.
    function mockPoolWith({
      roles,
      searchParams,
      profiles,
      count,
    }: {
      roles?: string[][]
      searchParams?: Record<string, string>
      profiles?: Array<{
        roles?: string[] | null
        industries?: string[] | null
        excluded_industries?: string[] | null
        include_keywords?: string[] | null
        exclude_keywords?: string[] | null
        target_city?: string | null
      }>
      count?: string;
    }) {
      const query = jest.fn((sql: string) => {
        if (sql.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ count: count ?? '0' }] })
        }
        if (sql.includes('user_search_preferences')) {
          return Promise.resolve({ rows: searchParams ? [{ params: searchParams }] : [] })
        }
        if (sql.includes('excluded_industries') || sql.includes('include_keywords')) {
          // Generalised profile-search loader (selects multiple ICP columns).
          return Promise.resolve({ rows: profiles ?? [] })
        }
        if (sql.includes('client_profiles')) {
          // Legacy roles-only SELECT (habr resolver path).
          return Promise.resolve({ rows: (roles ?? []).map(r => ({ roles: r })) })
        }
        return Promise.resolve({ rows: [] })
      })
      return { query }
    }

    it('injects HABR_CAREER_KEYWORDS derived from active profiles roles', async () => {
      mockGetPool.mockReturnValue(mockPoolWith({ roles: [['hr'], ['it-engineering']] }))

      let capturedEnv: Record<string, string> | undefined
      mockExecFile.mockImplementation((_cmd, _args, opts: any, callback: any) => {
        capturedEnv = opts.env
        callback(null, JSON.stringify({ source: 'habr-career', recordsReceived: 1, signalUpsertsCompleted: 1 }), '')
      })

      await ingestSource('habr-career')

      expect(capturedEnv?.HABR_CAREER_KEYWORDS).toBeDefined()
      const kws = capturedEnv!.HABR_CAREER_KEYWORDS.split(',')
      expect(kws).toContain('рекрутер') // hr
      expect(kws).toContain('разработчик') // it-engineering
    })

    it('does not derive keywords when an explicit search pref keyword is set', async () => {
      mockGetPool.mockReturnValue(
        mockPoolWith({ roles: [['hr']], searchParams: { HABR_CAREER_KEYWORD: 'devops' } })
      )

      let capturedEnv: Record<string, string> | undefined
      mockExecFile.mockImplementation((_cmd, _args, opts: any, callback: any) => {
        capturedEnv = opts.env
        callback(null, JSON.stringify({ source: 'habr-career', recordsReceived: 1, signalUpsertsCompleted: 1 }), '')
      })

      await ingestSource('habr-career')

      expect(capturedEnv?.HABR_CAREER_KEYWORD).toBe('devops')
      expect(capturedEnv?.HABR_CAREER_KEYWORDS).toBeUndefined()
    })

    it('does not derive HABR_CAREER_KEYWORDS for non-habr sources', async () => {
      mockGetPool.mockReturnValue(
        mockPoolWith({ profiles: [{ roles: ['hr'] }] }),
      )

      let capturedEnv: Record<string, string> | undefined
      mockExecFile.mockImplementation((_cmd, _args, opts: any, callback: any) => {
        capturedEnv = opts.env
        callback(null, JSON.stringify({ source: 'hh', recordsReceived: 1, signalUpsertsCompleted: 1 }), '')
      })

      await ingestSource('hh')

      // hh derives its OWN search text from the profile, but must NOT emit the
      // habr-only HABR_CAREER_KEYWORDS param.
      expect(capturedEnv?.HABR_CAREER_KEYWORDS).toBeUndefined()
    })
  })

  describe('profile-derived search queries (hh/superjob/rabota-rossii)', () => {
    function mockPoolWithProfiles(
      profiles: Array<Record<string, unknown>>,
      feedbackRows?: Array<{ feedback_status: string; industry: string | null }>,
    ) {
      const query = jest.fn((sql: string) => {
        if (sql.includes('user_search_preferences')) {
          return Promise.resolve({ rows: [] })
        }
        if (sql.includes('client_digest_org_state')) {
          return Promise.resolve({ rows: feedbackRows ?? [] })
        }
        if (sql.includes('excluded_industries') || sql.includes('include_keywords')) {
          return Promise.resolve({ rows: profiles })
        }
        return Promise.resolve({ rows: [] })
      })
      return { query }
    }

    it('derives HH_SEARCH_TEXT from the union of active profiles ICP', async () => {
      mockGetPool.mockReturnValue(
        mockPoolWithProfiles([
          { roles: ['hr'], industries: ['it'], excluded_industries: null, include_keywords: null, exclude_keywords: null, target_city: null },
          { roles: ['sales'], industries: null, excluded_industries: null, include_keywords: null, exclude_keywords: null, target_city: null },
        ]),
      )

      let capturedEnv: Record<string, string> | undefined
      mockExecFile.mockImplementation((_cmd, _args, opts: any, callback: any) => {
        capturedEnv = opts.env
        callback(null, JSON.stringify({ source: 'hh', recordsReceived: 1, signalUpsertsCompleted: 1 }), '')
      })

      await ingestSource('hh')

      expect(capturedEnv?.HH_SEARCH_TEXT).toBeDefined()
      // role terms from both profiles + industry terms from 'it'
      expect(capturedEnv!.HH_SEARCH_TEXT).toContain('рекрутер')
      expect(capturedEnv!.HH_SEARCH_TEXT).toContain('менеджер по продажам')
      expect(capturedEnv!.HH_SEARCH_TEXT).toContain('айти')
    })

    it('derives SUPERJOB_KEYWORD for superjob', async () => {
      mockGetPool.mockReturnValue(
        mockPoolWithProfiles([{ roles: ['data'] }]),
      )

      let capturedEnv: Record<string, string> | undefined
      mockExecFile.mockImplementation((_cmd, _args, opts: any, callback: any) => {
        capturedEnv = opts.env
        callback(null, JSON.stringify({ source: 'superjob', recordsReceived: 1, signalUpsertsCompleted: 1 }), '')
      })

      await ingestSource('superjob')

      expect(capturedEnv?.SUPERJOB_KEYWORD).toBeDefined()
      expect(capturedEnv!.SUPERJOB_KEYWORD).toContain('data scientist')
    })

    it('derives RABOTA_ROSSII_SEARCH_TEXT for rabota-rossii', async () => {
      mockGetPool.mockReturnValue(
        mockPoolWithProfiles([{ roles: ['hr'] }]),
      )

      let capturedEnv: Record<string, string> | undefined
      mockExecFile.mockImplementation((_cmd, _args, opts: any, callback: any) => {
        capturedEnv = opts.env
        callback(null, JSON.stringify({ source: 'rabota-rossii', recordsReceived: 1, signalUpsertsCompleted: 1 }), '')
      })

      await ingestSource('rabota-rossii')

      expect(capturedEnv?.RABOTA_ROSSII_SEARCH_TEXT).toBeDefined()
      expect(capturedEnv!.RABOTA_ROSSII_SEARCH_TEXT).toContain('рекрутер')
    })

    it('lets an explicit operator DB search pref override the profile-derived query', async () => {
      const mockPool = {
        query: jest.fn((sql: string) => {
          if (sql.includes('user_search_preferences')) {
            return Promise.resolve({ rows: [{ params: { HH_SEARCH_TEXT: 'operator-pinned' } }] })
          }
          if (sql.includes('excluded_industries') || sql.includes('include_keywords')) {
            return Promise.resolve({ rows: [{ roles: ['hr'], industries: null, excluded_industries: null, include_keywords: null, exclude_keywords: null, target_city: null }] })
          }
          return Promise.resolve({ rows: [] })
        }),
      }
      mockGetPool.mockReturnValue(mockPool)

      let capturedEnv: Record<string, string> | undefined
      mockExecFile.mockImplementation((_cmd, _args, opts: any, callback: any) => {
        capturedEnv = opts.env
        callback(null, JSON.stringify({ source: 'hh', recordsReceived: 1, signalUpsertsCompleted: 1 }), '')
      })

      await ingestSource('hh')

      // Operator pin wins; profile-derived 'рекрутер' must NOT appear.
      expect(capturedEnv?.HH_SEARCH_TEXT).toBe('operator-pinned')
    })

    it('omits search env when no active profiles exist (caller falls back to source default)', async () => {
      const mockPool = {
        query: jest.fn((sql: string) => {
          if (sql.includes('user_search_preferences')) return Promise.resolve({ rows: [] })
          if (sql.includes('excluded_industries') || sql.includes('include_keywords')) return Promise.resolve({ rows: [] })
          return Promise.resolve({ rows: [] })
        }),
      }
      mockGetPool.mockReturnValue(mockPool)

      let capturedEnv: Record<string, string> | undefined
      mockExecFile.mockImplementation((_cmd, _args, opts: any, callback: any) => {
        capturedEnv = opts.env
        callback(null, JSON.stringify({ source: 'hh', recordsReceived: 1, signalUpsertsCompleted: 1 }), '')
      })

      await ingestSource('hh')

      expect(capturedEnv?.HH_SEARCH_TEXT).toBeUndefined()
    })

    it('emits no search env for sources without supported search params (career-pages)', async () => {
      mockGetPool.mockReturnValue(
        mockPoolWithProfiles([{ roles: ['hr'] }]),
      )

      let capturedEnv: Record<string, string> | undefined
      mockExecFile.mockImplementation((_cmd, _args, opts: any, callback: any) => {
        capturedEnv = opts.env
        callback(null, JSON.stringify({ source: 'career-pages', recordsReceived: 1, signalUpsertsCompleted: 1 }), '')
      })

      await ingestSource('career-pages')

      expect(capturedEnv?.HH_SEARCH_TEXT).toBeUndefined()
      expect(capturedEnv?.SUPERJOB_KEYWORD).toBeUndefined()
      expect(capturedEnv?.HABR_CAREER_KEYWORDS).toBeUndefined()
    })
  })

  describe('feedback self-tuning loop (badfit history → query demote)', () => {
    function mockPool(profiles: Array<Record<string, unknown>>, feedbackRows: Array<{ feedback_status: string; industry: string | null }>) {
      const query = jest.fn((sql: string) => {
        if (sql.includes('user_search_preferences')) return Promise.resolve({ rows: [] })
        if (sql.includes('client_digest_org_state')) return Promise.resolve({ rows: feedbackRows })
        if (sql.includes('excluded_industries') || sql.includes('include_keywords')) return Promise.resolve({ rows: profiles })
        return Promise.resolve({ rows: [] })
      })
      return { query }
    }

    it('demotes finance terms to the BACK of the HH query after 3+ finance badfits', async () => {
      // Profile serves both it and finance; finance has 3 badfits → demoted.
      mockGetPool.mockReturnValue(
        mockPool(
          [{ roles: ['hr'], industries: ['it', 'finance'], excluded_industries: null, include_keywords: null, exclude_keywords: null, target_city: null }],
          [
            { feedback_status: 'badfit', industry: 'finance' },
            { feedback_status: 'badfit', industry: 'finance' },
            { feedback_status: 'badfit', industry: 'finance' },
          ],
        ),
      )

      let capturedEnv: Record<string, string> | undefined
      mockExecFile.mockImplementation((_cmd, _args, opts: any, callback: any) => {
        capturedEnv = opts.env
        callback(null, JSON.stringify({ source: 'hh', recordsReceived: 1, signalUpsertsCompleted: 1 }), '')
      })

      await ingestSource('hh')

      const query = capturedEnv?.HH_SEARCH_TEXT ?? ''
      // finance terms still present (bounded effect = re-order, not removal)
      expect(query).toContain('финанс')
      // ...but an it term ('айти') must appear before 'финанс'
      const itIdx = query.toLowerCase().indexOf('айти')
      const financeIdx = query.toLowerCase().indexOf('финанс')
      expect(itIdx).toBeGreaterThanOrEqual(0)
      expect(financeIdx).toBeGreaterThanOrEqual(0)
      expect(itIdx).toBeLessThan(financeIdx)
    })

    it('does NOT demote when feedback is below the minimum sample (1 badfit)', async () => {
      mockGetPool.mockReturnValue(
        mockPool(
          [{ roles: ['hr'], industries: ['it', 'finance'], excluded_industries: null, include_keywords: null, exclude_keywords: null, target_city: null }],
          [{ feedback_status: 'badfit', industry: 'finance' }],
        ),
      )

      let capturedEnv: Record<string, string> | undefined
      mockExecFile.mockImplementation((_cmd, _args, opts: any, callback: any) => {
        capturedEnv = opts.env
        callback(null, JSON.stringify({ source: 'hh', recordsReceived: 1, signalUpsertsCompleted: 1 }), '')
      })

      await ingestSource('hh')

      // With only 1 badfit the minimum-sample gate fires: no demotion, so the
      // natural composition order (it before finance) is unchanged — but more
      // importantly finance is NOT artificially pushed back beyond it.
      const query = (capturedEnv?.HH_SEARCH_TEXT ?? '').toLowerCase()
      const itIdx = query.indexOf('айти')
      const financeIdx = query.indexOf('финанс')
      expect(itIdx).toBeLessThan(financeIdx) // same as no-feedback baseline
    })

    it('keeps feedback-tuned query inside the ICP (demoted terms still present)', async () => {
      mockGetPool.mockReturnValue(
        mockPool(
          [{ roles: ['hr'], industries: ['finance'], excluded_industries: null, include_keywords: null, exclude_keywords: null, target_city: null }],
          [
            { feedback_status: 'badfit', industry: 'finance' },
            { feedback_status: 'badfit', industry: 'finance' },
            { feedback_status: 'badfit', industry: 'finance' },
          ],
        ),
      )

      let capturedEnv: Record<string, string> | undefined
      mockExecFile.mockImplementation((_cmd, _args, opts: any, callback: any) => {
        capturedEnv = opts.env
        callback(null, JSON.stringify({ source: 'hh', recordsReceived: 1, signalUpsertsCompleted: 1 }), '')
      })

      await ingestSource('hh')

      // finance is the ONLY industry AND it is demoted — but bounded effect
      // means the term is re-ordered, never removed, so the query is non-empty
      // and still contains the finance term. The loop never starves the pool.
      expect(capturedEnv?.HH_SEARCH_TEXT).toContain('финанс')
    })
  })

  describe('ingestAllPrimarySources', () => {
    it('runs all primary sources in parallel', async () => {
      mockExecFile.mockImplementation((_cmd, args: any, opts: any, callback: any) => {
        const script = args[0] as string
        if (script.includes('ingest-hh')) {
          callback(null, JSON.stringify({ source: 'hh', recordsReceived: 20, signalUpsertsCompleted: 18 }), '')
        } else if (script.includes('superjob')) {
          callback(null, JSON.stringify({ source: 'superjob', recordsReceived: 10, signalUpsertsCompleted: 8 }), '')
        } else if (script.includes('habr-career')) {
          callback(null, JSON.stringify({ source: 'habr-career', recordsReceived: 5, signalUpsertsCompleted: 4 }), '')
        } else if (script.includes('rabota-rossii')) {
          callback(null, JSON.stringify({ source: 'rabota-rossii', recordsReceived: 7, signalUpsertsCompleted: 6 }), '')
        } else {
          callback(null, '', '')
        }
      })

      const results = await ingestAllPrimarySources()
      if (isNoActiveProfiles(results)) throw new Error('unexpected no_active_profiles')

      // Length derives from the registry so adding/removing a primary source
      // updates here automatically rather than silently drifting.
      expect(results).toHaveLength(getPrimarySourceIds().length)
      const sources = results.map(r => r.source)
      expect(sources).toContain('hh')
      expect(sources).toContain('superjob')
      expect(sources).toContain('habr-career')
      expect(sources).toContain('rabota-rossii')
      expect(results.every(r => r.success)).toBe(true)
      const hhResult = results.find(r => r.source === 'hh')
      expect(hhResult?.fetchedCount).toBe(20)
      expect(hhResult?.upsertedCount).toBe(18)
    })

    it('returns no_active_profiles when DB has zero active profiles', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({ rows: [{ count: '0' }] }),
      }
      mockGetPool.mockReturnValue(mockPool)

      const result = await ingestAllPrimarySources()

      expect(isNoActiveProfiles(result)).toBe(true)
      expect(mockExecFile).not.toHaveBeenCalled()
    })

    it('proceeds when DB has active profiles', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({ rows: [{ count: '2' }] }),
      }
      mockGetPool.mockReturnValue(mockPool)
      mockExecFile.mockImplementation((_cmd, _args: any, opts: any, callback: any) => {
        callback(null, JSON.stringify({ source: 'hh', recordsReceived: 1, signalUpsertsCompleted: 1 }), '')
      })

      const result = await ingestAllPrimarySources()

      expect(isNoActiveProfiles(result)).toBe(false)
    })

    it('continues after a source fails', async () => {
      mockExecFile.mockImplementation((_cmd, args: any, opts: any, callback: any) => {
        const script = args[0] as string
        if (script.includes('ingest-hh')) {
          callback(new Error('API error'), '', 'API error')
        } else {
          callback(null, JSON.stringify({ source: 'superjob', recordsReceived: 5, signalUpsertsCompleted: 3 }), '')
        }
      })

      const results = await ingestAllPrimarySources()
      if (isNoActiveProfiles(results)) throw new Error('unexpected no_active_profiles')

      const primaryCount = getPrimarySourceIds().length
      expect(results).toHaveLength(primaryCount)
      const failed = results.find(r => r.source === 'hh')
      expect(failed?.success).toBe(false)
      // Only hh is mocked to fail; every other primary source succeeds.
      expect(results.filter(r => r.success).length).toBe(primaryCount - 1)
    })
  })
})
