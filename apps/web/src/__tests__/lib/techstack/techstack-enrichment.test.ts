/**
 * Unit tests for the techstack enrichment pilot module.
 *
 * All scanner interactions are replayed from RECORDED JSON fixtures
 * (apps/web/fixtures/techstack-scanner/, captured 27.09.2026 by the
 * webstack-scanner capability) — there is NO live HTTP and NO real subprocess
 * in these tests. The child_process seam (`node-exec`) is mocked exactly like
 * source-ingest.test.ts does.
 */

import {
  enrichDomainsWithTechstack,
  loadTechstackConfig,
  normalizeTechstackDomain,
  parseScannerOutput,
  scanDomainTechstack,
  toTechstackEvidence,
  buildScannerEnv,
  TECHSTACK_SCANNER_DEFAULTS,
  TECHSTACK_TIMEOUT_MS,
  TECHSTACK_MIN_DELAY_MS,
  TECHSTACK_MAX_DOMAINS_PER_RUN,
  type TechstackConfig,
} from '@/lib/techstack/techstack-enrichment'

import hhOkFixture from '@/fixtures/techstack-scanner/hh-ru.ok.json'
import vercelOkFixture from '@/fixtures/techstack-scanner/vercel-com.ok.json'
import ozonErrorFixture from '@/fixtures/techstack-scanner/ozon-ru.fetch-error.json'

// Mock the execFile accessor (production resolves execFile via
// process.getBuiltinModule, which bypasses jest's require-cache mock —
// so we mock the node-exec seam instead of node:child_process).
const mockExecFileFn = jest.fn()
jest.mock('@/lib/lead-discovery/node-exec', () => ({
  getExecFile: jest.fn(() => mockExecFileFn),
}))

function testConfig(overrides: Partial<TechstackConfig> = {}): TechstackConfig {
  return {
    enabled: true,
    pythonPath: 'C:/tools/venv/python.exe',
    scannerScript: 'C:/tools/webstack-scanner/scan.py',
    timeoutMs: TECHSTACK_TIMEOUT_MS,
    maxRetries: 1,
    minDelayMs: TECHSTACK_MIN_DELAY_MS,
    maxDomainsPerRun: TECHSTACK_MAX_DOMAINS_PER_RUN,
    ...overrides,
  }
}

const FIXED_NOW = new Date('2026-09-27T12:00:00.000Z')
function fixedDeps() {
  const sleeps: number[] = []
  return {
    sleeps,
    deps: {
      now: () => FIXED_NOW,
      sleep: async (ms: number) => {
        sleeps.push(ms)
      },
    },
  }
}

function replyWith(payload: unknown) {
  return (_cmd: unknown, _args: unknown, _opts: unknown, callback: (e: unknown, out: string, err: string) => void) => {
    callback(null, typeof payload === 'string' ? payload : JSON.stringify(payload), '')
  }
}

beforeEach(() => {
  mockExecFileFn.mockReset()
})

describe('loadTechstackConfig', () => {
  it('is disabled by default and pins the canonical scanner command', () => {
    const config = loadTechstackConfig({})
    expect(config.enabled).toBe(false)
    expect(config.pythonPath).toBe(TECHSTACK_SCANNER_DEFAULTS.pythonPath)
    expect(config.scannerScript).toBe(TECHSTACK_SCANNER_DEFAULTS.scannerScript)
    expect(config.timeoutMs).toBe(40_000)
    expect(config.maxRetries).toBe(1)
    expect(config.minDelayMs).toBe(1_000)
    expect(config.maxDomainsPerRun).toBe(200)
  })

  it('enables only on an explicit true flag (case-insensitive)', () => {
    expect(loadTechstackConfig({ TECHSTACK_ENRICHMENT_ENABLED: 'true' }).enabled).toBe(true)
    expect(loadTechstackConfig({ TECHSTACK_ENRICHMENT_ENABLED: 'TRUE' }).enabled).toBe(true)
    expect(loadTechstackConfig({ TECHSTACK_ENRICHMENT_ENABLED: '1' }).enabled).toBe(false)
    expect(loadTechstackConfig({ TECHSTACK_ENRICHMENT_ENABLED: 'yes' }).enabled).toBe(false)
  })

  it('lets env tighten guards but never relax them past the spec bounds', () => {
    const relaxed = loadTechstackConfig({
      TECHSTACK_MIN_DELAY_MS: '10',
      TECHSTACK_MAX_DOMAINS: '5000',
      TECHSTACK_MAX_RETRIES: '9',
    })
    expect(relaxed.minDelayMs).toBe(1_000)
    expect(relaxed.maxDomainsPerRun).toBe(200)
    expect(relaxed.maxRetries).toBe(1)

    const tightened = loadTechstackConfig({
      TECHSTACK_MIN_DELAY_MS: '2500',
      TECHSTACK_MAX_DOMAINS: '5',
      TECHSTACK_TIMEOUT_MS: '10000',
    })
    expect(tightened.minDelayMs).toBe(2_500)
    expect(tightened.maxDomainsPerRun).toBe(5)
    expect(tightened.timeoutMs).toBe(10_000)
  })
})

describe('normalizeTechstackDomain', () => {
  it('normalises case and extracts hostnames from URLs', () => {
    expect(normalizeTechstackDomain('Example.COM')).toBe('example.com')
    expect(normalizeTechstackDomain('https://hh.ru/careers?from=menu#top')).toBe('hh.ru')
    expect(normalizeTechstackDomain('http://www.vercel.com/')).toBe('www.vercel.com')
  })

  it('rejects unusable input', () => {
    expect(normalizeTechstackDomain('')).toBeNull()
    expect(normalizeTechstackDomain('   ')).toBeNull()
    expect(normalizeTechstackDomain('not a domain')).toBeNull()
    expect(normalizeTechstackDomain('user@corp.ru')).toBeNull()
    expect(normalizeTechstackDomain('corp.ru:8080')).toBeNull()
    expect(normalizeTechstackDomain('.corp.ru')).toBeNull()
    expect(normalizeTechstackDomain('localhost')).toBeNull()
    expect(normalizeTechstackDomain(null)).toBeNull()
    expect(normalizeTechstackDomain(42)).toBeNull()
  })
})

describe('scanDomainTechstack — happy path (recorded fixtures)', () => {
  it('runs the canonical scanner command and maps every tool to evidence', async () => {
    mockExecFileFn.mockImplementation(replyWith(hhOkFixture))
    const { deps } = fixedDeps()
    const outcome = await scanDomainTechstack('hh.ru', testConfig(), deps)

    expect(mockExecFileFn).toHaveBeenCalledTimes(1)
    const [cmd, args, opts] = mockExecFileFn.mock.calls[0]
    expect(cmd).toBe('C:/tools/venv/python.exe')
    expect(args).toEqual(['C:/tools/webstack-scanner/scan.py', '--domain', 'hh.ru'])
    expect(opts.timeout).toBe(40_000)
    expect(opts.windowsHide).toBe(true)

    expect(outcome.status).toBe('ok')
    expect(outcome.attempts).toBe(1)
    expect(outcome.error).toBeNull()
    expect(outcome.raw?.tools).toHaveLength(hhOkFixture.tools.length)

    const evidence = toTechstackEvidence(outcome)
    expect(evidence).toHaveLength(3)
    expect(evidence[0]).toEqual({
      source: 'techstack',
      tool: hhOkFixture.tools[0].name,
      categories: hhOkFixture.tools[0].categories,
      confidence: hhOkFixture.tools[0].confidence,
      version: hhOkFixture.tools[0].version,
      scanned_at: hhOkFixture.scanned_at,
      domain: 'hh.ru',
    })
    for (const record of evidence) {
      expect(record.source).toBe('techstack')
      expect(record.domain).toBe('hh.ru')
      expect(record.scanned_at).toBe(hhOkFixture.scanned_at)
    }
  })

  it('maps a multi-tool scan (vercel fixture) into one record per tool', async () => {
    mockExecFileFn.mockImplementation(replyWith(vercelOkFixture))
    const outcome = await scanDomainTechstack('vercel.com', testConfig())
    expect(outcome.status).toBe('ok')
    const evidence = toTechstackEvidence(outcome)
    expect(evidence).toHaveLength(vercelOkFixture.tools.length)
    expect(evidence.every((record) => record.tool !== null)).toBe(true)
  })

  it('does not leak app secrets into the scanner child env', async () => {
    mockExecFileFn.mockImplementation(replyWith(hhOkFixture))
    const previous = process.env.DATABASE_URL
    process.env.DATABASE_URL = 'postgres://super-secret'
    try {
      await scanDomainTechstack('hh.ru', testConfig())
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previous
    }
    const [, , opts] = mockExecFileFn.mock.calls[0]
    expect(opts.env.DATABASE_URL).toBeUndefined()
    expect(opts.env.PYTHONUTF8).toBe('1')
    expect(buildScannerEnv({ DATABASE_URL: 'x', PATH: 'C:\\bin' })).toEqual({
      NODE_ENV: 'production',
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
      PATH: 'C:\\bin',
    })
    expect(buildScannerEnv({ NODE_ENV: 'test' }).NODE_ENV).toBe('test')
  })
})

describe('scanDomainTechstack — fail-closed behaviour', () => {
  it('turns a recorded fetch_error into error-evidence without retrying', async () => {
    mockExecFileFn.mockImplementation(replyWith(ozonErrorFixture))
    const outcome = await scanDomainTechstack('ozon.ru', testConfig())

    expect(mockExecFileFn).toHaveBeenCalledTimes(1) // fortress site is NOT hammered
    expect(outcome.status).toBe('fetch_error')
    expect(outcome.attempts).toBe(1)
    expect(outcome.error).toBe(ozonErrorFixture.fetch_error)

    const evidence = toTechstackEvidence(outcome)
    expect(evidence).toHaveLength(1)
    expect(evidence[0]).toEqual({
      source: 'techstack',
      tool: null,
      categories: [],
      confidence: 0,
      version: null,
      scanned_at: ozonErrorFixture.scanned_at,
      domain: 'ozon.ru',
      error: ozonErrorFixture.fetch_error,
      error_kind: 'fetch_error',
    })
  })

  it('retries a crashed subprocess once and recovers', async () => {
    mockExecFileFn
      .mockImplementationOnce((_c, _a, _o, cb: (e: unknown, out: string, err: string) => void) => {
        cb(new Error('spawn ENOENT'), '', '')
      })
      .mockImplementationOnce(replyWith(hhOkFixture))
    const outcome = await scanDomainTechstack('hh.ru', testConfig())
    expect(mockExecFileFn).toHaveBeenCalledTimes(2)
    expect(outcome.status).toBe('ok')
    expect(outcome.attempts).toBe(2)
  })

  it('degrades to scanner_error evidence after exhausting retries — never throws', async () => {
    mockExecFileFn.mockImplementation((_c, _a, _o, cb: (e: unknown, out: string, err: string) => void) => {
      cb(new Error('boom'), '', 'traceback text')
    })
    const outcome = await scanDomainTechstack('hh.ru', testConfig())
    expect(mockExecFileFn).toHaveBeenCalledTimes(2)
    expect(outcome.status).toBe('scanner_error')
    expect(outcome.attempts).toBe(2)
    expect(outcome.error).toContain('boom')
    expect(outcome.error).toContain('traceback text')

    const evidence = toTechstackEvidence(outcome)
    expect(evidence).toHaveLength(1)
    expect(evidence[0].tool).toBeNull()
    expect((evidence[0] as { error_kind: string }).error_kind).toBe('scanner_error')
  })

  it('classifies a timeout kill explicitly', async () => {
    mockExecFileFn.mockImplementation((_c, _a, _o, cb: (e: unknown, out: string, err: string) => void) => {
      cb(Object.assign(new Error('killed'), { killed: true }), '', '')
    })
    const outcome = await scanDomainTechstack('slow.example-scan.com', testConfig())
    expect(outcome.status).toBe('scanner_error')
    expect(outcome.error).toContain('timed out after 40000ms')
  })

  it('retries unparsable output and reports invalid_output when it persists', async () => {
    mockExecFileFn
      .mockImplementationOnce(replyWith('<html>captcha</html>'))
      .mockImplementationOnce(replyWith('{"broken": true}'))
    const outcome = await scanDomainTechstack('hh.ru', testConfig())
    expect(mockExecFileFn).toHaveBeenCalledTimes(2)
    expect(outcome.status).toBe('invalid_output')
    expect(outcome.attempts).toBe(2)
    expect(toTechstackEvidence(outcome)[0].tool).toBeNull()
  })

  it('rejects an invalid domain without spawning anything', async () => {
    const outcome = await scanDomainTechstack('definitely not a domain', testConfig())
    expect(mockExecFileFn).not.toHaveBeenCalled()
    expect(outcome.status).toBe('invalid_domain')
    expect(outcome.attempts).toBe(0)
    expect(toTechstackEvidence(outcome)).toHaveLength(1)
  })
})

describe('parseScannerOutput', () => {
  it('accepts recorded scanner JSON and drops unknown fields', () => {
    const parsed = parseScannerOutput(JSON.stringify(hhOkFixture))
    expect(parsed).not.toBeNull()
    expect(parsed?.domain).toBe('hh.ru')
    expect(parsed?.tools).toHaveLength(3)
    expect(parsed).not.toHaveProperty('engine')
    expect(parsed).not.toHaveProperty('db_load_s')
  })

  it('rejects non-JSON and contract-violating payloads', () => {
    expect(parseScannerOutput('not json')).toBeNull()
    expect(parseScannerOutput('[]')).toBeNull()
    expect(parseScannerOutput('{}')).toBeNull()
    expect(parseScannerOutput('{"domain":"x.ru"}')).toBeNull() // neither tools nor fetch_error
    expect(parseScannerOutput('{"tools":[]}')).toBeNull() // no domain
  })

  it('normalises malformed tool entries instead of crashing', () => {
    const parsed = parseScannerOutput(
      JSON.stringify({
        domain: 'x.ru',
        tools: [
          { name: 'Good', confidence: 90, categories: ['Analytics'] },
          { name: '', confidence: 100 },
          { name: 'NoConfidence', categories: 'not-an-array' },
          null,
          'junk',
        ],
        fetch_error: null,
      }),
    )
    expect(parsed?.tools).toEqual([
      { name: 'Good', confidence: 90, version: null, sources: [], categories: ['Analytics'] },
      { name: 'NoConfidence', confidence: 0, version: null, sources: [], categories: [] },
    ])
  })
})

describe('enrichDomainsWithTechstack — guards', () => {
  it('scans nothing while the feature flag is off (default)', async () => {
    const { deps } = fixedDeps()
    const report = await enrichDomainsWithTechstack(
      ['hh.ru', 'vercel.com'],
      testConfig({ enabled: false }),
      deps,
    )
    expect(mockExecFileFn).not.toHaveBeenCalled()
    expect(report.enabled).toBe(false)
    expect(report.scannedCount).toBe(0)
    expect(report.results).toEqual([])
    expect(report.skipped).toEqual([
      { input: 'hh.ru', reason: 'disabled' },
      { input: 'vercel.com', reason: 'disabled' },
    ])
  })

  it('caps a run at maxDomainsPerRun and reports truncation', async () => {
    mockExecFileFn.mockImplementation(replyWith(hhOkFixture))
    const { deps } = fixedDeps()
    const report = await enrichDomainsWithTechstack(
      ['a.example.com', 'b.example.com', 'c.example.com', 'd.example.com', 'e.example.com'],
      testConfig({ maxDomainsPerRun: 2 }),
      deps,
    )
    expect(report.scannedCount).toBe(2)
    expect(report.truncated).toBe(true)
    expect(report.results.map((entry) => entry.domain)).toEqual(['a.example.com', 'b.example.com'])
    expect(report.skipped.filter((entry) => entry.reason === 'over_limit')).toHaveLength(3)
  })

  it('dedupes case-insensitively and skips invalid input', async () => {
    mockExecFileFn.mockImplementation(replyWith(hhOkFixture))
    const { deps } = fixedDeps()
    const report = await enrichDomainsWithTechstack(
      ['hh.ru', 'HH.ru', 'https://hh.ru/jobs', 'not a domain', ''],
      testConfig(),
      deps,
    )
    expect(report.scannedCount).toBe(1)
    expect(report.requestedCount).toBe(5)
    expect(report.skipped).toEqual([
      { input: 'hh.ru', reason: 'duplicate' },
      { input: 'hh.ru', reason: 'duplicate' },
      { input: 'not a domain', reason: 'invalid_domain' },
      { input: '', reason: 'invalid_domain' },
    ])
  })

  it('scans strictly sequentially with the politeness delay between domains', async () => {
    mockExecFileFn.mockImplementation(replyWith(hhOkFixture))
    const { sleeps, deps } = fixedDeps()
    const callOrder: string[] = []
    mockExecFileFn.mockImplementation((...callArgs: unknown[]) => {
      const args = callArgs[1] as string[]
      const callback = callArgs[3] as (e: unknown, out: string, err: string) => void
      callOrder.push(args[2])
      callback(null, JSON.stringify(hhOkFixture), '')
    })
    const report = await enrichDomainsWithTechstack(
      ['one.example.com', 'two.example.com', 'three.example.com'],
      testConfig(),
      deps,
    )
    expect(callOrder).toEqual(['one.example.com', 'two.example.com', 'three.example.com'])
    expect(sleeps).toEqual([1_000, 1_000]) // n-1 pauses, each ≥ 1 s
    expect(report.scannedCount).toBe(3)
    expect(report.domainsWithTools).toBe(3)
    expect(report.toolEvidenceCount).toBe(9)
    expect(report.errorEvidenceCount).toBe(0)
  })

  it('keeps the batch alive when one domain fails (fail-closed pipeline)', async () => {
    mockExecFileFn
      .mockImplementationOnce(replyWith(hhOkFixture))
      .mockImplementation((_c, _a, _o, cb: (e: unknown, out: string, err: string) => void) => {
        cb(new Error('dead site'), '', '')
      })
    const { deps } = fixedDeps()
    const report = await enrichDomainsWithTechstack(['hh.ru', 'broken.example.com'], testConfig(), deps)
    expect(report.scannedCount).toBe(2)
    expect(report.results[0].outcome.status).toBe('ok')
    expect(report.results[1].outcome.status).toBe('scanner_error')
    expect(report.toolEvidenceCount).toBe(3)
    expect(report.errorEvidenceCount).toBe(1)
  })

  it('timestamps the report from the injected clock', async () => {
    mockExecFileFn.mockImplementation(replyWith(hhOkFixture))
    const { deps } = fixedDeps()
    const report = await enrichDomainsWithTechstack(['hh.ru'], testConfig(), deps)
    expect(report.startedAt).toBe(FIXED_NOW.toISOString())
    expect(report.finishedAt).toBe(FIXED_NOW.toISOString())
    expect(report.totalElapsedMs).toBe(0)
  })
})
