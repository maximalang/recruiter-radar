jest.mock('@/lib/auth-v2/authorization', () => ({
  getAuthorizedOwnerId: jest.fn(),
}))
jest.mock('@/lib/clientProfiles', () => ({
  getClientProfileByOwnerId: jest.fn(),
}))
jest.mock('@/lib/webPush', () => ({
  saveSubscription: jest.fn(),
  revokeSubscription: jest.fn(),
}))

import { POST as subscribePost } from '@/app/api/push/subscribe/route'
import { POST as unsubscribePost } from '@/app/api/push/unsubscribe/route'
import { getAuthorizedOwnerId } from '@/lib/auth-v2/authorization'
import { getClientProfileByOwnerId } from '@/lib/clientProfiles'
import { revokeSubscription, saveSubscription } from '@/lib/webPush'

const mockOwnerId = jest.mocked(getAuthorizedOwnerId)
const mockProfile = jest.mocked(getClientProfileByOwnerId)
const mockSave = jest.mocked(saveSubscription)
const mockRevoke = jest.mocked(revokeSubscription)

const subscription = {
  endpoint: 'https://push.example.com/sub/1',
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
}

function jsonRequest(body: unknown, raw?: string): Request {
  return new Request('http://localhost/api/push/subscription-endpoints', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockOwnerId.mockResolvedValue('10')
  mockProfile.mockResolvedValue({ id: 'cp-1' } as never)
  mockSave.mockResolvedValue({ ok: true })
  mockRevoke.mockResolvedValue({ ok: true })
})

describe('POST /api/push/subscribe', () => {
  it('requires an authenticated owner', async () => {
    mockOwnerId.mockResolvedValue(null)

    const response = await subscribePost(jsonRequest({ subscription }))

    expect(response.status).toBe(401)
    expect(mockOwnerId).toHaveBeenCalledWith('notifications:write')
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('returns 404 when the owner has no client profile', async () => {
    mockProfile.mockResolvedValue(null)

    const response = await subscribePost(jsonRequest({ subscription }))

    expect(response.status).toBe(404)
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('rejects a malformed JSON body with 400', async () => {
    const response = await subscribePost(jsonRequest(null, 'not-json'))

    expect(response.status).toBe(400)
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('rejects an invalid push subscription with 400', async () => {
    const noKeys = await subscribePost(
      jsonRequest({ subscription: { endpoint: 'https://push.example.com/1' } }),
    )
    expect(noKeys.status).toBe(400)

    const noEndpoint = await subscribePost(
      jsonRequest({ subscription: { keys: { p256dh: 'a', auth: 'b' } } }),
    )
    expect(noEndpoint.status).toBe(400)

    expect(mockSave).not.toHaveBeenCalled()
  })

  it('stores the subscription against the session-owner profile', async () => {
    const response = await subscribePost(jsonRequest({ subscription }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(mockSave).toHaveBeenCalledWith({ clientProfileId: 'cp-1', subscription })
  })

  it('accepts the bare subscription object form (toJSON payload)', async () => {
    const response = await subscribePost(jsonRequest(subscription))

    expect(response.status).toBe(200)
    expect(mockSave).toHaveBeenCalledWith({ clientProfileId: 'cp-1', subscription })
  })

  it('propagates storage failure as 500 with the error message', async () => {
    mockSave.mockResolvedValue({ ok: false, error: 'subscription storage failed' })

    const response = await subscribePost(jsonRequest({ subscription }))

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'subscription storage failed' })
  })
})

describe('POST /api/push/unsubscribe', () => {
  it('requires an authenticated owner', async () => {
    mockOwnerId.mockResolvedValue(null)

    const response = await unsubscribePost(jsonRequest({ endpoint: subscription.endpoint }))

    expect(response.status).toBe(401)
    expect(mockRevoke).not.toHaveBeenCalled()
  })

  it('returns 404 when the owner has no client profile', async () => {
    mockProfile.mockResolvedValue(null)

    const response = await unsubscribePost(jsonRequest({ endpoint: subscription.endpoint }))

    expect(response.status).toBe(404)
    expect(mockRevoke).not.toHaveBeenCalled()
  })

  it('rejects a malformed JSON body with 400', async () => {
    const response = await unsubscribePost(jsonRequest(null, 'not-json'))

    expect(response.status).toBe(400)
    expect(mockRevoke).not.toHaveBeenCalled()
  })

  it('requires a non-empty endpoint', async () => {
    const response = await unsubscribePost(jsonRequest({ endpoint: '  ' }))

    expect(response.status).toBe(400)
    expect(mockRevoke).not.toHaveBeenCalled()
  })

  it('revokes only within the session-owner profile (anti-IDOR)', async () => {
    const response = await unsubscribePost(
      jsonRequest({ endpoint: subscription.endpoint, clientProfileId: 'someone-else' }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(mockRevoke).toHaveBeenCalledWith({
      clientProfileId: 'cp-1',
      endpoint: subscription.endpoint,
    })
  })

  it('propagates revocation failure as 500', async () => {
    mockRevoke.mockResolvedValue({ ok: false, error: 'revoke failed' })

    const response = await unsubscribePost(jsonRequest({ endpoint: subscription.endpoint }))

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'revoke failed' })
  })
})
