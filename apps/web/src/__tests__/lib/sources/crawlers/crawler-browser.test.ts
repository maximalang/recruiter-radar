const allHeaders = jest.fn(async () => ({ 'content-type': 'text/html' }))
const response = { status: () => 200, allHeaders }
const goto = jest.fn(async () => response)
const content = jest.fn(async () => '<html><main>Rendered</main></html>')
const closePage = jest.fn(async () => undefined)
const closeContext = jest.fn(async () => undefined)
const newPage = jest.fn(async () => ({ goto, content, close: closePage }))
const newContext = jest.fn(async () => ({ newPage, close: closeContext }))
const closeBrowser = jest.fn(async () => undefined)
const launch = jest.fn(async () => ({ newContext, close: closeBrowser }))

jest.mock('playwright', () => ({ chromium: { launch } }))

import { createCrawleeSpaEngine } from '@/lib/sources/crawlers/crawler-crawlee'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function waitForCallCount(mock: jest.Mock, count: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (mock.mock.calls.length >= count) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`Expected ${count} calls, received ${mock.mock.calls.length}`)
}

describe('Playwright SPA crawler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  })

  it('renders each page in an isolated context while keeping its browser worker alive', async () => {
    const engine = createCrawleeSpaEngine({
      proxyUrls: ['http://proxy.internal:8080'],
      defaultHeaders: { 'x-radar': 'crawler' },
      concurrency: 1,
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
    expect(closeContext).toHaveBeenCalledTimes(1)
    expect(closeBrowser).not.toHaveBeenCalled()

    await engine.fetch({ url: 'https://careers.example/jobs/2' })

    expect(launch).toHaveBeenCalledTimes(1)
    expect(newContext).toHaveBeenCalledTimes(2)
    expect(closeContext).toHaveBeenCalledTimes(2)

    await engine.close()
    expect(closeBrowser).toHaveBeenCalledTimes(1)
  })

  it('closes the isolated context but keeps the worker recyclable when navigation fails', async () => {
    goto.mockRejectedValueOnce(new Error('navigation failed'))
    const engine = createCrawleeSpaEngine()

    await expect(engine.fetch({ url: 'https://broken.example' })).rejects.toThrow(
      'navigation failed',
    )
    expect(closeContext).toHaveBeenCalledTimes(1)
    expect(closeBrowser).not.toHaveBeenCalled()

    await engine.close()
  })

  it('uses the production system Chromium when configured', async () => {
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = '/usr/bin/chromium-browser'
    const engine = createCrawleeSpaEngine()

    await engine.fetch({ url: 'https://careers.example' })

    expect(launch).toHaveBeenCalledWith({
      headless: true,
      executablePath: '/usr/bin/chromium-browser',
    })

    await engine.close()
  })

  it('recycles a browser worker after its bounded request budget', async () => {
    const engine = createCrawleeSpaEngine({
      concurrency: 1,
      maxRequestsPerBrowser: 2,
    })

    await engine.fetch({ url: 'https://careers.example/1' })
    await engine.fetch({ url: 'https://careers.example/2' })
    await engine.fetch({ url: 'https://careers.example/3' })

    expect(launch).toHaveBeenCalledTimes(2)
    expect(closeBrowser).toHaveBeenCalledTimes(1)

    await engine.close()
    expect(closeBrowser).toHaveBeenCalledTimes(2)
  })

  it('never exceeds the configured browser worker concurrency', async () => {
    const firstNavigation = deferred<typeof response>()
    const secondNavigation = deferred<typeof response>()
    goto
      .mockImplementationOnce(() => firstNavigation.promise)
      .mockImplementationOnce(() => secondNavigation.promise)
    const engine = createCrawleeSpaEngine({ concurrency: 2 })

    const first = engine.fetch({ url: 'https://careers.example/1' })
    const second = engine.fetch({ url: 'https://careers.example/2' })
    const third = engine.fetch({ url: 'https://careers.example/3' })

    await waitForCallCount(goto, 2)
    expect(launch).toHaveBeenCalledTimes(2)
    expect(goto).toHaveBeenCalledTimes(2)

    firstNavigation.resolve(response)
    await waitForCallCount(goto, 3)
    secondNavigation.resolve(response)
    await Promise.all([first, second, third])

    expect(launch).toHaveBeenCalledTimes(2)
    await engine.close()
  })

  it('opens a per-host circuit after bounded consecutive navigation failures', async () => {
    goto
      .mockRejectedValueOnce(new Error('upstream failed'))
      .mockRejectedValueOnce(new Error('upstream failed again'))
    const engine = createCrawleeSpaEngine({
      concurrency: 1,
      perHostMinIntervalMs: 0,
      circuitFailureThreshold: 2,
      circuitResetMs: 60_000,
    })

    await expect(engine.fetch({ url: 'https://unstable.example/1' })).rejects.toThrow('upstream failed')
    await expect(engine.fetch({ url: 'https://unstable.example/2' })).rejects.toThrow('upstream failed again')
    await expect(engine.fetch({ url: 'https://unstable.example/3' })).rejects.toMatchObject({
      code: 'PLAYWRIGHT_CIRCUIT_OPEN',
      host: 'unstable.example',
    })
    expect(goto).toHaveBeenCalledTimes(2)

    await engine.close()
  })

  it('keeps browser workers independent across hosts when one circuit opens', async () => {
    goto.mockRejectedValueOnce(new Error('host A failed'))
    const engine = createCrawleeSpaEngine({
      concurrency: 1,
      perHostMinIntervalMs: 0,
      circuitFailureThreshold: 1,
    })

    await expect(engine.fetch({ url: 'https://host-a.example/jobs' })).rejects.toThrow('host A failed')
    await expect(engine.fetch({ url: 'https://host-a.example/jobs/2' })).rejects.toMatchObject({
      code: 'PLAYWRIGHT_CIRCUIT_OPEN',
    })
    await expect(engine.fetch({ url: 'https://host-b.example/jobs' })).resolves.toMatchObject({
      status: 200,
    })

    await engine.close()
  })

  it('sends bounded validators and returns a bodyless 304 result', async () => {
    goto.mockResolvedValueOnce({
      status: () => 304,
      allHeaders: async () => ({ etag: '"jobs-v2"' }),
    })
    const engine = createCrawleeSpaEngine({ perHostMinIntervalMs: 0 })

    const result = await engine.fetch({
      url: 'https://conditional.example/jobs',
      options: {
        previousValidators: {
          etag: '"jobs-v1"',
          lastModified: 'Wed, 12 Aug 2026 10:00:00 GMT',
        },
      },
    })

    expect(newContext).toHaveBeenCalledWith({
      extraHTTPHeaders: {
        'accept-language': 'ru,en;q=0.9',
        'if-none-match': '"jobs-v1"',
        'if-modified-since': 'Wed, 12 Aug 2026 10:00:00 GMT',
      },
    })
    expect(result).toMatchObject({
      status: 304,
      notModified: true,
      validators: {
        etag: '"jobs-v2"',
        lastModified: 'Wed, 12 Aug 2026 10:00:00 GMT',
      },
    })
    expect(result.html).toBeUndefined()
    expect(content).not.toHaveBeenCalled()

    await engine.close()
  })
})
