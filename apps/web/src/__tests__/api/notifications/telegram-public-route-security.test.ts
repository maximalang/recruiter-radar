jest.mock('@/lib/digestFeedback', () => ({
  updateDigestOrgStateFeedback: jest.fn(),
}))
jest.mock('@/lib/notifications', () => ({
  authorizeTelegramCallbackOrigin: jest.fn(),
  bindNotificationEndpoint: jest.fn(),
  decryptTelegramAccountCredentials: jest.fn(),
  getNotificationAccountByPublicId: jest.fn(),
  recordNotificationInboundEvent: jest.fn(),
  runNotificationInboundTransaction: jest.fn(),
}))
jest.mock('@/lib/notification-secrets', () => ({
  timingSafeTextEqual: jest.fn(() => true),
}))
jest.mock('@/lib/telegram', () => ({
  answerTelegramCallbackQuery: jest.fn(),
  sendTelegramTextMessage: jest.fn(),
}))
jest.mock('@/lib/telegramDigestFeedback', () => ({
  verifyDigestFeedbackCallback: jest.fn(),
}))

import { POST } from '@/app/api/notifications/telegram/[publicId]/route'
import { updateDigestOrgStateFeedback } from '@/lib/digestFeedback'
import {
  authorizeTelegramCallbackOrigin,
  decryptTelegramAccountCredentials,
  getNotificationAccountByPublicId,
  recordNotificationInboundEvent,
  runNotificationInboundTransaction,
} from '@/lib/notifications'
import { answerTelegramCallbackQuery } from '@/lib/telegram'
import { verifyDigestFeedbackCallback } from '@/lib/telegramDigestFeedback'

const mockAuthorize = jest.mocked(authorizeTelegramCallbackOrigin)
const mockDecrypt = jest.mocked(decryptTelegramAccountCredentials)
const mockGetAccount = jest.mocked(getNotificationAccountByPublicId)
const mockRecordInbound = jest.mocked(recordNotificationInboundEvent)
const mockRunInbound = jest.mocked(runNotificationInboundTransaction)
const mockAnswer = jest.mocked(answerTelegramCallbackQuery)
const mockVerify = jest.mocked(verifyDigestFeedbackCallback)
const mockUpdateFeedback = jest.mocked(updateDigestOrgStateFeedback)

const account = {
  id: 'account-1',
  publicId: 'public-1',
  ownerId: 'owner-1',
  clientProfileId: '7',
  provider: 'telegram' as const,
  displayName: 'Test bot',
  status: 'active' as const,
  externalAccountId: 'bot-1',
  externalAccountName: 'Test bot',
  secretCiphertext: 'ciphertext',
  providerMetadata: {},
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetAccount.mockResolvedValue(account)
  mockDecrypt.mockReturnValue({
    botToken: 'test-bot-token',
    webhookSecret: ['test', 'webhook'].join('-'),
    username: 'test_bot',
  })
  mockRecordInbound.mockResolvedValue(true)
  mockRunInbound.mockImplementation(async (_input, handler) => {
    const outcome = await handler(
      { ownsClaim: true, eventId: 'inbound-1', claimToken: 'claim-1' },
      { query: jest.fn() },
    )
    return { duplicate: false, value: outcome.value }
  })
  mockAnswer.mockResolvedValue(undefined)
  mockVerify.mockReturnValue({
    client_profile_id: '7',
    org_id: '42',
    digest_candidate_id: null,
    action: 'accepted',
    sig: 'signature',
  }) as never;
})

describe('custom Telegram callback authorization', () => {
  it('fails closed for a group callback and never mutates feedback', async () => {
    mockAuthorize.mockResolvedValue(false)

    const response = await POST(requestFor({
      id: 1,
      from: { id: 123 },
      message: { chat: { id: -100123, type: 'group' } },
    }), routeContext())

    expect(response.status).toBe(200)
    // The first origin guard fails closed without any explanatory callback
    // text; the JSON payload omits the undefined callbackText key entirely.
    expect(await response.json()).toEqual({
      ignored: true,
      callbackId: 'callback-1',
    })
    expect(mockUpdateFeedback).not.toHaveBeenCalled()
    expect(mockAuthorize).toHaveBeenCalledWith({
      accountId: 'account-1',
      clientProfileId: '7',
      chatId: '-100123',
      actorId: '123',
    })
    expect(mockAnswer).toHaveBeenCalledWith(expect.objectContaining({
      callbackQueryId: 'callback-1',
    }))
  })

  it('allows a callback only when the bound private-chat origin is authorized', async () => {
    mockAuthorize.mockResolvedValue(true)

    const response = await POST(requestFor({
      id: 2,
      from: { id: 123 },
      message: { chat: { id: 123, type: 'private' } },
    }), routeContext())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      feedback: true,
      callbackId: 'callback-2',
      callbackText: 'Сохранено',
    })
    expect(mockUpdateFeedback).toHaveBeenCalledWith(expect.objectContaining({
      clientProfileId: '7',
      orgId: '42',
      digestCandidateId: null,
      action: 'accepted',
    }), expect.anything())
  })

  it('returns retryable failure when mutation throws after the inbound claim', async () => {
    mockRunInbound.mockRejectedValueOnce(new Error('state mutation failed'))

    const response = await POST(requestFor({
      id: 3,
      from: { id: 123 },
      message: { chat: { id: 123, type: 'private' } },
    }), routeContext())

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ ok: false, retryable: true })
    expect(mockUpdateFeedback).not.toHaveBeenCalled()
    expect(mockAnswer).toHaveBeenCalledWith({
      callbackQueryId: 'callback-3',
      botToken: 'test-bot-token',
      text: 'Не удалось сохранить фидбек',
    })
  })
})

function routeContext(): { params: Promise<{ publicId: string }> } {
  return { params: Promise.resolve({ publicId: 'public-1' }) }
}

function requestFor(callback: {
  id: number
  from: { id: number }
  message: { chat: { id: number; type: 'private' | 'group' } }
}): Request {
  return new Request('http://localhost/api/notifications/telegram/public-1', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': 'test-secret',
    },
    body: JSON.stringify({
      update_id: callback.id,
      callback_query: {
        id: `callback-${callback.id}`,
        data: 'signed-callback',
        from: callback.from,
        message: callback.message,
      },
  }),
  })
}
