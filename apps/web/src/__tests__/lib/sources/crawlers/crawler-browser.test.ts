const allHeaders = jest.fn(async () => ({ 'content-type': 'text/html' }))
const response = { status: () => 200, allHeaders }
const goto = jest.fn(async () => response)
const content = jest.fn(async () => '<html><main>Rendered</main></html>')
const newPage = jest.fn(async () => ({ goto, content }))
const newContext = jest.fn(async () => ({ newPage }))
const close = jest.fn(async () => undefined)
const launch = jest.fn(async () => ({ newContext, close }))

jest.mock('playwright', () => ({ chromium: { launch } }))

import { createCrawleeSpaEngine } from '@/lib/sources/crawlers/crawler-crawlee'

describe('Playwright SPA crawler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders a page in an isolated context and closes the browser', async () => {
    const engine = createCrawleeSpaEngine({
      proxyUrls: ['http://proxy.internal:8080'],
      defaultHeaders: { 'x-radar': 'crawler' },
    })

    const result = await engine.fetch({
      url: 'https://careers.example/jobs',
      options: { timeoutMs: 12_000 },
    })

    expect(launch).toHaveBeenCalledWith({
      headless: true,
      proxy: { server: 'http://proxy.internal:8080' },
    })
    expect(newContext).toHaveBeenCalledWith({
      extraHTTPHeaders: {
        'accept-language': 'ru,en;q=0.9',
        'x-radar': 'crawler',
      },
    })
    expect(goto).toHaveBeenCalledWith('https://careers.example/jobs', {
      waitUntil: 'domcontentloaded',
      timeout: 12_000,
    })
    expect(result).toMatchObject({
      status: 200,
      engine: 'spa',
      html: '<html><main>Rendered</main></html>',
      rawHeaders: { 'content-type': 'text/html' },
    })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('closes the browser when navigation fails', async () => {
    goto.mockRejectedValueOnce(new Error('navigation failed'))
    const engine = createCrawleeSpaEngine()

    await expect(engine.fetch({ url: 'https://broken.example' })).rejects.toThrow(
      'navigation failed',
    )
    expect(close).toHaveBeenCalledTimes(1)
  })
})
