/** @jest-environment node */

import { NextRequest } from 'next/server'

jest.mock('@/lib/opportunities/jobs', () => ({
  detectHiringEpisodesJob: jest.fn(),
  buildOpportunitiesJob: jest.fn(),
  expireOpportunitiesJob: jest.fn(),
  backfillOpportunitiesJob: jest.fn(),
}))

jest.mock('@/lib/opportunities/company-event-job', () => ({
  normalizeCompanyEventsJob: jest.fn(),
}))

jest.mock('@/lib/opportunities/company-state-job', () => ({
  buildCompanyStateJob: jest.fn(),
}))

jest.mock('@/lib/opportunities/signal-episode-job', () => ({
  buildSignalEpisodesJob: jest.fn(),
}))

jest.mock('@/lib/opportunities/commercial-thesis-job', () => ({
  buildCommercialThesesJob: jest.fn(),
}))

jest.mock('@/lib/opportunities/external-agency-propensity-job', () => ({
  buildExternalAgencyPropensityJob: jest.fn(),
}))

jest.mock('@/lib/opportunities/agency-dna-match-job', () => ({
  buildAgencyDnaMatchJob: jest.fn(),
}))

jest.mock('@/lib/opportunities/opportunity-scoring-v3-job', () => ({
  buildOpportunityScoringV3Job: jest.fn(),
}))

import { backfillOpportunitiesJob } from '@/lib/opportunities/jobs'
import { normalizeCompanyEventsJob } from '@/lib/opportunities/company-event-job'
import { buildCompanyStateJob } from '@/lib/opportunities/company-state-job'
import { buildSignalEpisodesJob } from '@/lib/opportunities/signal-episode-job'
import { buildCommercialThesesJob } from '@/lib/opportunities/commercial-thesis-job'
import { buildExternalAgencyPropensityJob } from '@/lib/opportunities/external-agency-propensity-job'
import { buildAgencyDnaMatchJob } from '@/lib/opportunities/agency-dna-match-job'
import { buildOpportunityScoringV3Job } from '@/lib/opportunities/opportunity-scoring-v3-job'
import { GET, POST } from '@/app/api/cron/opportunities/[job]/route'

const mockedBackfill = jest.mocked(backfillOpportunitiesJob)
const mockedNormalizeCompanyEvents = jest.mocked(normalizeCompanyEventsJob)
const mockedBuildCompanyState = jest.mocked(buildCompanyStateJob)
const mockedBuildSignalEpisodes = jest.mocked(buildSignalEpisodesJob)
const mockedBuildCommercialTheses = jest.mocked(buildCommercialThesesJob)
const mockedBuildExternalAgencyPropensity = jest.mocked(
  buildExternalAgencyPropensityJob,
)
const mockedBuildAgencyDnaMatch = jest.mocked(buildAgencyDnaMatchJob)
const mockedBuildOpportunityScoringV3 = jest.mocked(
  buildOpportunityScoringV3Job,
)

function request(path: string, key?: string) {
  return new NextRequest(`https://recruiter-radar.ru${path}`, {
    method: 'POST',
    headers: key ? { 'x-api-key': key } : undefined,
  })
}

function getRequest(path: string, key?: string) {
  return new NextRequest(`https://recruiter-radar.ru${path}`, {
    headers: key ? { 'x-api-key': key } : undefined,
  })
}

describe('opportunity cron API', () => {
  const testKey = ['test', 'opportunity', 'cron', 'key'].join('-')
  const originalKey = process.env.CRON_API_KEY
  const originalFlag = process.env.OPPORTUNITY_ENGINE_V1_ENABLED
  const originalCompanyEventsFlag = process.env.COMPANY_EVENTS_V1_ENABLED
  const originalCompanyStateFlag = process.env.COMPANY_STATE_V1_ENABLED
  const originalSignalEpisodesFlag = process.env.SIGNAL_EPISODES_V2_ENABLED
  const originalCommercialThesisFlag = process.env.COMMERCIAL_THESIS_V1_ENABLED
  const originalExternalPropensityFlag =
    process.env.EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED
  const originalAgencyDnaMatchFlag = process.env.AGENCY_DNA_MATCH_V2_ENABLED
  const originalOpportunityScoringV3Flag =
    process.env.OPPORTUNITY_SCORING_V3_ENABLED

  beforeEach(() => {
    process.env.CRON_API_KEY = testKey
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'true'
    process.env.COMPANY_EVENTS_V1_ENABLED = 'false'
    process.env.COMPANY_STATE_V1_ENABLED = 'false'
    process.env.SIGNAL_EPISODES_V2_ENABLED = 'false'
    process.env.COMMERCIAL_THESIS_V1_ENABLED = 'false'
    process.env.EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED = 'false'
    process.env.AGENCY_DNA_MATCH_V2_ENABLED = 'false'
    process.env.OPPORTUNITY_SCORING_V3_ENABLED = 'false'
    jest.clearAllMocks()
  })

  afterAll(() => {
    if (originalKey === undefined) delete process.env.CRON_API_KEY
    else process.env.CRON_API_KEY = originalKey
    if (originalFlag === undefined) delete process.env.OPPORTUNITY_ENGINE_V1_ENABLED
    else process.env.OPPORTUNITY_ENGINE_V1_ENABLED = originalFlag
    if (originalCompanyEventsFlag === undefined) delete process.env.COMPANY_EVENTS_V1_ENABLED
    else process.env.COMPANY_EVENTS_V1_ENABLED = originalCompanyEventsFlag
    if (originalCompanyStateFlag === undefined) delete process.env.COMPANY_STATE_V1_ENABLED
    else process.env.COMPANY_STATE_V1_ENABLED = originalCompanyStateFlag
    if (originalSignalEpisodesFlag === undefined) delete process.env.SIGNAL_EPISODES_V2_ENABLED
    else process.env.SIGNAL_EPISODES_V2_ENABLED = originalSignalEpisodesFlag
    if (originalCommercialThesisFlag === undefined) delete process.env.COMMERCIAL_THESIS_V1_ENABLED
    else process.env.COMMERCIAL_THESIS_V1_ENABLED = originalCommercialThesisFlag
    if (originalExternalPropensityFlag === undefined) {
      delete process.env.EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED
    } else {
      process.env.EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED =
        originalExternalPropensityFlag
    }
    if (originalAgencyDnaMatchFlag === undefined) {
      delete process.env.AGENCY_DNA_MATCH_V2_ENABLED
    } else {
      process.env.AGENCY_DNA_MATCH_V2_ENABLED = originalAgencyDnaMatchFlag
    }
    if (originalOpportunityScoringV3Flag === undefined) {
      delete process.env.OPPORTUNITY_SCORING_V3_ENABLED
    } else {
      process.env.OPPORTUNITY_SCORING_V3_ENABLED = originalOpportunityScoringV3Flag
    }
  })

  it('fails closed for missing credentials and a disabled engine', async () => {
    expect((await POST(
      request('/api/cron/opportunities/backfill-opportunities'),
      { params: Promise.resolve({ job: 'backfill-opportunities' }) },
    )).status).toBe(401)

    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'false'
    expect((await POST(
      request('/api/cron/opportunities/backfill-opportunities', testKey),
      { params: Promise.resolve({ job: 'backfill-opportunities' }) },
    )).status).toBe(404)
    expect(mockedBackfill).not.toHaveBeenCalled()
  })

  it('protects the read-only job status endpoint with flag and cron key', async () => {
    expect((await GET(
      getRequest('/api/cron/opportunities/build-opportunities'),
      { params: Promise.resolve({ job: 'build-opportunities' }) },
    )).status).toBe(401)

    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'false'
    expect((await GET(
      getRequest('/api/cron/opportunities/build-opportunities', testKey),
      { params: Promise.resolve({ job: 'build-opportunities' }) },
    )).status).toBe(404)
  })

  it('keeps backfill read-only by default and requires apply=true for writes', async () => {
    mockedBackfill.mockResolvedValue({
      detection: {
        enabled: true, dryRun: true, scanned: 0, created: 0,
        updated: 0, skipped: 0, failed: 0, expired: 0,
        continued: 0, reconciled: 0, skippedUnchanged: 0, superseded: 0,
        resumed: 0, resumeLatencyMsTotal: 0, resumeLatencyMsMax: 0,
        locked: 0, skippedBecauseLocked: false,
        scoringV2ShadowEvaluated: 0, scoringV2ShadowSnapshotsCreated: 0,
      },
      opportunities: {
        enabled: true, dryRun: true, scanned: 0, created: 0,
        updated: 0, skipped: 0, failed: 0, expired: 0,
        continued: 0, reconciled: 0, skippedUnchanged: 0, superseded: 0,
        resumed: 0, resumeLatencyMsTotal: 0, resumeLatencyMsMax: 0,
        locked: 0, skippedBecauseLocked: false,
        scoringV2ShadowEvaluated: 0, scoringV2ShadowSnapshotsCreated: 0,
      },
    })

    const dryRun = await POST(
      request('/api/cron/opportunities/backfill-opportunities', testKey),
      { params: Promise.resolve({ job: 'backfill-opportunities' }) },
    )
    expect(dryRun.status).toBe(200)
    expect(mockedBackfill).toHaveBeenLastCalledWith(expect.objectContaining({
      dryRun: true,
    }))

    await POST(
      request('/api/cron/opportunities/backfill-opportunities?apply=true', testKey),
      { params: Promise.resolve({ job: 'backfill-opportunities' }) },
    )
    expect(mockedBackfill).toHaveBeenLastCalledWith(expect.objectContaining({
      dryRun: false,
    }))
  })

  it('rejects invalid canary parameters instead of widening the job scope', async () => {
    const response = await POST(
      request(
        '/api/cron/opportunities/backfill-opportunities?apply=true&organization=all',
        testKey,
      ),
      { params: Promise.resolve({ job: 'backfill-opportunities' }) },
    )

    expect(response.status).toBe(400)
    expect(mockedBackfill).not.toHaveBeenCalled()
  })

  it('keeps Company Events separately fail-closed from the Opportunity Engine', async () => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'true'
    process.env.COMPANY_EVENTS_V1_ENABLED = 'false'

    const disabledCompanyEvents = await POST(
      request('/api/cron/opportunities/normalize-company-events', testKey),
      { params: Promise.resolve({ job: 'normalize-company-events' }) },
    )
    expect(disabledCompanyEvents.status).toBe(404)
    expect(mockedNormalizeCompanyEvents).not.toHaveBeenCalled()

    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'false'
    process.env.COMPANY_EVENTS_V1_ENABLED = 'true'
    const disabledOpportunityEngine = await POST(
      request('/api/cron/opportunities/backfill-opportunities', testKey),
      { params: Promise.resolve({ job: 'backfill-opportunities' }) },
    )
    expect(disabledOpportunityEngine.status).toBe(404)
    expect(mockedBackfill).not.toHaveBeenCalled()
  })

  it('requires apply=true before the Company Events job can persist', async () => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'false'
    process.env.COMPANY_EVENTS_V1_ENABLED = 'true'
    mockedNormalizeCompanyEvents.mockResolvedValue({
      enabled: true,
      dryRun: true,
      scanned: 0,
      normalized: 0,
      rejected: 0,
      persisted: 0,
      publicationsAttached: 0,
      evidenceAttached: 0,
      failed: 0,
    })

    const dryRun = await POST(
      request('/api/cron/opportunities/normalize-company-events', testKey),
      { params: Promise.resolve({ job: 'normalize-company-events' }) },
    )
    expect(dryRun.status).toBe(200)
    expect(mockedNormalizeCompanyEvents).toHaveBeenLastCalledWith(expect.objectContaining({
      dryRun: true,
    }))

    await POST(
      request(
        '/api/cron/opportunities/normalize-company-events?apply=true&organization=10',
        testKey,
      ),
      { params: Promise.resolve({ job: 'normalize-company-events' }) },
    )
    expect(mockedNormalizeCompanyEvents).toHaveBeenLastCalledWith(expect.objectContaining({
      dryRun: false,
    }))
  })

  it('requires one explicit organization for Company Events writes', async () => {
    process.env.COMPANY_EVENTS_V1_ENABLED = 'true'

    const response = await POST(
      request(
        '/api/cron/opportunities/normalize-company-events?apply=true',
        testKey,
      ),
      { params: Promise.resolve({ job: 'normalize-company-events' }) },
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: 'organization_required_for_apply',
    })
    expect(mockedNormalizeCompanyEvents).not.toHaveBeenCalled()
  })

  it('rejects Company Events batches above its smaller safety limit', async () => {
    process.env.COMPANY_EVENTS_V1_ENABLED = 'true'

    const response = await POST(
      request(
        '/api/cron/opportunities/normalize-company-events?batchSize=26',
        testKey,
      ),
      { params: Promise.resolve({ job: 'normalize-company-events' }) },
    )

    expect(response.status).toBe(400)
    expect(mockedNormalizeCompanyEvents).not.toHaveBeenCalled()
  })

  it('keeps Company State separately dark and defaults to dry-run', async () => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'false'
    process.env.COMPANY_EVENTS_V1_ENABLED = 'true'
    process.env.COMPANY_STATE_V1_ENABLED = 'false'

    const disabled = await POST(
      request('/api/cron/opportunities/build-company-state', testKey),
      { params: Promise.resolve({ job: 'build-company-state' }) },
    )
    expect(disabled.status).toBe(404)
    expect(mockedBuildCompanyState).not.toHaveBeenCalled()

    process.env.COMPANY_STATE_V1_ENABLED = 'true'
    mockedBuildCompanyState.mockResolvedValue({
      enabled: true,
      dryRun: true,
      scanned: 0,
      built: 0,
      lowHistory: 0,
      changesDetected: 0,
      snapshotsPersisted: 0,
      changesPersisted: 0,
      rejected: 0,
      failed: 0,
    })
    const dryRun = await POST(
      request('/api/cron/opportunities/build-company-state', testKey),
      { params: Promise.resolve({ job: 'build-company-state' }) },
    )
    expect(dryRun.status).toBe(200)
    expect(mockedBuildCompanyState).toHaveBeenLastCalledWith(
      expect.objectContaining({ dryRun: true }),
    )
  })

  it('requires explicit Company State apply scope and enforces its limit', async () => {
    process.env.COMPANY_STATE_V1_ENABLED = 'true'
    expect((await POST(
      request('/api/cron/opportunities/build-company-state?apply=true', testKey),
      { params: Promise.resolve({ job: 'build-company-state' }) },
    )).status).toBe(400)
    expect((await POST(
      request('/api/cron/opportunities/build-company-state?batchSize=26', testKey),
      { params: Promise.resolve({ job: 'build-company-state' }) },
    )).status).toBe(400)
    expect(mockedBuildCompanyState).not.toHaveBeenCalled()
  })

  it('keeps Signal Episodes separately dark and defaults to dry-run', async () => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'false'
    process.env.COMPANY_STATE_V1_ENABLED = 'true'
    process.env.SIGNAL_EPISODES_V2_ENABLED = 'false'

    expect((await POST(
      request('/api/cron/opportunities/build-signal-episodes', testKey),
      { params: Promise.resolve({ job: 'build-signal-episodes' }) },
    )).status).toBe(404)
    expect(mockedBuildSignalEpisodes).not.toHaveBeenCalled()

    process.env.SIGNAL_EPISODES_V2_ENABLED = 'true'
    mockedBuildSignalEpisodes.mockResolvedValue({
      enabled: true, dryRun: true, scanned: 0, built: 0,
      active: 0, cooling: 0, expired: 0, episodesPersisted: 0,
      replayed: 0, rejected: 0, failed: 0,
    })
    const response = await POST(
      request('/api/cron/opportunities/build-signal-episodes', testKey),
      { params: Promise.resolve({ job: 'build-signal-episodes' }) },
    )
    expect(response.status).toBe(200)
    expect(mockedBuildSignalEpisodes).toHaveBeenLastCalledWith(
      expect.objectContaining({ dryRun: true }),
    )
  })

  it('requires explicit Signal Episodes apply scope and enforces its limit', async () => {
    process.env.SIGNAL_EPISODES_V2_ENABLED = 'true'
    expect((await POST(
      request('/api/cron/opportunities/build-signal-episodes?apply=true', testKey),
      { params: Promise.resolve({ job: 'build-signal-episodes' }) },
    )).status).toBe(400)
    expect((await POST(
      request('/api/cron/opportunities/build-signal-episodes?batchSize=26', testKey),
      { params: Promise.resolve({ job: 'build-signal-episodes' }) },
    )).status).toBe(400)
    expect(mockedBuildSignalEpisodes).not.toHaveBeenCalled()
  })

  it('keeps Commercial Thesis separately dark and defaults to dry-run', async () => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'false'
    process.env.SIGNAL_EPISODES_V2_ENABLED = 'true'
    process.env.COMMERCIAL_THESIS_V1_ENABLED = 'false'

    expect((await POST(
      request('/api/cron/opportunities/build-commercial-theses', testKey),
      { params: Promise.resolve({ job: 'build-commercial-theses' }) },
    )).status).toBe(404)
    expect(mockedBuildCommercialTheses).not.toHaveBeenCalled()

    process.env.COMMERCIAL_THESIS_V1_ENABLED = 'true'
    mockedBuildCommercialTheses.mockResolvedValue({
      enabled: true, dryRun: true, scanned: 0, episodesScanned: 0,
      built: 0, active: 0, cooling: 0, expired: 0,
      thesesPersisted: 0, replayed: 0, rejected: 0, failed: 0,
    })
    const response = await POST(
      request('/api/cron/opportunities/build-commercial-theses', testKey),
      { params: Promise.resolve({ job: 'build-commercial-theses' }) },
    )
    expect(response.status).toBe(200)
    expect(mockedBuildCommercialTheses).toHaveBeenLastCalledWith(
      expect.objectContaining({ dryRun: true }),
    )
  })

  it('requires explicit Commercial Thesis apply scope and enforces its limit', async () => {
    process.env.COMMERCIAL_THESIS_V1_ENABLED = 'true'
    expect((await POST(
      request('/api/cron/opportunities/build-commercial-theses?apply=true', testKey),
      { params: Promise.resolve({ job: 'build-commercial-theses' }) },
    )).status).toBe(400)
    expect((await POST(
      request('/api/cron/opportunities/build-commercial-theses?batchSize=26', testKey),
      { params: Promise.resolve({ job: 'build-commercial-theses' }) },
    )).status).toBe(400)
    expect(mockedBuildCommercialTheses).not.toHaveBeenCalled()
  })

  it('keeps External Agency Propensity separately dark and dry-run by default', async () => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'false'
    process.env.COMMERCIAL_THESIS_V1_ENABLED = 'true'
    process.env.EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED = 'false'

    expect((await POST(
      request('/api/cron/opportunities/build-external-agency-propensity', testKey),
      { params: Promise.resolve({ job: 'build-external-agency-propensity' }) },
    )).status).toBe(404)
    expect(mockedBuildExternalAgencyPropensity).not.toHaveBeenCalled()

    process.env.EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED = 'true'
    mockedBuildExternalAgencyPropensity.mockResolvedValue({
      enabled: true, dryRun: true, scanned: 0, built: 0,
      high: 0, medium: 0, low: 0, insufficientEvidence: 0,
      persisted: 0, replayed: 0, failed: 0,
    })
    const response = await POST(
      request(
        '/api/cron/opportunities/build-external-agency-propensity' +
        '?workspace=20&organization=10',
        testKey,
      ),
      { params: Promise.resolve({ job: 'build-external-agency-propensity' }) },
    )
    expect(response.status).toBe(200)
    expect(mockedBuildExternalAgencyPropensity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workspaceId: '20',
        organizationId: '10',
        dryRun: true,
      }),
    )
  })

  it('requires both External Agency Propensity apply scopes and its tight limit', async () => {
    process.env.EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED = 'true'
    const missingWorkspace = await POST(
      request(
        '/api/cron/opportunities/build-external-agency-propensity' +
        '?apply=true&organization=10',
        testKey,
      ),
      { params: Promise.resolve({ job: 'build-external-agency-propensity' }) },
    )
    expect(missingWorkspace.status).toBe(400)
    expect(await missingWorkspace.json()).toMatchObject({
      error: 'workspace_and_organization_required_for_apply',
    })
    expect((await POST(
      request(
        '/api/cron/opportunities/build-external-agency-propensity' +
        '?apply=true&workspace=20',
        testKey,
      ),
      { params: Promise.resolve({ job: 'build-external-agency-propensity' }) },
    )).status).toBe(400)
    expect((await POST(
      request(
        '/api/cron/opportunities/build-external-agency-propensity?batchSize=26',
        testKey,
      ),
      { params: Promise.resolve({ job: 'build-external-agency-propensity' }) },
    )).status).toBe(400)
    expect(mockedBuildExternalAgencyPropensity).not.toHaveBeenCalled()
  })

  it('keeps Agency DNA Match separately dark and dry-run by default', async () => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'false'
    process.env.EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED = 'true'

    expect((await POST(
      request('/api/cron/opportunities/build-agency-dna-matches', testKey),
      { params: Promise.resolve({ job: 'build-agency-dna-matches' }) },
    )).status).toBe(404)
    expect(mockedBuildAgencyDnaMatch).not.toHaveBeenCalled()

    process.env.AGENCY_DNA_MATCH_V2_ENABLED = 'true'
    mockedBuildAgencyDnaMatch.mockResolvedValue({
      enabled: true, dryRun: true, scanned: 0, built: 0,
      strong: 0, supported: 0, weak: 0, insufficientEvidence: 0, blocked: 0,
      persisted: 0, replayed: 0, failed: 0,
    })
    const response = await POST(
      request(
        '/api/cron/opportunities/build-agency-dna-matches' +
        '?workspace=20&organization=10',
        testKey,
      ),
      { params: Promise.resolve({ job: 'build-agency-dna-matches' }) },
    )
    expect(response.status).toBe(200)
    expect(mockedBuildAgencyDnaMatch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workspaceId: '20',
        organizationId: '10',
        dryRun: true,
      }),
    )
  })

  it('requires both Agency DNA Match apply scopes and its tight limit', async () => {
    process.env.AGENCY_DNA_MATCH_V2_ENABLED = 'true'
    for (const path of [
      '/api/cron/opportunities/build-agency-dna-matches?apply=true&organization=10',
      '/api/cron/opportunities/build-agency-dna-matches?apply=true&workspace=20',
      '/api/cron/opportunities/build-agency-dna-matches?batchSize=26',
    ]) {
      expect((await POST(
        request(path, testKey),
        { params: Promise.resolve({ job: 'build-agency-dna-matches' }) },
      )).status).toBe(400)
    }
    expect(mockedBuildAgencyDnaMatch).not.toHaveBeenCalled()
  })

  it('keeps Opportunity Scoring v3 separately dark and dry-run by default', async () => {
    expect((await POST(
      request('/api/cron/opportunities/build-opportunity-candidates-v3', testKey),
      { params: Promise.resolve({ job: 'build-opportunity-candidates-v3' }) },
    )).status).toBe(404)
    expect(mockedBuildOpportunityScoringV3).not.toHaveBeenCalled()

    process.env.OPPORTUNITY_SCORING_V3_ENABLED = 'true'
    mockedBuildOpportunityScoringV3.mockResolvedValue({
      enabled: true, dryRun: true, rolloutMode: 'shadow', scanned: 0, built: 0,
      qualifiedActionable: 0, qualifiedNeedsEnrichment: 0, review: 0,
      blocked: 0, expired: 0, dismissed: 0, persisted: 0, replayed: 0,
      failed: 0,
    })
    const response = await POST(
      request(
        '/api/cron/opportunities/build-opportunity-candidates-v3' +
        '?workspace=20&organization=10',
        testKey,
      ),
      { params: Promise.resolve({ job: 'build-opportunity-candidates-v3' }) },
    )
    expect(response.status).toBe(200)
    expect(mockedBuildOpportunityScoringV3).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: '20', organizationId: '10', dryRun: true,
      }),
    )
  })

  it('requires both Scoring v3 apply scopes and its tight limit', async () => {
    process.env.OPPORTUNITY_SCORING_V3_ENABLED = 'true'
    for (const path of [
      '/api/cron/opportunities/build-opportunity-candidates-v3?apply=true&organization=10',
      '/api/cron/opportunities/build-opportunity-candidates-v3?apply=true&workspace=20',
      '/api/cron/opportunities/build-opportunity-candidates-v3?batchSize=26',
    ]) {
      expect((await POST(
        request(path, testKey),
        { params: Promise.resolve({ job: 'build-opportunity-candidates-v3' }) },
      )).status).toBe(400)
    }
    expect(mockedBuildOpportunityScoringV3).not.toHaveBeenCalled()
  })
})
