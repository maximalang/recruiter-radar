import type { PoolClient } from 'pg'

import {
  CrmIntegrationAccessError,
  createCrmIntegration,
  revokeCrmCredential,
  rotateCrmCredential,
} from '@/lib/opportunities/crm-integration-repository'

type QueryResult = { rows: unknown[]; rowCount?: number }

function clientWithResults(results: QueryResult[]) {
  const query = jest.fn(async (_sql: string, _params?: unknown[]) =>
    results.shift() ?? { rows: [], rowCount: 0 })
  return {
    client: { query, release: jest.fn() } as unknown as PoolClient,
    query,
  }
}

describe('CRM integration repository', () => {
  it('creates a workspace-owned integration and stores only the secret hash', async () => {
    const { client, query } = clientWithResults([
      { rows: [] },
      { rows: [{ role: 'admin' }] },
      { rows: [{
        id: '17',
        reference: 'b6e8c6c1-e8af-40a4-9120-3ac67fe8d17c',
        createdAt: '2026-08-01T12:00:00.000Z',
      }] },
      { rows: [{
        reference: '49c9fae8-d1ed-463f-854c-8965a8cf331d',
        createdAt: '2026-08-01T12:00:00.000Z',
      }] },
      { rows: [] },
    ])

    const result = await createCrmIntegration({
      workspaceId: '9',
      actorUserId: '42',
      integration: {
        provider: 'n8n',
        displayName: 'Revenue workflow',
        outboundWebhookUrl: 'https://hooks.example.test/opportunity',
        allowedEventTypes: ['contacted', 'won'],
        rateLimitMaxRequests: 20,
        rateLimitWindowSeconds: 60,
        replayWindowSeconds: 180,
      },
    }, async () => client)

    expect(result.integration.reference).toBe('b6e8c6c1-e8af-40a4-9120-3ac67fe8d17c')
    expect(result.credential.secret).toMatch(/^rrc_[A-Za-z0-9_-]{43}$/)
    const credentialInsert = query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO opportunity_crm_credentials'))
    expect(credentialInsert).toBeDefined()
    expect(credentialInsert?.[1]).not.toContain(result.credential.secret)
    expect(credentialInsert?.[1]?.[3]).toMatch(/^[a-f0-9]{64}$/)
    expect(query).toHaveBeenLastCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalled()
  })

  it('rejects a stale role snapshot by rechecking active owner/admin membership', async () => {
    const { client, query } = clientWithResults([
      { rows: [] },
      { rows: [{ role: 'recruiter' }] },
      { rows: [] },
    ])

    await expect(createCrmIntegration({
      workspaceId: '9',
      actorUserId: '42',
      integration: {
        provider: 'generic',
        displayName: 'CRM',
        outboundWebhookUrl: null,
        allowedEventTypes: ['won'],
        rateLimitMaxRequests: 60,
        rateLimitWindowSeconds: 60,
        replayWindowSeconds: 300,
      },
    }, async () => client)).rejects.toBeInstanceOf(CrmIntegrationAccessError)

    expect(query).toHaveBeenLastCalledWith('ROLLBACK')
  })

  it('rotates one active credential atomically and returns a new one-time secret', async () => {
    const { client, query } = clientWithResults([
      { rows: [] },
      { rows: [{ role: 'owner' }] },
      { rows: [{
        id: '17',
        provider: 'amocrm',
        displayName: 'amoCRM',
        outboundWebhookUrl: null,
        integrationCreatedAt: '2026-08-01T12:00:00.000Z',
        credentialId: '21',
        allowedEventTypes: ['won', 'lost'],
        rateLimitMaxRequests: 60,
        rateLimitWindowSeconds: 60,
        replayWindowSeconds: 300,
      }] },
      { rows: [], rowCount: 1 },
      { rows: [{
        reference: '91cfaf3e-88e7-4cc1-83a0-f4b2ab38d793',
        createdAt: '2026-08-01T12:01:00.000Z',
      }] },
      { rows: [] },
    ])

    const result = await rotateCrmCredential({
      workspaceId: '9',
      actorUserId: '42',
      integrationReference: 'b6e8c6c1-e8af-40a4-9120-3ac67fe8d17c',
    }, async () => client)

    expect(result?.credential.reference).toBe('91cfaf3e-88e7-4cc1-83a0-f4b2ab38d793')
    expect(result?.credential.secret).toMatch(/^rrc_/)
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes("SET status = 'rotated'"))).toBe(true)
    expect(query).toHaveBeenLastCalledWith('COMMIT')
  })

  it('revokes only the exact active credential in the same integration and workspace', async () => {
    const { client, query } = clientWithResults([
      { rows: [] },
      { rows: [{ role: 'admin' }] },
      { rows: [{ reference: '49c9fae8-d1ed-463f-854c-8965a8cf331d' }], rowCount: 1 },
      { rows: [] },
    ])

    await expect(revokeCrmCredential({
      workspaceId: '9',
      actorUserId: '42',
      integrationReference: 'b6e8c6c1-e8af-40a4-9120-3ac67fe8d17c',
      credentialReference: '49c9fae8-d1ed-463f-854c-8965a8cf331d',
    }, async () => client)).resolves.toBe(true)

    const revoke = query.mock.calls.find(([sql]) =>
      String(sql).includes("SET status = 'revoked'"))
    expect(revoke?.[1]).toEqual([
      '9',
      'b6e8c6c1-e8af-40a4-9120-3ac67fe8d17c',
      '49c9fae8-d1ed-463f-854c-8965a8cf331d',
    ])
  })
})
