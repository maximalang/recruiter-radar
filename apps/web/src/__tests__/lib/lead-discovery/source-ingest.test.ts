import { ingestSource, ingestAllPrimarySources } from '@/lib/lead-discovery/source-ingest'

// Mock child_process.execFile
jest.mock('node:child_process', () => ({
  execFile: jest.fn(),
}))

import { execFile } from 'node:child_process'
const mockExecFile = execFile as jest.MockedFunction<typeof execFile>

describe('source-ingest', () => {
  beforeEach(() => {
    mockExecFile.mockReset()
  })

  describe('ingestSource', () => {
    it('returns success for HH ingestion with valid output', async () => {
      mockExecFile.mockImplementation((_cmd, _args, opts: any, callback: any) => {
        callback(null, 'hh search text: рекрутер\npages fetched: 1\nvacancies received: 25\nnormalized signal upserts completed: 20', '')
      })

      const result = await ingestSource('hh')

      expect(result).toEqual({
        source: 'hh',
        success: true,
        fetchedCount: 25,
        upsertedCount: 20,
        log: 'hh search text: рекрутер\npages fetched: 1\nvacancies received: 25\nnormalized signal upserts completed: 20',
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

    it('passes extra env vars to the script', async () => {
      mockExecFile.mockImplementation((_cmd, _args, opts: any, callback: any) => {
        // Verify env was merged
        expect(opts.env.HH_SEARCH_TEXT).toBe('разработчик')
        callback(null, 'vacancies received: 10', '')
      })

      await ingestSource('hh', { HH_SEARCH_TEXT: 'разработчик' })
    })

    it('parses fetchedCount from "pages fetched" when no vacancies received', async () => {
      mockExecFile.mockImplementation((_cmd, _args, opts: any, callback: any) => {
        callback(null, 'pages fetched: 3\nsignal upserts completed: 15', '')
      })

      const result = await ingestSource('hh')

      expect(result.fetchedCount).toBe(3)
      expect(result.upsertedCount).toBe(15)
    })
  })

  describe('ingestAllPrimarySources', () => {
    it('runs all three primary sources in sequence', async () => {
      mockExecFile.mockImplementation((_cmd, args: any, opts: any, callback: any) => {
        const script = args[0] as string
        if (script.includes('ingest-hh')) {
          callback(null, 'vacancies received: 20\nsignal upserts completed: 18', '')
        } else if (script.includes('superjob')) {
          callback(null, 'items ingested: 10', '')
        } else if (script.includes('habr-career')) {
          callback(null, 'items ingested: 5', '')
        } else {
          callback(null, '', '')
        }
      })

      const results = await ingestAllPrimarySources()

      expect(results).toHaveLength(3)
      expect(results[0].source).toBe('hh')
      expect(results[0].success).toBe(true)
      expect(results[1].source).toBe('superjob')
      expect(results[2].source).toBe('habr-career')
    })

    it('continues after a source fails', async () => {
      mockExecFile.mockImplementation((_cmd, args: any, opts: any, callback: any) => {
        const script = args[0] as string
        if (script.includes('ingest-hh')) {
          callback(new Error('API error'), '', 'API error')
        } else {
          callback(null, 'vacancies received: 5', '')
        }
      })

      const results = await ingestAllPrimarySources()

      expect(results).toHaveLength(3)
      expect(results[0].success).toBe(false)
      expect(results[1].success).toBe(true)
      expect(results[2].success).toBe(true)
    })
  })
})
