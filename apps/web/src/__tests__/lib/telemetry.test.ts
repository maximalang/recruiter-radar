import {
  PRODUCT_EVENT_NAMES,
  assertTelemetryMetadataSafe,
  isProductEventName,
  recordProductEvent,
} from '@/lib/telemetry'

describe('product telemetry vocabulary', () => {
  test('contains the activation and reliability events required by issue #74', () => {
    expect(PRODUCT_EVENT_NAMES).toEqual(expect.arrayContaining([
      'preview_submitted',
      'checkout_started',
      'order_paid',
      'profile_created',
      'profile_completed',
      'notification_channel_connected',
      'test_notification_succeeded',
      'digest_generated',
      'digest_delivered',
      'feedback_recorded',
      'source_fetch_succeeded',
      'source_fetch_failed',
      'digest_run_succeeded',
      'digest_run_failed',
      'delivery_succeeded',
      'delivery_failed',
    ]))
    expect(isProductEventName('digest_delivered')).toBe(true)
    expect(isProductEventName('provider_token_saved')).toBe(false)
  })
})

describe('telemetry privacy boundary', () => {
  test.each([
    'token',
    'botToken',
    'secret',
    'password',
    'authorization',
    'cookie',
    'email',
    'phone',
    'customerContact',
    'rawPayload',
    'evidenceItems',
    'requestBody',
  ])('rejects sensitive key %s', (key) => {
    expect(() => assertTelemetryMetadataSafe({ [key]: 'must-not-be-stored' })).toThrow()
  })

  test('rejects sensitive nested keys and oversized metadata', () => {
    expect(() => assertTelemetryMetadataSafe({ safe: { providerToken: 'x' } })).toThrow()
    expect(() => assertTelemetryMetadataSafe({ note: 'x'.repeat(5_000) })).toThrow()
  })

  test('accepts bounded operational metadata', () => {
    expect(assertTelemetryMetadataSafe({
      source: 'hh',
      selectedCount: 4,
      success: true,
      gates: ['A', 'B'],
      errorCode: null,
    })).toEqual({
      source: 'hh',
      selectedCount: 4,
      success: true,
      gates: ['A', 'B'],
      errorCode: null,
    })
  })

  test('writes parameterized, deduplicated events without embedding metadata in SQL', async () => {
    const query = jest.fn().mockResolvedValue({ rowCount: 1, rows: [{ id: 1 }] })

    await expect(recordProductEvent({
      eventName: 'source_fetch_succeeded',
      eventKey: 'source:hh:fetch:fixture-1',
      provider: 'hh',
      durationMs: 12.8,
      metadata: { records: 25 },
      occurredAt: '2026-07-20T10:00:00.000Z',
    }, { query })).resolves.toBe(true)

    expect(query).toHaveBeenCalledTimes(1)
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain('ON CONFLICT (event_key) DO NOTHING')
    expect(sql).not.toContain('records')
    expect(params).toEqual(expect.arrayContaining([
      'source_fetch_succeeded',
      'source:hh:fetch:fixture-1',
      'hh',
      12,
      JSON.stringify({ records: 25 }),
    ]))
  })
})
