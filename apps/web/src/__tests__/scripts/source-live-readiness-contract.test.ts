import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const repoRoot = resolve(process.cwd(), '..', '..')
const readinessPath = resolve(repoRoot, 'packages', 'db', 'source-readiness.json')
const verifierPath = resolve(repoRoot, 'packages', 'db', 'scripts', 'verify-sources-live-config.mjs')
const sourceActionPath = resolve(repoRoot, 'packages', 'db', 'scripts', 'run-source-action.mjs')
const coveragePath = resolve(repoRoot, 'packages', 'db', 'scripts', 'source-coverage-requirements.mjs')
const packageJsonPath = resolve(repoRoot, 'package.json')
const hhIngestPath = resolve(repoRoot, 'packages', 'db', 'scripts', 'ingest-hh.mjs')
const hhLiveVerifierPath = resolve(repoRoot, 'packages', 'db', 'scripts', 'verify-hh-live-pipeline.mjs')
const jobSourceLiveVerifierPath = resolve(repoRoot, 'packages', 'db', 'scripts', 'verify-job-source-live-pipeline.mjs')
const sourceLiveDbRunnerPath = resolve(repoRoot, 'packages', 'db', 'scripts', 'run-source-live-db-verifier.mjs')
const credentialManifestPath = resolve(repoRoot, 'packages', 'db', 'source-credentials.json')
const credentialVerifierPath = resolve(repoRoot, 'packages', 'db', 'scripts', 'verify-source-credentials.mjs')
const habrSourcePath = resolve(repoRoot, 'packages', 'db', 'scripts', 'source-habr-career.mjs')

const SOURCE_IDS = [
  'hh',
  'career-pages',
  'greenhouse',
  'lever',
  'ashby',
  'recruitee',
  'workable',
  'smartrecruiters',
  'rabota-rossii',
  'habr-career',
  'superjob',
  'linkedin-company-pages',
  'egrul-fns',
  'transparent-business-fns',
  'fedresurs',
  'company-site',
  'funding-business-signals',
  'company-newsrooms',
  'industry-media',
  'github-company-org',
  'youtube-company-channels',
  'fns-open-data',
  'government-procurement',
  'cbr-registry',
  'rosstat-open-data',
  'rospatent-open-data',
] as const

const SOURCE_ENV_PREFIXES = [
  'HH_',
  'CAREER_PAGES_',
  'RABOTA_ROSSII_',
  'HABR_CAREER_',
  'SUPERJOB_',
  'LINKEDIN_',
  'REGIONAL_JOB_BOARDS_',
  'EGRUL_FNS_',
  'TRANSPARENT_BUSINESS_FNS_',
  'FEDRESURS_',
  'COMPANY_SITE_',
  'FUNDING_SIGNALS_',
  'COMPANY_NEWSROOMS_',
  'INDUSTRY_MEDIA_',
  'GITHUB_COMPANY_ORG_',
  'YOUTUBE_',
  'FNS_OPEN_DATA_',
  'GOVERNMENT_PROCUREMENT_',
  'GOVERNMENT_ENRICHMENT_',
  'CBR_REGISTRY_',
  'ROSSTAT_OPEN_DATA_',
  'ROSPATENT_OPEN_DATA_',
]

function sourceFreeEnv(): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => (
        key !== 'DATABASE_URL'
        && !SOURCE_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))
      )),
    ),
    NODE_ENV: process.env.NODE_ENV ?? 'test',
  }
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
          mode: expect.stringMatching(/^(not-required|launch-required|registration-required|provider-required)$/),
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
      expect(contract.pipelineProfiles[readiness.pipelineProfile].observability).toBe('contract-tested')
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
      liveReachable: true,
      liveVerified: true,
      finalState: 'digest-eligible',
    }))

    const superjob = report.sources.find((source: { id: string }) => source.id === 'superjob')
    expect(superjob).toEqual(expect.objectContaining({
      configured: false,
      liveVerified: true,
      registrationRequired: true,
      providerRequired: false,
      finalState: 'registration-required',
    }))

    const hh = report.sources.find((source: { id: string }) => source.id === 'hh')
    expect(hh).toEqual(expect.objectContaining({
      configured: false,
      liveVerified: false,
      registrationRequired: true,
      finalState: 'registration-required',
    }))

    const linkedin = report.sources.find((source: { id: string }) => source.id === 'linkedin-company-pages')
    expect(linkedin).toEqual(expect.objectContaining({
      configured: false,
      providerRequired: true,
      finalState: 'provider-required',
    }))

    for (const sourceId of ['greenhouse', 'lever', 'ashby', 'recruitee', 'workable', 'smartrecruiters']) {
      expect(report.sources.find((source: { id: string }) => source.id === sourceId)).toEqual(
        expect.objectContaining({ configured: true, liveVerified: true, finalState: 'digest-eligible' }),
      )
    }
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
      expect.objectContaining({ configured: false, registrationRequired: true, liveVerified: false }),
    )
    expect(report.sources.find((source: { id: string }) => source.id === 'career-pages')).toEqual(
      expect.objectContaining({ configured: true, liveVerified: true }),
    )
  })

  it('treats DATABASE_URL as the canonical career target auto-discovery configuration', () => {
    const databaseOnly = spawnSync(process.execPath, [verifierPath, '--json'], {
      cwd: repoRoot,
      env: { ...sourceFreeEnv(), DATABASE_URL: 'postgresql://isolated.invalid/test' },
      encoding: 'utf8',
    })
    const databaseOnlyReport = JSON.parse(databaseOnly.stdout)
    expect(databaseOnlyReport.sources.find((source: { id: string }) => source.id === 'career-pages'))
      .toEqual(expect.objectContaining({ configured: true, liveVerified: true, finalState: 'digest-eligible' }))

    const linkedinInput = spawnSync(process.execPath, [verifierPath, '--json'], {
      cwd: repoRoot,
      env: {
        ...sourceFreeEnv(),
        LINKEDIN_COMPANY_PAGES_INPUT_FILE: 'company-snapshot.json',
      },
      encoding: 'utf8',
    })
    const linkedinReport = JSON.parse(linkedinInput.stdout)
    expect(linkedinReport.sources.find((source: { id: string }) => source.id === 'linkedin-company-pages'))
      .toEqual(expect.objectContaining({ configured: true, liveVerified: false }))
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
        promotionStatus: ['hh', 'career-pages', 'greenhouse', 'lever', 'ashby', 'recruitee', 'workable', 'rabota-rossii', 'superjob'].includes(id)
          ? 'digest-allowed'
          : readReadinessContract().sources[id].eligibility === 'supporting-evidence-only'
            ? 'supporting-evidence-only'
            : readReadinessContract().sources[id].eligibility === 'context-only'
              ? 'never-lead-originating'
              : id === 'egrul-fns' || id === 'transparent-business-fns'
                ? 'never-lead-originating'
                : 'blocked-from-digest-pending-confidence-tests',
        readiness: {
          implementation: readReadinessContract().sources[id].implementation,
          contract: readReadinessContract().sources[id].contract,
        },
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

  it('makes generic source commands operate on the full primary set', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    expect(packageJson.scripts['source:fetch:primary']).toContain('run-source-action.mjs fetch primary')
    expect(packageJson.scripts['source:ingest:primary']).toContain('run-source-action.mjs ingest primary')
    expect(packageJson.scripts['source:pipeline:primary']).toContain('run-source-action.mjs pipeline primary')

    const runner = readFileSync(sourceActionPath, 'utf8')
    expect(runner).toContain("requestedSourceId === 'primary'")
    expect(runner).toContain('listPrimaryIngestionSourceIds')
  })

  it('keeps HH live verification isolated, explicit, and independent of local env files', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    expect(packageJson.scripts['verify:hh:smoke']).toBe('node packages/db/scripts/verify-hh-smoke.mjs')
    expect(packageJson.scripts['verify:hh:oauth']).toBe('node packages/db/scripts/verify-hh-oauth-smoke.mjs')
    expect(packageJson.scripts['verify:hh:live-pipeline']).toBe('node packages/db/scripts/verify-hh-live-pipeline.mjs')

    expect(existsSync(hhLiveVerifierPath)).toBe(true)
    const verifier = readFileSync(hhLiveVerifierPath, 'utf8')
    expect(verifier).toContain("HH_LIVE_VERIFY !== '1'")
    expect(verifier).toContain("SOURCE_IDENTITY_LINEAGE_DB_TEST_ACK !== 'isolated'")
    expect(verifier).toContain("SOURCE_ENV_FILE_DISABLED: 'true'")
    expect(verifier).toContain("process.env.HH_CLIENT_ID?.trim()")
    expect(verifier).toContain("process.env.HH_CLIENT_SECRET?.trim()")
    expect(verifier).toContain('source_signal_evidence_lineage_v1')
    expect(verifier).toContain("source = 'hh'")
    expect(verifier).toContain("publisher_type' = 'direct-employer")

    const ingest = readFileSync(hhIngestPath, 'utf8')
    expect(ingest).toContain("process.env.SOURCE_ENV_FILE_DISABLED === 'true'")

    const readiness = readReadinessContract().sources.hh
    expect(readiness.blockers).toEqual(['credential-not-supplied'])
    expect(JSON.stringify(readiness)).not.toMatch(/proxy|geo|RU-resident egress/i)
  })

  it('provides disposable live DB verification for job APIs and public ATS sources', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    expect(packageJson.scripts['verify:superjob:live-db']).toBe(
      'node packages/db/scripts/run-source-live-db-verifier.mjs superjob',
    )
    expect(packageJson.scripts['verify:rabota-rossii:live-db']).toBe(
      'node packages/db/scripts/run-source-live-db-verifier.mjs rabota-rossii',
    )
    expect(packageJson.scripts['verify:career-pages:public-ats-live-db']).toBe(
      'node packages/db/scripts/run-source-live-db-verifier.mjs public-ats',
    )
    expect(packageJson.scripts['verify:funding-business-signals:live-db']).toBe(
      'node packages/db/scripts/run-source-live-db-verifier.mjs gdelt',
    )

    expect(existsSync(jobSourceLiveVerifierPath)).toBe(true)
    expect(existsSync(sourceLiveDbRunnerPath)).toBe(true)

    const verifier = readFileSync(jobSourceLiveVerifierPath, 'utf8')
    expect(verifier).toContain("SOURCE_IDENTITY_LINEAGE_DB_TEST_ACK !== 'isolated'")
    expect(verifier).toContain("SOURCE_ENV_FILE_DISABLED: 'true'")
    expect(verifier).toContain('source_signal_evidence_lineage_v1')
    expect(verifier).toContain("candidate_eligible")
    expect(verifier).toContain("publisher_type' = 'direct-employer")
    expect(verifier).toContain("INTERVAL '30 days'")
    expect(verifier).toContain('sensitive_payload_rows')

    const runner = readFileSync(sourceLiveDbRunnerPath, 'utf8')
    expect(runner).toContain("SOURCE_LIVE_DB_TEST_ACK !== 'isolated'")
    expect(runner).toContain('CREATE DATABASE')
    expect(runner).toContain('DROP DATABASE IF EXISTS')
    expect(runner).toContain('WITH (FORCE)')
    expect(runner).toContain("'public-ats'")
    expect(runner).toContain("'gdelt'")
    expect(runner).toContain("'./verify-gdelt-live-pipeline.mjs'")
  })

  it('classifies source access and credential availability without storing secret values', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    expect(packageJson.scripts['verify:source:credentials']).toBe(
      'node packages/db/scripts/verify-source-credentials.mjs',
    )
    expect(existsSync(credentialManifestPath)).toBe(true)
    expect(existsSync(credentialVerifierPath)).toBe(true)

    const manifest = JSON.parse(readFileSync(credentialManifestPath, 'utf8'))
    expect(Object.keys(manifest.classes).sort()).toEqual(['A', 'B', 'C', 'D'])
    expect(Object.keys(manifest.sources).sort()).toEqual([...SOURCE_IDS].sort())
    expect(manifest.sources.superjob).toEqual(expect.objectContaining({
      accessClass: 'B',
      registration: 'free',
      runtimeAvailability: expect.objectContaining({ state: 'configured' }),
    }))
    expect(manifest.sources.superjob.credentialSets).toContainEqual(
      expect.objectContaining({ names: ['SUPERJOB_API_APP_ID'] }),
    )
    expect(manifest.sources['rabota-rossii']).toEqual(expect.objectContaining({
      accessClass: 'A',
      credentialSets: [],
    }))
    expect(manifest.sources['funding-business-signals']).toEqual(expect.objectContaining({
      accessClass: 'A',
      registration: 'none-for-gdelt',
    }))
    expect(manifest.sources['habr-career']).toEqual(expect.objectContaining({
      accessClass: 'C',
      registration: 'explicit-permission-or-provider',
    }))

    const serialized = JSON.stringify(manifest)
    expect(serialized).not.toMatch(/(secretValue|tokenValue|credentialValue)/i)

    const verified = spawnSync(process.execPath, [credentialVerifierPath, '--json'], {
      cwd: repoRoot,
      env: sourceFreeEnv(),
      encoding: 'utf8',
    })
    expect(verified.status).toBe(0)
    const report = JSON.parse(verified.stdout)
    expect(report.sources.find((source: { id: string }) => source.id === 'superjob')).toEqual(
      expect.objectContaining({ accessClass: 'B', configuredNow: false }),
    )
    expect(report.sources.find((source: { id: string }) => source.id === 'rabota-rossii')).toEqual(
      expect.objectContaining({ accessClass: 'A', configuredNow: true }),
    )
  })

  it('keeps Habr Career direct commercial HTML collection disabled', () => {
    const source = readFileSync(habrSourcePath, 'utf8')
    expect(source).not.toContain('fetchHabrCareerPages')
    expect(source).not.toContain('HABR_CAREER_KEYWORD')
    expect(source).not.toContain('live-scrape')

    const readiness = readReadinessContract().sources['habr-career']
    expect(readiness.configuration.mode).toBe('provider-required')
    expect(readiness.live.state).toBe('blocked')
    expect(readiness.legalReview).toBe('required')
  })
})
