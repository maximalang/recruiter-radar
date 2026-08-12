import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const repoRoot = resolve(process.cwd(), '..', '..')
const readinessPath = resolve(repoRoot, 'packages', 'db', 'source-readiness.json')
const verifierPath = resolve(repoRoot, 'packages', 'db', 'scripts', 'verify-sources-live-config.mjs')
const sourceActionPath = resolve(repoRoot, 'packages', 'db', 'scripts', 'run-source-action.mjs')
const coveragePath = resolve(repoRoot, 'packages', 'db', 'scripts', 'source-coverage-requirements.mjs')

const SOURCE_IDS = [
  'hh',
  'career-pages',
  'rabota-rossii',
  'habr-career',
  'superjob',
  'tech-job-boards',
  'linkedin-company-pages',
  'regional-job-boards',
  'egrul-fns',
  'transparent-business-fns',
  'fedresurs',
  'company-site',
  'funding-business-signals',
  'company-newsrooms',
  'industry-media',
] as const

const SOURCE_ENV_PREFIXES = [
  'HH_',
  'CAREER_PAGES_',
  'RABOTA_ROSSII_',
  'HABR_CAREER_',
  'SUPERJOB_',
  'TECH_JOB_BOARDS_',
  'LINKEDIN_',
  'REGIONAL_JOB_BOARDS_',
  'EGRUL_FNS_',
  'TRANSPARENT_BUSINESS_FNS_',
  'FEDRESURS_',
  'COMPANY_SITE_',
  'FUNDING_SIGNALS_',
  'COMPANY_NEWSROOMS_',
  'INDUSTRY_MEDIA_',
]

function sourceFreeEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => (
      key !== 'DATABASE_URL'
      && !SOURCE_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))
    )),
  )
}

function readReadinessContract(): Record<string, any> {
  return JSON.parse(readFileSync(readinessPath, 'utf8'))
}

describe('source live readiness contract', () => {
  it('defines explicit, auditable readiness for every registered source', () => {
    expect(existsSync(readinessPath)).toBe(true)

    const contract = readReadinessContract()
    expect(Object.keys(contract.sources).sort()).toEqual([...SOURCE_IDS].sort())

    for (const sourceId of SOURCE_IDS) {
      const readiness = contract.sources[sourceId]
      expect(readiness).toEqual(expect.objectContaining({
        implementation: 'implemented',
        fixture: expect.stringMatching(/^(tested|not-applicable)$/),
        contract: 'tested',
        configuration: expect.objectContaining({
          mode: expect.stringMatching(/^(not-required|launch-required|provider-required)$/),
          acceptedEnvSets: expect.any(Array),
        }),
        live: expect.objectContaining({
          state: expect.stringMatching(/^(unverified|reachable|verified|blocked)$/),
          evidence: expect.any(Array),
        }),
        confidence: expect.stringMatching(/^(approved|pending|not-applicable)$/),
        eligibility: expect.stringMatching(/^(digest-eligible|supporting-evidence-only|enrichment-only|context-only)$/),
        legalReview: expect.stringMatching(/^(not-required|required|approved)$/),
        pipelineProfile: expect.any(String),
        blockers: expect.any(Array),
      }))
      expect(contract.pipelineProfiles[readiness.pipelineProfile]).toEqual(expect.objectContaining({
        fetch: expect.any(String),
        normalize: expect.any(String),
        organizationResolution: expect.any(String),
        dedupe: expect.any(String),
        ingest: expect.any(String),
        evidence: expect.any(String),
        signal: expect.any(String),
        confidence: expect.any(String),
        opportunityEligibility: expect.any(String),
        observability: expect.any(String),
      }))
      expect(readiness.live).toHaveProperty('verifiedAt')
      expect(readiness.live.verifiedAt === null || typeof readiness.live.verifiedAt === 'string').toBe(true)

      if (readiness.live.state === 'verified') {
        expect(readiness.live.verifiedAt).toEqual(expect.any(String))
        expect(readiness.live.evidence.length).toBeGreaterThan(0)
      }
    }
  })

  it('reports configuration separately from current live verification', () => {
    const result = spawnSync(process.execPath, [verifierPath, '--json'], {
      cwd: repoRoot,
      env: sourceFreeEnv(),
      encoding: 'utf8',
    })
    const report = JSON.parse(result.stdout)

    const rabotaRossii = report.sources.find((source: { id: string }) => source.id === 'rabota-rossii')
    expect(rabotaRossii).toEqual(expect.objectContaining({
      configured: true,
      liveReachable: false,
      liveVerified: false,
      finalState: 'blocked',
    }))

    const hh = report.sources.find((source: { id: string }) => source.id === 'hh')
    expect(hh).toEqual(expect.objectContaining({
      configured: false,
      liveVerified: false,
      finalState: 'blocked',
    }))

    const linkedin = report.sources.find((source: { id: string }) => source.id === 'linkedin-company-pages')
    expect(linkedin).toEqual(expect.objectContaining({
      configured: false,
      providerRequired: true,
      finalState: 'provider-required',
    }))
  })

  it('never derives live verification from an env variable or HTTP capability', () => {
    const result = spawnSync(process.execPath, [verifierPath, '--json'], {
      cwd: repoRoot,
      env: {
        ...sourceFreeEnv(),
        HH_USER_AGENT: 'Recruiter Radar test contact',
        CAREER_PAGES_TARGETS_FILE: 'packages/db/scripts/career-pages-smoke-targets.json',
      },
      encoding: 'utf8',
    })
    const report = JSON.parse(result.stdout)

    expect(report.sources.find((source: { id: string }) => source.id === 'hh')).toEqual(
      expect.objectContaining({ configured: true, liveVerified: false }),
    )
    expect(report.sources.find((source: { id: string }) => source.id === 'career-pages')).toEqual(
      expect.objectContaining({ configured: true, liveVerified: false }),
    )
  })

  it('exposes the same evaluated readiness through the runtime registry', () => {
    const result = spawnSync(process.execPath, [sourceActionPath, 'list'], {
      cwd: repoRoot,
      env: sourceFreeEnv(),
      encoding: 'utf8',
    })
    const sources = JSON.parse(result.stdout)

    expect(sources).toHaveLength(SOURCE_IDS.length)
    for (const source of sources) {
      expect(source.readiness).toEqual(expect.objectContaining({
        configured: expect.any(Boolean),
        liveReachable: expect.any(Boolean),
        liveVerified: expect.any(Boolean),
        finalState: expect.any(String),
        pipeline: expect.any(Object),
      }))
    }
  })

  it('validates coverage through explicit readiness states, never lexical maturity labels', () => {
    const script = [
      `import { validateSourceCoverage } from ${JSON.stringify(`file:///${coveragePath.replaceAll('\\', '/')}`)};`,
      `const sources = ${JSON.stringify(SOURCE_IDS.map((id) => ({
        id,
        leadEligibility: readReadinessContract().sources[id].eligibility === 'digest-eligible'
          ? (id === 'rabota-rossii' ? 'confidence-gated-evidence' : 'digest-lead-originating')
          : readReadinessContract().sources[id].eligibility,
        promotionStatus: ['hh', 'career-pages', 'rabota-rossii'].includes(id)
          ? 'digest-allowed'
          : readReadinessContract().sources[id].eligibility === 'supporting-evidence-only'
            ? 'supporting-evidence-only'
            : readReadinessContract().sources[id].eligibility === 'context-only'
              ? 'never-lead-originating'
              : id === 'egrul-fns' || id === 'transparent-business-fns'
                ? 'never-lead-originating'
                : 'blocked-from-digest-pending-confidence-tests',
        readiness: readReadinessContract().sources[id],
      })))};`,
      `sources.find((source) => source.id === 'hh').readiness = { ...sources.find((source) => source.id === 'hh').readiness, implementation: 'blocked' };`,
      'console.log(JSON.stringify(validateSourceCoverage(sources)));',
    ].join('\n')
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: repoRoot,
      env: sourceFreeEnv(),
      encoding: 'utf8',
    })
    const report = JSON.parse(result.stdout)

    expect(report.errors).toContain('hh readiness implementation is blocked')
    expect(readFileSync(coveragePath, 'utf8')).not.toContain('minMaturity')
  })
})
