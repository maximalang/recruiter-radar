const allHeaders = jest.fn(async (): Promise<Record<string, string>> => ({ 'content-type': 'text/html' }))
let responseStatus = 200
const response: { status: () => number; allHeaders: () => Promise<Record<string, string>> } = {
  status: () => responseStatus,
  allHeaders,
}
const goto = jest.fn(async (): Promise<typeof response> => response)
const content = jest.fn(async () => '<html><main>Rendered</main></html>')
const waitForTimeout = jest.fn(async () => undefined)
const closePage = jest.fn(async () => undefined)
const closeContext = jest.fn(async () => undefined)
const newPage = jest.fn(async () => ({ goto, content, waitForTimeout, close: closePage }))
const route = jest.fn(async () => undefined)
const newContext = jest.fn(async () => ({ newPage, route, close: closeContext }))
const closeBrowser = jest.fn(async () => undefined)
const launch = jest.fn(async () => ({ newContext, close: closeBrowser }))

jest.mock('playwright', () => ({ chromium: { launch } }))

import {
  createCrawleeSpaEngine as createRealCrawleeSpaEngine,
  type CrawleeEngineOptions,
} from '@/lib/sources/crawlers/crawler-crawlee'

const publicDnsLookup = async () => [{ address: '93.184.216.34', family: 4 }]

function createCrawleeSpaEngine(options: CrawleeEngineOptions = {}) {
  return createRealCrawleeSpaEngine({ dnsLookup: publicDnsLookup, ...options })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('Playwright SPA crawler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    responseStatus = 200
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

  it.each([
    'http://localhost/admin',
    'http://127.0.0.1/admin',
    'http://[::1]/admin',
    'https://user:password@careers.example/jobs',
  ])('rejects an unsafe initial URL before browser navigation: %s', async (url) => {
    const engine = createCrawleeSpaEngine({
      dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
    })

    await expect(engine.fetch({ url })).rejects.toMatchObject({ code: 'CRAWLER_SSRF_BLOCKED' })
    expect(goto).not.toHaveBeenCalled()

    await engine.close()
  })

  it('rejects a hostname when any resolved address is private', async () => {
    const engine = createCrawleeSpaEngine({
      dnsLookup: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.8', family: 4 },
      ],
    })

    await expect(engine.fetch({ url: 'https://rebound.example/jobs' })).rejects.toMatchObject({
      code: 'CRAWLER_SSRF_BLOCKED',
    })
    expect(goto).not.toHaveBeenCalled()

    await engine.close()
  })

  it('installs a guard that blocks a public-to-private redirect before continuing it', async () => {
    const dnsLookup = jest.fn(async (hostname: string) => hostname === 'public.example'
      ? [{ address: '93.184.216.34', family: 4 as const }]
      : [{ address: '192.168.1.20', family: 4 as const }])
    const engine = createCrawleeSpaEngine({ dnsLookup })

    await engine.fetch({ url: 'https://public.example/jobs' })
    const guard = route.mock.calls[0]?.[1] as ((routeInput: {
      abort: (reason: string) => Promise<void>
      continue: () => Promise<void>
    }, request: { url: () => string }) => Promise<void>) | undefined
    expect(guard).toBeDefined()
    const abort = jest.fn(async () => undefined)
    const continueRequest = jest.fn(async () => undefined)

    await expect(guard?.(
      { abort, continue: continueRequest },
      { url: () => 'https://private.example/latest/meta-data' },
    )).rejects.toMatchObject({ code: 'CRAWLER_SSRF_BLOCKED' })
    expect(abort).toHaveBeenCalledWith('blockedbyclient')
    expect(continueRequest).not.toHaveBeenCalled()

    await engine.close()
  })

  it('blocks DNS rebinding when a hostname changes from public to private during navigation', async () => {
    let lookups = 0
    const dnsLookup = jest.fn(async () => {
      lookups += 1
      return lookups <= 2
        ? [{ address: '93.184.216.34', family: 4 as const }]
        : [{ address: '169.254.169.254', family: 4 as const }]
    })
    const engine = createCrawleeSpaEngine({ dnsLookup })

    await engine.fetch({ url: 'https://rebind.example/jobs' })
    const guard = route.mock.calls[0]?.[1] as ((routeInput: {
      abort: (reason: string) => Promise<void>
      continue: () => Promise<void>
    }, request: { url: () => string }) => Promise<void>)
    const abort = jest.fn(async () => undefined)

    await expect(guard(
      { abort, continue: async () => undefined },
      { url: () => 'https://rebind.example/redirected' },
    )).rejects.toMatchObject({ code: 'CRAWLER_SSRF_BLOCKED' })
    expect(abort).toHaveBeenCalledWith('blockedbyclient')

    await engine.close()
  })

  it('blocks an unsafe subresource without failing the public main document', async () => {
    const engine = createCrawleeSpaEngine()

    await engine.fetch({ url: 'https://public.example/jobs' })
    const guard = route.mock.calls[0]?.[1] as ((routeInput: {
      abort: (reason: string) => Promise<void>
      continue: () => Promise<void>
    }, request: { url: () => string; isNavigationRequest: () => boolean }) => Promise<void>)
    const abort = jest.fn(async () => undefined)

    await expect(guard(
      { abort, continue: async () => undefined },
      { url: () => 'http://169.254.169.254/analytics.js', isNavigationRequest: () => false },
    )).resolves.toBeUndefined()
    expect(abort).toHaveBeenCalledWith('blockedbyclient')

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
    expect(waitForTimeout).toHaveBeenCalledWith(1_500)

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
    const twoNavigationsStarted = deferred<void>()
    const thirdNavigationStarted = deferred<void>()
    let navigationStarts = 0
    goto
      .mockImplementationOnce(() => {
        navigationStarts += 1
        if (navigationStarts === 2) twoNavigationsStarted.resolve(undefined)
        return firstNavigation.promise
      })
      .mockImplementationOnce(() => {
        navigationStarts += 1
        if (navigationStarts === 2) twoNavigationsStarted.resolve(undefined)
        return secondNavigation.promise
      })
      .mockImplementationOnce(async () => {
        thirdNavigationStarted.resolve(undefined)
        return response
      })
    const engine = createCrawleeSpaEngine({ concurrency: 2 })

    const first = engine.fetch({ url: 'https://careers.example/1' })
    const second = engine.fetch({ url: 'https://careers.example/2' })
    const third = engine.fetch({ url: 'https://careers.example/3' })

    try {
      await twoNavigationsStarted.promise
      expect(launch).toHaveBeenCalledTimes(2)
      expect(goto).toHaveBeenCalledTimes(2)

      firstNavigation.resolve(response)
      await thirdNavigationStarted.promise
      secondNavigation.resolve(response)
      await Promise.all([first, second, third])

      expect(launch).toHaveBeenCalledTimes(2)
    } finally {
      firstNavigation.resolve(response)
      secondNavigation.resolve(response)
      await Promise.allSettled([first, second, third])
      await engine.close()
    }
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

  it.each([401, 403, 407, 451])(
    'opens a longer access-denial circuit after repeated HTTP %i responses',
    async (status) => {
      responseStatus = status
      const engine = createCrawleeSpaEngine({
        concurrency: 1,
        perHostMinIntervalMs: 0,
        circuitFailureThreshold: 2,
        circuitResetMs: 100,
        accessFailureCooldownMs: 60_000,
      })

      await expect(engine.fetch({ url: 'https://access-denied.example/1' })).resolves.toMatchObject({ status })
      await expect(engine.fetch({ url: 'https://access-denied.example/2' })).resolves.toMatchObject({ status })
      await expect(engine.fetch({ url: 'https://access-denied.example/3' })).rejects.toMatchObject({
        code: 'PLAYWRIGHT_CIRCUIT_OPEN',
        host: 'access-denied.example',
      })
      expect(goto).toHaveBeenCalledTimes(2)

      await engine.close()
    },
  )

  it('opens a throttling circuit after repeated HTTP 429 responses', async () => {
    responseStatus = 429
    const engine = createCrawleeSpaEngine({
      concurrency: 1,
      perHostMinIntervalMs: 0,
      circuitFailureThreshold: 2,
      throttlingCooldownMs: 60_000,
    })

    await expect(engine.fetch({ url: 'https://throttled.example/1' })).resolves.toMatchObject({ status: 429 })
    await expect(engine.fetch({ url: 'https://throttled.example/2' })).resolves.toMatchObject({ status: 429 })
    await expect(engine.fetch({ url: 'https://throttled.example/3' })).rejects.toMatchObject({
      code: 'PLAYWRIGHT_CIRCUIT_OPEN',
      host: 'throttled.example',
    })
    expect(goto).toHaveBeenCalledTimes(2)

    await engine.close()
  })

  it.each([404, 410])('treats an expected terminal HTTP %i as a successful host outcome', async (status) => {
    const engine = createCrawleeSpaEngine({
      concurrency: 1,
      perHostMinIntervalMs: 0,
      circuitFailureThreshold: 2,
    })
    goto.mockRejectedValueOnce(new Error('temporary network failure'))
    responseStatus = status

    await expect(engine.fetch({ url: 'https://gone.example/1' })).rejects.toThrow('temporary network failure')
    await expect(engine.fetch({ url: 'https://gone.example/2' })).resolves.toMatchObject({ status })
    await expect(engine.fetch({ url: 'https://gone.example/3' })).resolves.toMatchObject({ status })
    expect(goto).toHaveBeenCalledTimes(3)

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
