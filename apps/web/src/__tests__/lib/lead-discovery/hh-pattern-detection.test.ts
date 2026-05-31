import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { resolveHhVacancySearchConfig, fetchHhVacancyPages } from './hh-mock'

// Test data to avoid making real API calls
const mockHhResponse = {
  found: 150,
  pages: 3,
  items: [
    {
      id: '123',
      name: 'Вакансия: Senior React Developer',
      employer: { id: 'emp1', name: 'Tech Company', trusted: true },
      area: { id: '1', name: 'Москва' },
      salary: { from: 200000, to: 300000, currency: 'RUB' },
      published_at: '2024-05-28T10:00:00+03:00',
      requirement: 'React, TypeScript, Node.js',
      responsibility: 'Разработка frontend приложений'
    },
    {
      id: '124',
      name: 'Python Developer',
      employer: { id: 'emp2', name: 'Data Corp', trusted: false },
      area: { id: '1', name: 'Москва' },
      salary: { from: 180000, to: 250000, currency: 'RUB' },
      published_at: '2024-05-28T11:00:00+03:00',
      requirement: 'Python, Django, PostgreSQL',
      responsibility: 'Backend разработка'
    }
  ]
}

describe('Hiring Pattern Detection', () => {
  let mockFetch: jest.Mock | undefined
  let mockConsoleLog: typeof console.log | undefined

  beforeEach(() => {
    mockFetch = global.fetch as jest.Mock
    global.fetch = jest.fn()
    mockConsoleLog = console.log
    console.log = jest.fn()
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('HH_')) delete process.env[key]
    }
  })

  afterEach(() => {
    global.fetch = mockFetch as typeof fetch
    console.log = mockConsoleLog as typeof console.log
  })

  describe('resolveHhVacancySearchConfig', () => {
    it('resolves default config when no env vars are set', () => {
      delete process.env.HH_SEARCH_TEXT
      delete process.env.HH_PER_PAGE
      delete process.env.HH_PAGES

      const config = resolveHhVacancySearchConfig()

      expect(config).toEqual({
        searchText: 'рекрутер',
        perPage: 20,
        pages: 1,
        extraParams: {}
      })
    })

    it('respects environment variables', () => {
      process.env.HH_SEARCH_TEXT = 'python разработчик'
      process.env.HH_PER_PAGE = '50'
      process.env.HH_PAGES = '5'
      process.env.HH_INDUSTRY = 'it,finance'

      const config = resolveHhVacancySearchConfig()

      expect(config.searchText).toBe('python разработчик')
      expect(config.perPage).toBe(50)
      expect(config.pages).toBe(5)
      expect(config.extraParams).toEqual({
        industry: ['it', 'finance']
      })
    })

    it('handles JSON search parameters', () => {
      process.env.HH_SEARCH_PARAMS_JSON = '{"schedule": ["full", "shift"], "area": ["2", "3"]}'

      const config = resolveHhVacancySearchConfig()

      expect(config.extraParams).toEqual({
        schedule: ['full', 'shift'],
        area: ['2', '3']
      })
    })
  })

  describe('fetchHhVacancyPages', () => {
    it('fetches vacancy pages successfully', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['content-type', 'application/json']]),
        json: () => Promise.resolve(mockHhResponse)
      } as Response)

      const config = resolveHhVacancySearchConfig({
        HH_PAGES: '1'
      })

      const result = await fetchHhVacancyPages({
        userAgent: 'test-agent',
        config
      })

      expect(result.found).toBe(150)
      expect(result.items.length).toBe(2)
      expect(result.pagesFetched).toBe(1)
    })

    it('handles pagination correctly', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['content-type', 'application/json']]),
        json: () => Promise.resolve({
          ...mockHhResponse,
          pages: 2,
          items: [mockHhResponse.items[0]] // Only first item on first page
        })
      } as Response)

      global.fetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['content-type', 'application/json']]),
        json: () => Promise.resolve({
          ...mockHhResponse,
          pages: 2,
          items: [mockHhResponse.items[1]] // Second item on second page
        })
      } as Response)

      const config = resolveHhVacancySearchConfig({
        HH_PAGES: '2'
      })

      const result = await fetchHhVacancyPages({
        userAgent: 'test-agent',
        config
      })

      expect(result.pagesFetched).toBe(2)
      expect(result.items.length).toBe(2)
    })
  })
})