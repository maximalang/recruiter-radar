/** @jest-environment node */

import { NextRequest } from 'next/server'

jest.mock('@/lib/opportunities/authorization', () => ({
  getOpportunityAuthorizationContext: jest.fn(),
  getOpportunityDataAccessContext: jest.fn(),
}))
jest.mock('@/lib/opportunities/outcome-calibration-export', () => ({
  OutcomeCalibrationExportLimitError: class extends Error {},
  getOutcomeCalibrationDataset: jest.fn(),
  outcomeCalibrationToCsv: jest.fn(() => '\uFEFFcsv'),
}))

import { GET } from '@/app/api/opportunities/outcomes/calibration-export/route'
import {
  getOpportunityAuthorizationContext,
  getOpportunityDataAccessContext,
} from '@/lib/opportunities/authorization'
import { getOutcomeCalibrationDataset } from '@/lib/opportunities/outcome-calibration-export'

const mockedAuthorization = jest.mocked(getOpportunityAuthorizationContext)
const mockedAccess = jest.mocked(getOpportunityDataAccessContext)
const mockedDataset = jest.mocked(getOutcomeCalibrationDataset)

describe('Outcome calibration export route', () => {
  const previous = {
    engine: process.env.OPPORTUNITY_ENGINE_V1_ENABLED,
    outcomes: process.env.OPPORTUNITY_OUTCOMES_ENABLED,
    workspace: process.env.OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED,
    analytics: process.env.OPPORTUNITY_ANALYTICS_V2_ENABLED,
  }

  beforeEach(() => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'true'
    process.env.OPPORTUNITY_OUTCOMES_ENABLED = 'true'
    process.env.OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED = 'true'
    process.env.OPPORTUNITY_ANALYTICS_V2_ENABLED = 'true'
    jest.clearAllMocks()
    mockedAuthorization.mockResolvedValue({
      dataOwnerId: '7', workspaceId: '9', actorUserId: '42',
      actorRole: 'recruiter', permissions: ['exports:create'],
      authMode: 'auth_v2',
    })
    mockedAccess.mockReturnValue({
      ownerId: '7', workspaceId: '9', actorUserId: '42',
      actorWorkspaceId: '9', actorRoleSnapshot: 'recruiter',
      authMode: 'auth_v2',
    })
    mockedDataset.mockResolvedValue([])
  })

  afterAll(() => {
    restore('OPPORTUNITY_ENGINE_V1_ENABLED', previous.engine)
    restore('OPPORTUNITY_OUTCOMES_ENABLED', previous.outcomes)
    restore('OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED', previous.workspace)
    restore('OPPORTUNITY_ANALYTICS_V2_ENABLED', previous.analytics)
  })

  it('exports a validated cohort only with export permission and no caching', async () => {
    const response = await GET(request(
      '?from=2026-07-01T00:00:00.000Z&to=2026-08-01T00:00:00.000Z' +
      '&cohort=contacted&channel=email',
    ))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mockedAuthorization).toHaveBeenCalledWith('exports:create')
    expect(mockedDataset).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: '7', workspaceId: '9', cohort: 'contacted', channel: 'email',
    }))
  })

  it('remains dark and rejects biased filters without exporting', async () => {
    const biased = await GET(request('?cohort=shown&contactPathType=website_form'))
    expect(biased.status).toBe(400)

    process.env.OPPORTUNITY_ANALYTICS_V2_ENABLED = 'false'
    expect((await GET(request(''))).status).toBe(404)
    expect(mockedDataset).not.toHaveBeenCalled()
  })
})

function request(search: string) {
  return new NextRequest(
    `https://recruiter-radar.ru/api/opportunities/outcomes/calibration-export${search}`,
  )
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
