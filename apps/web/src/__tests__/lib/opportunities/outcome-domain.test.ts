import {
  getNextOutcomeStage,
  hashOutcomePayload,
  isOutcomeTransitionAllowed,
  OutcomeValidationError,
  reduceOutcomeProjection,
  validateOutcomeInput,
} from '@/lib/opportunities/outcome-domain'

const NOW = new Date('2026-07-27T12:00:00.000Z')

describe('opportunity outcome domain', () => {
  it.each([
    ['new', 'accepted', 'accepted'],
    ['accepted', 'contacted', 'contacted'],
    ['contacted', 'replied', 'replied'],
    ['replied', 'meeting', 'meeting'],
    ['meeting', 'proposal', 'proposal'],
    ['proposal', 'won', 'won'],
    ['contacted', 'lost', 'lost'],
    ['meeting', 'snoozed', 'snoozed'],
  ] as const)('allows %s + %s -> %s', (stage, eventType, expected) => {
    expect(isOutcomeTransitionAllowed(stage, eventType)).toBe(true)
    expect(getNextOutcomeStage(stage, eventType)).toBe(expected)
  })

  it.each([
    ['new', 'contacted'],
    ['accepted', 'replied'],
    ['contacted', 'meeting'],
    ['replied', 'won'],
    ['won', 'accepted'],
    ['lost', 'contacted'],
  ] as const)('rejects %s + %s', (stage, eventType) => {
    expect(isOutcomeTransitionAllowed(stage, eventType)).toBe(false)
  })

  it.each(['shown', 'opened', 'exported'] as const)(
    'keeps the commercial stage for observational event %s',
    (eventType) => {
      expect(getNextOutcomeStage('accepted', eventType)).toBe('accepted')
    },
  )

  it('requires a controlled dismissed reason', () => {
    expect(() => validateOutcomeInput({
      eventType: 'dismissed',
      occurredAt: NOW.toISOString(),
      idempotencyKey: 'dismissed:test',
      metadata: {},
    }, NOW)).toThrow(OutcomeValidationError)
  })

  it('requires a controlled lost reason', () => {
    expect(() => validateOutcomeInput({
      eventType: 'lost',
      occurredAt: NOW.toISOString(),
      idempotencyKey: 'lost:test',
      reasonCode: 'bad_fit',
      metadata: {},
    }, NOW)).toThrow(OutcomeValidationError)
  })

  it('requires a note for other and trims accepted input', () => {
    expect(() => validateOutcomeInput({
      eventType: 'dismissed',
      occurredAt: NOW.toISOString(),
      idempotencyKey: 'dismissed:test',
      reasonCode: 'other',
      reasonNote: '   ',
      metadata: {},
    }, NOW)).toThrow(OutcomeValidationError)

    expect(validateOutcomeInput({
      eventType: 'dismissed',
      occurredAt: NOW.toISOString(),
      idempotencyKey: ' dismissed:test ',
      reasonCode: 'other',
      reasonNote: '  Нестандартная причина  ',
      metadata: {},
    }, NOW)).toMatchObject({
      idempotencyKey: 'dismissed:test',
      reasonNote: 'Нестандартная причина',
    })
  })

  it('requires channel for contacted and validates contact path taxonomy', () => {
    expect(() => validateOutcomeInput({
      eventType: 'contacted',
      occurredAt: NOW.toISOString(),
      idempotencyKey: 'contacted:test',
      metadata: {},
    }, NOW)).toThrow(OutcomeValidationError)

    expect(validateOutcomeInput({
      eventType: 'contacted',
      occurredAt: NOW.toISOString(),
      idempotencyKey: 'contacted:test',
      channel: 'email',
      contactPathType: 'corporate_email',
      metadata: {},
    }, NOW)).toMatchObject({
      channel: 'email',
      contactPathType: 'corporate_email',
    })
  })

  it('stores won value only as non-negative integer minor units', () => {
    expect(validateOutcomeInput({
      eventType: 'won',
      occurredAt: NOW.toISOString(),
      idempotencyKey: 'won:test',
      valueMinor: 35_000_000,
      currency: 'RUB',
      metadata: {},
    }, NOW)).toMatchObject({ valueMinor: 35_000_000, currency: 'RUB' })

    expect(() => validateOutcomeInput({
      eventType: 'won',
      occurredAt: NOW.toISOString(),
      idempotencyKey: 'won:negative',
      valueMinor: -1,
      currency: 'RUB',
      metadata: {},
    }, NOW)).toThrow(OutcomeValidationError)

    expect(() => validateOutcomeInput({
      eventType: 'won',
      occurredAt: NOW.toISOString(),
      idempotencyKey: 'won:float',
      valueMinor: 1.5,
      currency: 'RUB',
      metadata: {},
    }, NOW)).toThrow(OutcomeValidationError)
  })

  it('rejects excessive future timestamps and unknown metadata', () => {
    expect(() => validateOutcomeInput({
      eventType: 'opened',
      occurredAt: '2026-07-27T12:06:00.000Z',
      idempotencyKey: 'opened:test',
      metadata: { interactionId: 'view-1' },
    }, NOW)).toThrow(OutcomeValidationError)

    expect(() => validateOutcomeInput({
      eventType: 'opened',
      occurredAt: NOW.toISOString(),
      idempotencyKey: 'opened:test',
      metadata: { rawPayload: 'not allowed' },
    }, NOW)).toThrow(OutcomeValidationError)
  })

  it('hashes canonical payloads deterministically', () => {
    expect(hashOutcomePayload({
      eventType: 'opened',
      occurredAt: NOW.toISOString(),
      idempotencyKey: 'opened:test',
      metadata: { interactionId: 'view-1', surface: 'detail' },
    })).toBe(hashOutcomePayload({
      metadata: { surface: 'detail', interactionId: 'view-1' },
      idempotencyKey: 'opened:test',
      occurredAt: NOW.toISOString(),
      eventType: 'opened',
    }))
  })

  it('rebuilds projection deterministically without losing first timestamps', () => {
    const accepted = reduceOutcomeProjection(null, {
      id: '1',
      eventType: 'accepted',
      previousStage: 'new',
      newStage: 'accepted',
      occurredAt: '2026-07-27T09:00:00.000Z',
      reasonCode: null,
      valueMinor: null,
      currency: null,
    })
    const contacted = reduceOutcomeProjection(accepted, {
      id: '2',
      eventType: 'contacted',
      previousStage: 'accepted',
      newStage: 'contacted',
      occurredAt: '2026-07-27T10:00:00.000Z',
      reasonCode: null,
      valueMinor: null,
      currency: null,
    })
    const replied = reduceOutcomeProjection(contacted, {
      id: '3',
      eventType: 'replied',
      previousStage: 'contacted',
      newStage: 'replied',
      occurredAt: '2026-07-27T11:00:00.000Z',
      reasonCode: null,
      valueMinor: null,
      currency: null,
    })

    expect(replied).toMatchObject({
      currentStage: 'replied',
      lastEventId: '3',
      acceptedAt: '2026-07-27T09:00:00.000Z',
      contactedAt: '2026-07-27T10:00:00.000Z',
      repliedAt: '2026-07-27T11:00:00.000Z',
    })
  })

  it('projects lost reasons and confirmed won values', () => {
    const lost = reduceOutcomeProjection(null, {
      id: '8',
      eventType: 'lost',
      previousStage: 'proposal',
      newStage: 'lost',
      occurredAt: NOW.toISOString(),
      reasonCode: 'price',
      valueMinor: null,
      currency: null,
    })
    expect(lost.lostReasonCode).toBe('price')

    const won = reduceOutcomeProjection(null, {
      id: '9',
      eventType: 'won',
      previousStage: 'proposal',
      newStage: 'won',
      occurredAt: NOW.toISOString(),
      reasonCode: null,
      valueMinor: 35_000_000,
      currency: 'RUB',
    })
    expect(won).toMatchObject({
      currentStage: 'won',
      wonAt: NOW.toISOString(),
      dealValueMinor: 35_000_000,
      currency: 'RUB',
    })
  })
})
