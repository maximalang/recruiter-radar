import type { PoolClient } from 'pg'
import { createHash } from 'node:crypto'

jest.mock('@/lib/opportunities/outcome-repository', () => ({
  recordOpportunityOutcomeInTransaction: jest.fn(),
  OutcomeChronologyConflictError: class OutcomeChronologyConflictError extends Error {},
  OutcomeIdempotencyConflictError: class OutcomeIdempotencyConflictError extends Error {},
  OutcomeSupersededConflictError: class OutcomeSupersededConflictError extends Error {},
  OutcomeTransitionConflictError: class OutcomeTransitionConflictError extends Error {},
}))

import {
  CrmCallbackAuthenticationError,
  CrmCallbackReplayConflictError,
  ingestCrmOutcomeCallback,
} from '@/lib/opportunities/crm-callback-repository'
import { createCrmWebhookSignature } from '@/lib/opportunities/crm-webhook'
import { recordOpportunityOutcomeInTransaction } from '@/lib/opportunities/outcome-repository'

type QueryResult = { rows: unknown[]; rowCount?: number }

function clientWithResults(results: QueryResult[]) {
  const query = jest.fn(async (_sql: string, _params?: unknown[]) =>
    results.shift() ?? { rows: [], rowCount: 0 })
  return {
    client: { query, release: jest.fn() } as unknown as PoolClient,
    query,
  }
}

describe('tenant CRM callback repository', () => {
  const integrationReference = 'b6e8c6c1-e8af-40a4-9120-3ac67fe8d17c'
  const credentialReference = '49c9fae8-d1ed-463f-854c-8965a8cf331d'
  const opportunityReference = '723d4eef-2da8-4428-ad2d-4cb87fc48bd1'
  const credentialSecretHash = 'a'.repeat(64)
  const now = new Date('2026-08-01T12:00:00.000Z')
  const timestamp = String(Math.floor(now.getTime() / 1_000))
  const eventId = 'amo-12345'
  const rawBody = JSON.stringify({
    opportunityReference,
    eventType: 'won',
    occurredAt: '2026-08-01T11:59:00.000Z',
    valueMinor: 500000,
    currency: 'RUB',
  })

  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(recordOpportunityOutcomeInTransaction).mockResolvedValue({
      event: { id: '81', eventType: 'won' },
      state: { currentStage: 'won' },
      idempotent: false,
    } as never)
  })

  it('authenticates the tenant credential and writes through the Outcome Ledger', async () => {
    const { client, query } = clientWithResults([
      { rows: [] },
      { rows: [{
        workspaceId: '9', integrationId: '17', credentialId: '21',
        credentialSecretHash, allowedEventTypes: ['won', 'lost'],
        rateLimitMaxRequests: 60, rateLimitWindowSeconds: 60,
        replayWindowSeconds: 300,
      }] },
      { rows: [] },
      { rows: [{ requestCount: '0' }] },
      { rows: [{ opportunityId: '31', ownerId: '7' }] },
      { rows: [], rowCount: 1 },
      { rows: [] },
    ])

    const result = await ingestCrmOutcomeCallback(signedInput(), async () => client, now)

    expect(result).toEqual({
      status: 200, code: 'accepted', accepted: true, idempotent: false,
    })
    const expectedIdempotencyKey = `crm:${createHash('sha256')
      .update(credentialReference)
      .update('\0')
      .update(eventId)
      .digest('hex')}`
    expect(recordOpportunityOutcomeInTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: '7', workspaceId: '9', opportunityId: '31',
        actorType: 'external',
        externalSystem: `crm:${integrationReference}`,
        externalEventId: eventId,
        payload: expect.objectContaining({
          eventType: 'won', valueMinor: 500000, currency: 'RUB',
          metadata: { source: 'crm_callback' },
          idempotencyKey: expectedIdempotencyKey,
        }),
      }),
      client,
    )
    const receipt = query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO opportunity_crm_callback_receipts'))
    expect(receipt).toBeDefined()
    expect(receipt?.[1]).not.toContain(credentialSecretHash)
    expect(query).toHaveBeenLastCalledWith('COMMIT')
  })

  it('rejects a changed body for the same credential event id', async () => {
    const { client, query } = clientWithResults([
      { rows: [] },
      { rows: [{
        workspaceId: '9', integrationId: '17', credentialId: '21',
        credentialSecretHash, allowedEventTypes: ['won'],
        rateLimitMaxRequests: 60, rateLimitWindowSeconds: 60,
        replayWindowSeconds: 300,
      }] },
      { rows: [{
        requestHash: 'b'.repeat(64), responseStatus: 200,
        responseCode: 'accepted',
      }] },
      { rows: [] },
    ])

    await expect(ingestCrmOutcomeCallback(
      signedInput(), async () => client, now,
    )).rejects.toBeInstanceOf(CrmCallbackReplayConflictError)
    expect(recordOpportunityOutcomeInTransaction).not.toHaveBeenCalled()
    expect(query).toHaveBeenLastCalledWith('ROLLBACK')
  })

  it('fails closed for a revoked or cross-integration credential', async () => {
    const { client, query } = clientWithResults([
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ])

    await expect(ingestCrmOutcomeCallback(
      signedInput(), async () => client, now,
    )).rejects.toBeInstanceOf(CrmCallbackAuthenticationError)
    expect(recordOpportunityOutcomeInTransaction).not.toHaveBeenCalled()
    expect(query).toHaveBeenLastCalledWith('ROLLBACK')
  })

  it('durably rejects a signed request above the credential rate policy', async () => {
    const { client, query } = clientWithResults([
      { rows: [] },
      { rows: [{
        workspaceId: '9', integrationId: '17', credentialId: '21',
        credentialSecretHash, allowedEventTypes: ['won'],
        rateLimitMaxRequests: 1, rateLimitWindowSeconds: 60,
        replayWindowSeconds: 300,
      }] },
      { rows: [] },
      { rows: [{ requestCount: '1' }] },
      { rows: [], rowCount: 1 },
      { rows: [] },
    ])

    await expect(ingestCrmOutcomeCallback(
      signedInput(), async () => client, now,
    )).resolves.toEqual({
      status: 429, code: 'rate_limited', accepted: false, idempotent: false,
    })
    expect(recordOpportunityOutcomeInTransaction).not.toHaveBeenCalled()
    const receipt = query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO opportunity_crm_callback_receipts'))
    expect(receipt?.[1]).toContain('rate_limited')
    expect(query).toHaveBeenLastCalledWith('COMMIT')
  })

  function signedInput() {
    return {
      integrationReference,
      credentialReference,
      timestamp,
      eventId,
      rawBody,
      signature: createCrmWebhookSignature({
        credentialSecretHash, timestamp, eventId, body: rawBody,
      }),
    }
  }
})
