import { createHmac } from 'node:crypto'

import {
  buildTelegramDigestFeedbackReplyMarkup,
  verifyDigestFeedbackCallback,
} from '@/lib/telegramDigestFeedback'
import type { HhDigestItem } from '@/lib/hhDigest'

const CALLBACK_SECRET = 'telegram-feedback-test-secret'

const item: HhDigestItem = {
  rank: 1,
  org_id: '42',
  hh_employer_id: 'hh-42',
  employer_name: 'ООО «Пример»',
  vacancies_count: 3,
  distinct_vacancy_names_count: 2,
  latest_published_at: '2026-08-25T07:00:00.000Z',
  total_score: 3.4,
  reasons: ['Растёт найм', 'Есть проверяемый факт'],
  opener: 'Проверить карьерную страницу',
  source_families: ['hh'],
  evidence_titles: ['Новая вакансия'],
  candidate_source_keys: ['hh:42'],
  location_names: ['Москва'],
  confidence_gate: 'A',
  digest_candidate_id: '43',
}

describe('native Telegram digest feedback controls', () => {
  beforeEach(() => {
    process.env.DIGEST_CALLBACK_SECRET = CALLBACK_SECRET
  })

  afterAll(() => {
    delete process.env.DIGEST_CALLBACK_SECRET
  })

  it('renders every supported recruiter action as a signed inline button', () => {
    const markup = buildTelegramDigestFeedbackReplyMarkup({
      clientProfileId: '7',
      items: [item],
    })

    expect(markup).not.toBeNull()
    const actionButtons = markup!.inline_keyboard.slice(1).flat()
    expect(actionButtons.map((button) => button.text)).toEqual([
      'Беру',
      'Мимо',
      'Позже',
      'Уже написал',
      'Ответили',
      'Созвон',
      'Клиент',
      'Скрыть',
    ])
    expect(actionButtons.every((button) => button.callback_data.startsWith('d3:'))).toBe(true)

    const parsedActions = actionButtons.map((button) => {
      expect(Buffer.byteLength(button.callback_data, 'utf8')).toBeLessThanOrEqual(64)
      return verifyDigestFeedbackCallback(button.callback_data)?.action ?? null
    })

    expect(parsedActions).toEqual([
      'accepted',
      'badfit',
      'snooze',
      'contacted',
      'replied',
      'meeting',
      'won',
      'dismissed',
    ])
  })

  it('keeps callback authentication fail-closed for the new states', () => {
    const markup = buildTelegramDigestFeedbackReplyMarkup({
      clientProfileId: '7',
      items: [item],
    })!
    const meetingCallback = markup.inline_keyboard
      .slice(1)
      .flat()
      .find((button) => button.text === 'Созвон')!.callback_data
    const tamperedCallback = `${meetingCallback.slice(0, -1)}x`

    expect(verifyDigestFeedbackCallback(meetingCallback)?.action).toBe('meeting')
    expect(verifyDigestFeedbackCallback(tamperedCallback)).toBeNull()
  })

  it('accepts legacy decimal callbacks during codec migration', () => {
    const sig = createHmac('sha256', CALLBACK_SECRET)
      .update('7:42:a')
      .digest('base64url')
      .slice(0, 22)

    expect(verifyDigestFeedbackCallback(`d:7:42:a:${sig}`)).toEqual(
      expect.objectContaining({
        client_profile_id: '7',
        org_id: '42',
        action: 'accepted',
      }),
    )
  })

  it('returns null instead of throwing when callback secret is unavailable', () => {
    const markup = buildTelegramDigestFeedbackReplyMarkup({
      clientProfileId: '7',
      items: [item],
    })!
    const callbackData = markup.inline_keyboard[1][0].callback_data
    delete process.env.DIGEST_CALLBACK_SECRET

    expect(verifyDigestFeedbackCallback(callbackData)).toBeNull()
    process.env.DIGEST_CALLBACK_SECRET = CALLBACK_SECRET
  })

  it('keeps callbacks within Telegram limits at the BIGSERIAL maximum', () => {
    const maxBigSerial = '9223372036854775807'
    const markup = buildTelegramDigestFeedbackReplyMarkup({
      clientProfileId: maxBigSerial,
      items: [{ ...item, org_id: maxBigSerial }],
    })!
    const callbackData = markup.inline_keyboard[1][0].callback_data

    expect(Buffer.byteLength(callbackData, 'utf8')).toBeLessThanOrEqual(64)
    // The v3 token carries the digest-candidate identity with expiry+nonce;
    // verification decodes identifiers back to canonical decimal strings.
    expect(verifyDigestFeedbackCallback(callbackData)).toEqual(
      expect.objectContaining({
        client_profile_id: maxBigSerial,
        digest_candidate_id: '43',
        action: 'accepted',
      }),
    )

    const candidateMaxMarkup = buildTelegramDigestFeedbackReplyMarkup({
      clientProfileId: maxBigSerial,
      items: [{ ...item, digest_candidate_id: maxBigSerial }],
    })!
    const candidateMaxCallback = candidateMaxMarkup.inline_keyboard[1][0].callback_data

    expect(Buffer.byteLength(candidateMaxCallback, 'utf8')).toBeLessThanOrEqual(64)
    expect(verifyDigestFeedbackCallback(candidateMaxCallback)).toEqual(
      expect.objectContaining({
        client_profile_id: maxBigSerial,
        digest_candidate_id: maxBigSerial,
        action: 'accepted',
      }),
    )
  })

  it('rejects an expired d3 callback even when its signature is valid', () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-08-27T00:00:00.000Z'))
    try {
      const markup = buildTelegramDigestFeedbackReplyMarkup({
        clientProfileId: '7',
        items: [item],
      })!
      const callbackData = markup.inline_keyboard[1][0].callback_data
      expect(verifyDigestFeedbackCallback(callbackData)).not.toBeNull()
      jest.advanceTimersByTime(7 * 24 * 60 * 60 * 1000 + 1000)
      expect(verifyDigestFeedbackCallback(callbackData)).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })
})
