/** @jest-environment node */

import { NextRequest } from 'next/server'

jest.mock('@/lib/opportunities/outcome-repository', () => ({
  recordOpportunityOutcome: jest.fn(),
  resolveOpportunityPublicReference: jest.fn(),
}))

import { POST } from '@/app/api/opportunities/outcomes/external/route'
import {
  recordOpportunityOutcome,
  resolveOpportunityPublicReference,
} from '@/lib/opportunities/outcome-repository'

describe('external opportunity outcome route', () => {
  const originalLedger = process.env.OPPORTUNITY_OUTCOMES_ENABLED
  const originalExternal =
    process.env.OPPORTUNITY_OUTCOMES_EXTERNAL_INGEST_ENABLED

  afterAll(() => {
    restore('OPPORTUNITY_OUTCOMES_ENABLED', originalLedger)
    restore('OPPORTUNITY_OUTCOMES_EXTERNAL_INGEST_ENABLED', originalExternal)
  })

  it('remains unavailable even when the legacy global-secret flag is set', async () => {
    process.env.OPPORTUNITY_OUTCOMES_ENABLED = 'true'
    process.env.OPPORTUNITY_OUTCOMES_EXTERNAL_INGEST_ENABLED = 'true'

    const response = await POST(new NextRequest(
      'https://recruiter-radar.ru/api/opportunities/outcomes/external',
      {
        method: 'POST',
        body: JSON.stringify({
          opportunityRef: '00000000-0000-4000-8000-000000000000',
          externalSystem: 'legacy-global-secret',
          eventType: 'replied',
        }),
      },
    ))

    expect(response.status).toBe(404)
    expect(resolveOpportunityPublicReference).not.toHaveBeenCalled()
    expect(recordOpportunityOutcome).not.toHaveBeenCalled()
  })
})

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
