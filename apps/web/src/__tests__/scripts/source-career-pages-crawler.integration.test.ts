import { createDefaultRouter, createStaticEngine } from '@/lib/sources/crawlers'
import { chooseEngine } from '@/lib/sources/crawlers/crawler-router'

describe('CrawlerEngine integration', () => {
  it('chooses static engine for unknown hosts', () => {
    expect(chooseEngine('https://unknown-host.example/careers')).toBe('static')
  })

  it('chooses SPA engine for known hosts', () => {
    expect(chooseEngine('https://boards.greenhouse.io/acme')).toBe('spa')
    expect(chooseEngine('https://jobs.lever.co/acme')).toBe('spa')
    expect(chooseEngine('https://jobs.ashbyhq.com/acme')).toBe('spa')
    expect(chooseEngine('https://acme.wd1.myworkdayjobs.com/External')).toBe('spa')
    expect(chooseEngine('https://jobs.smartrecruiters.com/Acme')).toBe('spa')
    expect(chooseEngine('https://jobs.jobvite.com/acme')).toBe('spa')
    expect(chooseEngine('https://apply.workable.com/acme')).toBe('spa')
  })

  it('prioritizes hint over host detection', () => {
    // Hint should override host detection
    expect(chooseEngine('https://example.com/careers', 'spa')).toBe('spa')
    expect(chooseEngine('https://example.com/careers', 'newsroom')).toBe('llm-markdown')
    expect(chooseEngine('https://boards.greenhouse.io/acme', 'static')).toBe('static')
  })

  it('handles invalid URLs gracefully', () => {
    expect(chooseEngine('not a url')).toBe('static')
    expect(chooseEngine('')).toBe('static')
  })

  it('creates default router with static engine', () => {
    const router = createDefaultRouter()
    expect(router).toBeDefined()

    // Router should handle fetch requests
    router.fetch({
      url: 'https://example.com',
      options: {
        headers: { 'User-Agent': 'Test' }
      }
    }).catch(() => {
      // Expected to fail in test environment, but should not throw synchronously
    })
  })
})