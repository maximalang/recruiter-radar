import type { PoolClient } from 'pg'

import {
  deliverOpportunityToCrm,
  type CrmOutboundSender,
} from '@/lib/opportunities/crm-delivery-repository'

type QueryResult = { rows: unknown[]; rowCount?: number }

function clientWithResults(results: QueryResult[]) {
  const query = jest.fn(async (_sql: string, _params?: unknown[]) =>
    results.shift() ?? { rows: [], rowCount: 0 })
  return {
    client: { query, release: jest.fn() } as unknown as PoolClient,
    query,
  }
}

describe('CRM outbound delivery repository', () => {
  const row = {
    integrationId: '17',
    credentialId: '21',
    integrationReference: 'b6e8c6c1-e8af-40a4-9120-3ac67fe8d17c',
    outboundWebhookUrl: 'https://hooks.example.test/opportunity',
    credentialReference: '49c9fae8-d1ed-463f-854c-8965a8cf331d',
    credentialSecretHash: 'a'.repeat(64),
    opportunityReference: '723d4eef-2da8-4428-ad2d-4cb87fc48bd1',
    organizationName: 'Example',
    organizationDomain: 'example.test',
    title: 'Hiring spike',
    commercialStage: 'accepted',
    workflowState: 'active',
    whyNow: 'New vacancies',
    problemHypothesis: 'Needs recruiting capacity',
    recommendedAngle: 'Offer delivery team',
    recommendedPersona: 'Head of HR',
    recommendedAction: 'Review company form',
    opportunityScore: 0.86,
    confidenceGate: 'A',
    validUntil: '2026-08-20T00:00:00.000Z',
    nextActionType: 'contact',
    nextActionDueAt: '2026-08-02T09:00:00.000Z',
    workflowPriority: 'high',
    evidenceUrls: ['https://example.test/careers'],
  }

  it('serializes only public opportunity data, signs once and appends an audit row', async () => {
    const { client, query } = clientWithResults([
      { rows: [] },
      { rows: [{ role: 'recruiter' }] },
      { rows: [] },
      { rows: [row] },
      { rows: [{
        ownsClaim: true,
        requestBody: JSON.stringify({ opportunityReference: row.opportunityReference }),
        requestHash: 'b'.repeat(64),
        requestTimestamp: '1785585600',
      }] },
      { rows: [] },
      { rows: [] },
      { rows: [{
        ownsClaim: true,
        requestBody: JSON.stringify({ opportunityReference: row.opportunityReference }),
        requestHash: 'b'.repeat(64),
        requestTimestamp: '1785585600',
      }] },
      { rows: [{ status: 'succeeded', httpStatus: 202 }], rowCount: 1 },
      { rows: [], rowCount: 1 },
      { rows: [] },
    ])
    const sender = jest.fn<ReturnType<CrmOutboundSender>, Parameters<CrmOutboundSender>>(
      async () => ({ status: 'succeeded', httpStatus: 202 }),
    )

    const result = await deliverOpportunityToCrm({
      ownerId: '7', workspaceId: '9', opportunityId: '31',
      actorUserId: '42',
      integrationReference: row.integrationReference,
      idempotencyKey: 'crm-send-1',
    }, sender, async () => client)

    expect(result).toEqual(expect.objectContaining({
      status: 'succeeded', httpStatus: 202, idempotent: false,
      eventId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }))
    const delivery = sender.mock.calls[0]?.[0]
    expect(delivery?.body).toContain(row.opportunityReference)
    expect(delivery?.body).not.toContain('"workspaceId"')
    expect(delivery?.body).not.toContain('"ownerId"')
    expect(delivery?.body).not.toContain(row.credentialSecretHash)
    expect(delivery?.credentialSecretHash).toBe(row.credentialSecretHash)
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO opportunity_crm_deliveries'))).toBe(true)
    expect(query).toHaveBeenLastCalledWith('COMMIT')
  })

  it('replays a completed event without another outbound request', async () => {
    const { client } = clientWithResults([
      { rows: [] },
      { rows: [{ role: 'recruiter' }] },
      { rows: [{ status: 'succeeded', httpStatus: 200 }] },
      { rows: [] },
    ])
    const sender = jest.fn<ReturnType<CrmOutboundSender>, Parameters<CrmOutboundSender>>()

    const result = await deliverOpportunityToCrm({
      ownerId: '7', workspaceId: '9', opportunityId: '31',
      actorUserId: '42',
      integrationReference: row.integrationReference,
      idempotencyKey: 'crm-send-1',
    }, sender, async () => client)

    expect(result).toEqual(expect.objectContaining({
      status: 'succeeded', httpStatus: 200, idempotent: true,
    }))
    expect(sender).not.toHaveBeenCalled()
  })

  it('releases the preparation transaction before outbound network I/O', async () => {
    const prepared = clientWithResults([
      { rows: [] },
      { rows: [{ role: 'recruiter' }] },
      { rows: [] },
      { rows: [row] },
      { rows: [{
        ownsClaim: true,
        requestBody: JSON.stringify({ opportunityReference: row.opportunityReference }),
        requestHash: 'b'.repeat(64),
        requestTimestamp: '1785585600',
      }] },
      { rows: [] },
    ])
    const finalized = clientWithResults([
      { rows: [] },
      { rows: [{ ownsClaim: true }] },
      { rows: [{ status: 'succeeded', httpStatus: 202 }], rowCount: 1 },
      { rows: [], rowCount: 1 },
      { rows: [] },
    ])
    const provideClient = jest.fn()
      .mockResolvedValueOnce(prepared.client)
      .mockResolvedValueOnce(finalized.client)
    const sender = jest.fn<ReturnType<CrmOutboundSender>, Parameters<CrmOutboundSender>>(
      async () => {
        expect(prepared.client.release).toHaveBeenCalledTimes(1)
        expect(provideClient).toHaveBeenCalledTimes(1)
        return { status: 'succeeded', httpStatus: 202 }
      },
    )

    const result = await deliverOpportunityToCrm({
      ownerId: '7', workspaceId: '9', opportunityId: '31',
      actorUserId: '42',
      integrationReference: row.integrationReference,
      idempotencyKey: 'crm-send-outside-transaction',
    }, sender, provideClient)

    expect(result).toEqual(expect.objectContaining({
      status: 'succeeded', idempotent: false,
    }))
    expect(finalized.client.release).toHaveBeenCalledTimes(1)
  })
})
