import {
  computeNextDeliveryHint,
  shouldDeliverOnRun,
} from '@/lib/delivery/nextDeliveryHint'

describe('shouldDeliverOnRun', () => {
  it('daily always delivers', () => {
    // Any day-of-week, any instant.
    for (let dow = 0; dow < 7; dow += 1) {
      const d = new Date(Date.UTC(2026, 6, 6 + dow, 3, 0, 0))
      expect(shouldDeliverOnRun('daily', d)).toBe(true)
    }
  })

  it('weekly only delivers on Mondays (UTC)', () => {
    // 2026-07-06 is a Monday; the 6 days after are Tue..Sun.
    for (let offset = 0; offset < 7; offset += 1) {
      const d = new Date(Date.UTC(2026, 6, 6 + offset, 3, 0, 0))
      expect(shouldDeliverOnRun('weekly', d)).toBe(offset === 0)
    }
  })
})

describe('computeNextDeliveryHint', () => {
  it('returns a label mentioning the time in the target tz', () => {
    // 2026-07-01 02:00 UTC -> cron today at 03:00 UTC = 06:00 Moscow.
    const now = new Date(Date.UTC(2026, 6, 1, 2, 0, 0))
    const hint = computeNextDeliveryHint(
      { deliveryTimezone: 'Europe/Moscow', deliveryFrequency: 'daily', deliveryTimeLocal: null },
      now,
    )
    expect(hint.label).toContain('06:00')
    expect(hint.label).toContain('Сегодня')
    expect(hint.hasPreferredTime).toBe(false)
  })

  it('rolls to tomorrow when today\'s cron has already passed', () => {
    // 2026-07-01 10:00 UTC -> today 03:00 UTC already gone, next is tomorrow 03:00 UTC.
    const now = new Date(Date.UTC(2026, 6, 1, 10, 0, 0))
    const hint = computeNextDeliveryHint(
      { deliveryTimezone: 'Europe/Moscow', deliveryFrequency: 'daily', deliveryTimeLocal: null },
      now,
    )
    expect(hint.label).toContain('Завтра')
    expect(hint.label).toContain('06:00')
  })

  it('reports a preferred time when deliveryTimeLocal is set', () => {
    const now = new Date(Date.UTC(2026, 6, 1, 2, 0, 0))
    const hint = computeNextDeliveryHint(
      { deliveryTimezone: 'Europe/Moscow', deliveryFrequency: 'daily', deliveryTimeLocal: '09:30' },
      now,
    )
    expect(hint.hasPreferredTime).toBe(true)
  })

  it('falls back gracefully on an unknown timezone', () => {
    const now = new Date(Date.UTC(2026, 6, 1, 2, 0, 0))
    // Should not throw; label still contains a time.
    const hint = computeNextDeliveryHint(
      { deliveryTimezone: 'Not/ARealZone', deliveryFrequency: 'daily', deliveryTimeLocal: null },
      now,
    )
    expect(typeof hint.label).toBe('string')
    expect(hint.label.length).toBeGreaterThan(0)
  })

  it('weekly hint annotates "раз в неделю"', () => {
    const now = new Date(Date.UTC(2026, 6, 1, 2, 0, 0))
    const hint = computeNextDeliveryHint(
      { deliveryTimezone: 'Europe/Moscow', deliveryFrequency: 'weekly', deliveryTimeLocal: null },
      now,
    )
    expect(hint.label).toContain('раз в неделю')
  })

  it('nextRunIso is a valid ISO string in the future', () => {
    const now = new Date(Date.UTC(2026, 6, 1, 2, 0, 0))
    const hint = computeNextDeliveryHint(
      { deliveryTimezone: 'Europe/Moscow', deliveryFrequency: 'daily', deliveryTimeLocal: null },
      now,
    )
    const d = new Date(hint.nextRunIso)
    expect(d.getTime()).toBeGreaterThan(now.getTime())
    expect(Number.isNaN(d.getTime())).toBe(false)
  })
})
