/** @jest-environment node */

import { NextRequest } from 'next/server'

jest.mock('@/lib/opportunities/authorization', () => ({
  getOpportunityAuthorizationContext: jest.fn(),
  getOpportunityDataAccessContext: jest.fn(),
}))
jest.mock('@/lib/opportunities/repository', () => ({
  listOpportunities: jest.fn(),
}))
jest.mock('@/lib/opportunities/opportunity-export', () => ({
  opportunitiesToCsv: jest.fn(() => 'csv-body'),
  opportunitiesToXlsx: jest.fn(() => new Uint8Array([80, 75, 3, 4])),
  toOpportunityExportRecord: jest.fn((value) => value),
}))

import { GET } from '@/app/api/opportunities/export/route'
import {
  getOpportunityAuthorizationContext,
  getOpportunityDataAccessContext,
} from '@/lib/opportunities/authorization'
import { opportunitiesToXlsx } from '@/lib/opportunities/opportunity-export'
import { listOpportunities } from '@/lib/opportunities/repository'

const mockedAuthorization = jest.mocked(getOpportunityAuthorizationContext)
const mockedAccess = jest.mocked(getOpportunityDataAccessContext)
const mockedList = jest.mocked(listOpportunities)

describe('opportunity export route', () => {
  const previous = {
    engine: process.env.OPPORTUNITY_ENGINE_V1_ENABLED,
    outcomes: process.env.OPPORTUNITY_OUTCOMES_ENABLED,
    workspace: process.env.OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED,
    bridge: process.env.OPPORTUNITY_CRM_BRIDGE_ENABLED,
  }

  beforeEach(() => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'true'
    process.env.OPPORTUNITY_OUTCOMES_ENABLED = 'true'
    process.env.OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED = 'true'
    process.env.OPPORTUNITY_CRM_BRIDGE_ENABLED = 'true'
    jest.clearAllMocks()
    mockedAuthorization.mockResolvedValue({
      dataOwnerId: '7',
      workspaceId: '9',
      actorUserId: '42',
      actorRole: 'recruiter',
      permissions: ['exports:create'],
      authMode: 'auth_v2',
    })
    mockedAccess.mockReturnValue({
      ownerId: '7',
      workspaceId: '9',
      actorUserId: '42',
      actorWorkspaceId: '9',
      actorRoleSnapshot: 'recruiter',
      authMode: 'auth_v2',
    })
    mockedList.mockResolvedValue({
      opportunities: [{ publicReference: 'public-ref' }],
      total: 1,
      page: 1,
      pageSize: 100,
      nextOffset: null,
    } as never)
  })

  afterAll(() => {
    restore('OPPORTUNITY_ENGINE_V1_ENABLED', previous.engine)
    restore('OPPORTUNITY_OUTCOMES_ENABLED', previous.outcomes)
    restore('OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED', previous.workspace)
    restore('OPPORTUNITY_CRM_BRIDGE_ENABLED', previous.bridge)
  })

  it('remains undiscoverable while the bridge flag is disabled', async () => {
    process.env.OPPORTUNITY_CRM_BRIDGE_ENABLED = 'false'
    const response = await GET(request('csv'))

    expect(response.status).toBe(404)
    expect(mockedList).not.toHaveBeenCalled()
  })

  it('exports only the authenticated workspace as XLSX', async () => {
    const response = await GET(request('xlsx'))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(mockedAuthorization).toHaveBeenCalledWith('exports:create')
    expect(mockedList).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: '7',
      workspaceId: '9',
      pageSize: 100,
    }))
    expect(opportunitiesToXlsx).toHaveBeenCalledTimes(1)
  })

  it('rejects unknown formats without querying opportunities', async () => {
    const response = await GET(request('pdf'))
    expect(response.status).toBe(400)
    expect(mockedList).not.toHaveBeenCalled()
  })
})

function request(format: string) {
  return new NextRequest(
    `https://recruiter-radar.ru/api/opportunities/export?format=${format}`,
  )
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
