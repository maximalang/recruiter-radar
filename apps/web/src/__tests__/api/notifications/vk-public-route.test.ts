jest.mock('@/lib/notifications', () => ({
  getNotificationAccountByPublicId: jest.fn(),
  decryptVkAccountCredentials: jest.fn(),
  recordNotificationInboundEvent: jest.fn(),
  bindNotificationEndpoint: jest.fn(),
}))
jest.mock('@/lib/notification-secrets', () => ({
  timingSafeTextEqual: jest.fn((a: string, b: string) => a === b),
}))
jest.mock('@/lib/notification-providers', () => ({
  sendVkNotification: jest.fn(),
}))

import { POST } from '@/app/api/notifications/vk/[publicId]/route'
import {
  bindNotificationEndpoint,
  decryptVkAccountCredentials,
  getNotificationAccountByPublicId,
  recordNotificationInboundEvent,
} from '@/lib/notifications'
import { sendVkNotification } from '@/lib/notification-providers'

const mockGetAccount = jest.mocked(getNotificationAccountByPublicId)
const mockDecrypt = jest.mocked(decryptVkAccountCredentials)
const mockRecordInbound = jest.mocked(recordNotificationInboundEvent)
const mockBind = jest.mocked(bindNotificationEndpoint)
const mockSendVk = jest.mocked(sendVkNotification)

const account = {
  id: 'vk-account-1',
  publicId: 'public-vk-1',
  ownerId: '10',
  clientProfileId: '7',
  provider: 'vk' as const,
  displayName: 'Test community',
  status: 'active' as const,
  externalAccountId: '555',
  externalAccountName: 'Test community',
  secretCiphertext: 'ciphertext',
  providerMetadata: {},
}

const credentials = {
  token: 'vk-test-token',
  groupId: '555',
  callbackSecret: 'test-callback-secret',
  confirmationCode: '1a2b3c',
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetAccount.mockResolvedValue(account)
  mockDecrypt.mockReturnValue(credentials)
  mockRecordInbound.mockResolvedValue(true)
  mockSendVk.mockResolvedValue({ providerMessageId: '1' })
  mockBind.mockResolvedValue({ status: 'bound' })
})

function routeContext(publicId = 'public-vk-1'): { params: Promise<{ publicId: string }> } {
  return { params: Promise.resolve({ publicId }) }
}

function postJson(payload: unknown, rawBody?: string): Request {
  return new Request('http://localhost/api/notifications/vk/public-vk-1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: rawBody ?? JSON.stringify(payload),
  })
}

describe('VK Callback API public route', () => {
  it('returns 404 for an unknown publicId and records nothing', async () => {
    mockGetAccount.mockResolvedValue(null)

    const response = await POST(postJson({ type: 'confirmation' }), routeContext('missing'))

    expect(response.status).toBe(404)
    expect(mockRecordInbound).not.toHaveBeenCalled()
    expect(mockDecrypt).not.toHaveBeenCalled()
    expect(mockGetAccount).toHaveBeenCalledWith('vk', 'missing')
  })

  it('returns 400 for a malformed JSON body', async () => {
    const response = await POST(postJson(null, 'not-json'), routeContext())

    expect(response.status).toBe(400)
    expect(mockRecordInbound).not.toHaveBeenCalled()
  })

  it('fails closed with 403 when the callback secret is missing or wrong', async () => {
    const missing = await POST(
      postJson({ type: 'confirmation', group_id: 555 }),
      routeContext(),
    )
    expect(missing.status).toBe(403)

    const wrong = await POST(
      postJson({ type: 'confirmation', group_id: 555, secret: 'wrong-secret' }),
      routeContext(),
    )
    expect(wrong.status).toBe(403)

    expect(mockRecordInbound).not.toHaveBeenCalled()
    expect(mockBind).not.toHaveBeenCalled()
  })

  it('fails closed with 403 when group_id does not match the stored credentials', async () => {
    const response = await POST(
      postJson({ type: 'confirmation', group_id: 999, secret: credentials.callbackSecret }),
      routeContext(),
    )

    expect(response.status).toBe(403)
    expect(mockRecordInbound).not.toHaveBeenCalled()
  })

  it('answers the confirmation handshake with the stored confirmation code', async () => {
    const response = await POST(
      postJson({
        type: 'confirmation',
        group_id: 555,
        event_id: 'ev-1',
        secret: credentials.callbackSecret,
      }),
      routeContext(),
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('1a2b3c')
    expect(mockRecordInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'vk-account-1',
        provider: 'vk',
        providerEventId: 'ev-1',
        eventType: 'confirmation',
        status: 'processed',
      }),
    )
    expect(mockBind).not.toHaveBeenCalled()
    expect(mockSendVk).not.toHaveBeenCalled()
  })

  it('binds the pending endpoint on /connect and confirms in the dialog', async () => {
    const token = 'a'.repeat(24)

    const response = await POST(
      postJson({
        type: 'message_new',
        group_id: 555,
        event_id: 'ev-2',
        secret: credentials.callbackSecret,
        object: {
          message: {
            id: 101,
            peer_id: 2000000000012,
            from_id: 123,
            text: `/connect ${token}`,
          },
        },
      }),
      routeContext(),
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
    expect(mockBind).toHaveBeenCalledWith(
      expect.objectContaining({
        bindToken: token,
        destinationId: '2000000000012',
        destinationLabel: 'VK диалог 2000000000012',
        endpointType: 'vk_peer',
      }),
    )
    expect(mockSendVk).toHaveBeenCalledTimes(1)
    expect(mockSendVk).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'vk-test-token', peerId: '2000000000012' }),
    )
    expect(mockSendVk.mock.calls[0][0].text).toMatch(/подключён/i)
  })

  it('tells the user the connect code is stale when binding fails', async () => {
    mockBind.mockResolvedValue({ status: 'invalid_or_expired' })

    const response = await POST(
      postJson({
        type: 'message_new',
        group_id: 555,
        secret: credentials.callbackSecret,
        object: {
          message: { peer_id: 2000000000012, text: `/connect ${'b'.repeat(24)}` },
        },
      }),
      routeContext(),
    )

    expect(response.status).toBe(200)
    expect(mockSendVk.mock.calls[0][0].text).toMatch(/устарел/i)
  })

  it('does not reprocess a duplicated provider event', async () => {
    mockRecordInbound.mockResolvedValue(false)

    const response = await POST(
      postJson({
        type: 'message_new',
        group_id: 555,
        event_id: 'ev-dup',
        secret: credentials.callbackSecret,
        object: {
          message: { peer_id: 2000000000012, text: `/connect ${'c'.repeat(24)}` },
        },
      }),
      routeContext(),
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
    expect(mockBind).not.toHaveBeenCalled()
    expect(mockSendVk).not.toHaveBeenCalled()
  })

  it('ignores ordinary messages without a /connect token', async () => {
    const response = await POST(
      postJson({
        type: 'message_new',
        group_id: 555,
        secret: credentials.callbackSecret,
        object: { message: { peer_id: 2000000000012, text: 'hello there' } },
      }),
      routeContext(),
    )

    expect(response.status).toBe(200)
    expect(mockBind).not.toHaveBeenCalled()
    expect(mockSendVk).not.toHaveBeenCalled()
  })

  it('rejects a too-short connect token without binding', async () => {
    const response = await POST(
      postJson({
        type: 'message_new',
        group_id: 555,
        secret: credentials.callbackSecret,
        object: { message: { peer_id: 2000000000012, text: '/connect short' } },
      }),
      routeContext(),
    )

    expect(response.status).toBe(200)
    expect(mockBind).not.toHaveBeenCalled()
    expect(mockSendVk).not.toHaveBeenCalled()
  })
})
