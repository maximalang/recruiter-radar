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
    // 2026-07-01 is a Wednesday; in Europe/Moscow (MSK, UTC+3, no DST) the
    // calendar day of the run instant is still 2026-07-01, so this is "today".
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
    // UTC fallback: 03:00 UTC run instant formats as 03:00 in UTC.
    expect(hint.label).toContain('03:00')
  })

  it('weekly hint annotates "раз в неделю"', () => {
    // 2026-07-01 is a Wednesday. Next Monday cron is 2026-07-06 03:00 UTC.
    const now = new Date(Date.UTC(2026, 6, 1, 2, 0, 0))
    const hint = computeNextDeliveryHint(
      { deliveryTimezone: 'Europe/Moscow', deliveryFrequency: 'weekly', deliveryTimeLocal: null },
      now,
    )
    expect(hint.label).toContain('раз в неделю')
    expect(hint.nextRunIso).toBe(new Date(Date.UTC(2026, 6, 6, 3, 0, 0)).toISOString())
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

  // DST / timezone-boundary coverage.
  //
  // Europe/Moscow itself has no DST since 2014, but the helper must be stable
  // on days where the UTC calendar day differs from the local-zone calendar
  // day — exactly the failure mode that broke the original tests (they used
  // `new Date()` for the "today" compare instead of the injected `now`).
  // We pin `now` to the UTC side of a midnight roll-over and assert the
  // local-zone day classification follows `now`, not the system clock.

  it('classifies "today" using the injected now, not the system clock (tz-boundary)', () => {
    // 2026-07-01 22:00 UTC = 2026-07-02 01:00 Moscow. The cron at 03:00 UTC
    // on 2026-07-02 lands at 06:00 Moscow on 2026-07-02 — same Moscow calendar
    // day as `now` (2026-07-02 Moscow), so "Сегодня".
    const now = new Date(Date.UTC(2026, 6, 1, 22, 0, 0))
    const hint = computeNextDeliveryHint(
      { deliveryTimezone: 'Europe/Moscow', deliveryFrequency: 'daily', deliveryTimeLocal: null },
      now,
    )
    expect(hint.label).toContain('Сегодня')
    expect(hint.label).toContain('06:00')
  })

  it('classifies "tomorrow" across a tz calendar-day roll-over', () => {
    // 2026-07-01 23:30 UTC = 2026-07-02 02:30 Moscow. Today's 03:00 UTC cron
    // (2026-07-02 03:00 UTC = 06:00 Moscow) is still ahead, and in Moscow it
    // is already 2026-07-02, so the run is "Сегодня" — not "Завтра". This
    // guards against the old bug where `new Date()` decided the day.
    const now = new Date(Date.UTC(2026, 6, 1, 23, 30, 0))
    const hint = computeNextDeliveryHint(
      { deliveryTimezone: 'Europe/Moscow', deliveryFrequency: 'daily', deliveryTimeLocal: null },
      now,
    )
    expect(hint.label).toContain('Сегодня')
    expect(hint.label).toContain('06:00')
    expect(hint.nextRunIso).toBe(new Date(Date.UTC(2026, 6, 2, 3, 0, 0)).toISOString())
  })

  it('UTC fallback uses the UTC calendar day for today/tomorrow', () => {
    // 2026-07-01 02:00 UTC -> next cron 2026-07-01 03:00 UTC = "today" in UTC.
    const now = new Date(Date.UTC(2026, 6, 1, 2, 0, 0))
    const hint = computeNextDeliveryHint(
      { deliveryTimezone: 'Not/ARealZone', deliveryFrequency: 'daily', deliveryTimeLocal: null },
      now,
    )
    expect(hint.label).toContain('Сегодня')
    expect(hint.label).toContain('03:00')
    expect(hint.nextRunIso).toBe(new Date(Date.UTC(2026, 6, 1, 3, 0, 0)).toISOString())
  })

  it('weekly hint lands on next Monday across a tz-boundary day', () => {
    // 2026-07-04 23:00 UTC (Saturday) = 2026-07-05 02:00 Moscow (Sunday).
    // Next Monday cron is 2026-07-06 03:00 UTC = 06:00 Moscow.
    const now = new Date(Date.UTC(2026, 6, 4, 23, 0, 0))
    const hint = computeNextDeliveryHint(
      { deliveryTimezone: 'Europe/Moscow', deliveryFrequency: 'weekly', deliveryTimeLocal: null },
      now,
    )
    expect(hint.label).toContain('раз в неделю')
    expect(hint.nextRunIso).toBe(new Date(Date.UTC(2026, 6, 6, 3, 0, 0)).toISOString())
  })
})
