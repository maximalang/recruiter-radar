import {
  DEFAULT_BADFIT_SUPPRESSION_DAYS,
  buildDigestFeedbackActionPlan,
} from '@/lib/digestFeedback'

describe('buildDigestFeedbackActionPlan', () => {
  it('makes accepted/contacted/replied/meeting/won permanently suppressed', () => {
    for (const action of ['accepted', 'contacted', 'replied', 'meeting', 'won'] as const) {
      const plan = buildDigestFeedbackActionPlan({ action })
      expect(plan.suppressedSql).toBe("'infinity'::timestamptz")
      expect(plan.extraParams).toEqual([])
    }
  })

  it('time-bounds badfit / dismissed to 30 days by default', () => {
    expect(DEFAULT_BADFIT_SUPPRESSION_DAYS).toBe(30)
    for (const action of ['badfit', 'dismissed'] as const) {
      const plan = buildDigestFeedbackActionPlan({ action, paramOffset: 5 })
      expect(plan.feedbackStatus).toBe(action)
      expect(plan.suppressedSql).toBe("NOW() + ($6 * INTERVAL '1 day')")
      expect(plan.extraParams).toEqual([30])
    }
  })

  it('honours an explicit suppressionDays for badfit', () => {
    const plan = buildDigestFeedbackActionPlan({
      action: 'badfit',
      suppressionDays: 14,
      paramOffset: 0,
    })
    expect(plan.suppressedSql).toBe("NOW() + ($1 * INTERVAL '1 day')")
    expect(plan.extraParams).toEqual([14])
  })

  it('clamps suppressionDays to a sane range', () => {
    expect(
      buildDigestFeedbackActionPlan({ action: 'badfit', suppressionDays: 0, paramOffset: 0 })
        .extraParams
    ).toEqual([30])
    expect(
      buildDigestFeedbackActionPlan({
        action: 'badfit',
        suppressionDays: 9999,
        paramOffset: 0,
      }).extraParams
    ).toEqual([365])
    expect(
      buildDigestFeedbackActionPlan({
        action: 'badfit',
        suppressionDays: -5,
        paramOffset: 0,
      }).extraParams
    ).toEqual([30])
  })

  it('keeps snooze with default 7 days when omitted', () => {
    const plan = buildDigestFeedbackActionPlan({ action: 'snooze', paramOffset: 2 })
    expect(plan.feedbackStatus).toBe('snooze')
    expect(plan.suppressedSql).toBe("NOW() + ($3 * INTERVAL '1 day')")
    expect(plan.extraParams).toEqual([7])
  })

  it('extends suppressed_until rather than shrinking it on update', () => {
    const plan = buildDigestFeedbackActionPlan({
      action: 'badfit',
      suppressionDays: 30,
      paramOffset: 0,
    })
    // GREATEST(...) is the marker that a re-feedback never shrinks the window.
    expect(plan.suppressedUpdateSql).toMatch(/GREATEST/)
  })
})
