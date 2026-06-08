import { ingestSource, ingestAllPrimarySources } from '@/lib/lead-discovery/source-ingest'

// Mock child_process.execFile
jest.mock('node:child_process', () => ({
  execFile: jest.fn(),
}))

// Mock db-pool — default: no pool (search prefs skipped, falls back to ENV)
jest.mock('@/lib/db-pool', () => ({
  getPool: jest.fn().mockReturnValue(null),
}))

import { execFile } from 'node:child_process'
import { getPool } from '@/lib/db-pool'
const mockExecFile = execFile as jest.MockedFunction<typeof execFile>
const mockGetPool = getPool as jest.MockedFunction<typeof getPool>

describe('source-ingest', () => {
  beforeEach(() => {
    mockExecFile.mockReset()
    mockGetPool.mockReturnValue(null)
  })

  describe('ingestSource', () => {
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

    it('parses metrics from JSON output', async () => {
      mockExecFile.mockImplementation((_cmd, _args, opts: any, callback: any) => {
        callback(null, `some text\n${JSON.stringify({ source: 'hh', recordsReceived: 3, signalUpsertsCompleted: 15 })}`, '')
      })

      const result = await ingestSource('hh')

      expect(result.fetchedCount).toBe(3)
      expect(result.upsertedCount).toBe(15)
    })
  })

  describe('ingestAllPrimarySources', () => {
    it('runs all three primary sources in parallel', async () => {
      mockExecFile.mockImplementation((_cmd, args: any, opts: any, callback: any) => {
        const script = args[0] as string
        if (script.includes('ingest-hh')) {
          callback(null, JSON.stringify({ source: 'hh', recordsReceived: 20, signalUpsertsCompleted: 18 }), '')
        } else if (script.includes('superjob')) {
          callback(null, JSON.stringify({ source: 'superjob', recordsReceived: 10, signalUpsertsCompleted: 8 }), '')
        } else if (script.includes('habr-career')) {
          callback(null, JSON.stringify({ source: 'habr-career', recordsReceived: 5, signalUpsertsCompleted: 4 }), '')
        } else {
          callback(null, '', '')
        }
      })

      const results = await ingestAllPrimarySources()

      expect(results).toHaveLength(3)
      const sources = results.map(r => r.source)
      expect(sources).toContain('hh')
      expect(sources).toContain('superjob')
      expect(sources).toContain('habr-career')
      expect(results.every(r => r.success)).toBe(true)
      expect(results[0].fetchedCount).toBe(20)
      expect(results[0].upsertedCount).toBe(18)
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

      expect(results).toHaveLength(3)
      const failed = results.find(r => r.source === 'hh')
      expect(failed?.success).toBe(false)
      expect(results.filter(r => r.success).length).toBe(2)
    })
  })
})
