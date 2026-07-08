/**
 * T6.3 — Telegram callback label coherence (verify-only).
 *
 * Phase 6 delivery-formatting pass. The Telegram inline buttons
 * (Беру / Мимо / Позже / Скрыть) are a shortcut vocabulary over the same
 * DB-legal `digest_feedback_status` enum the in-app writer uses. The Telegram
 * layer keeps an `accepted → contacted` mapping (memory
 * `project_feedback_enum_drift`) so the button the recruiter taps («Беру»)
 * lands on the canonical DB status («contacted»), never on a value that would
 * throw `invalid input value for enum`.
 *
 * This test is a verify-only contract lock: it pins the mapping and the label
 * coherence so a future drift is caught. It does NOT change the enum, the
 * button copy, or the writer — only asserts the current contract is intact.
 */
import { buildDigestFeedbackActionPlan } from '@/lib/digestFeedback'
import { FEEDBACK_LABELS } from '@/app/ui/internal-page'

describe('T6.3 — Telegram callback label coherence', () => {
  it('maps the Telegram «Беру» (accepted) action onto the canonical DB «contacted» status', () => {
    // The Telegram layer emits `accepted`; the writer must persist
    // `contacted` (the DB-legal enum value), not `accepted`.
    const plan = buildDigestFeedbackActionPlan({ action: 'accepted' })
    expect(plan.feedbackStatus).toBe('contacted')
  })

  it('persists `contacted` directly when the Telegram layer passes it through', () => {
    const plan = buildDigestFeedbackActionPlan({ action: 'contacted' })
    expect(plan.feedbackStatus).toBe('contacted')
  })

  it('every Telegram callback action resolves to a DB-legal feedback status', () => {
    // The Telegram callback set is accepted/badfit/snooze/dismissed (+ shown,
    // which is audit-only, not a feedback status). Each must land on a value
    // that is in the digest_feedback_status enum OR maps onto one — never a
    // legacy string that would throw at write time.
    const cases: Array<{ action: 'accepted' | 'badfit' | 'snooze' | 'dismissed'; expected: string }> = [
      { action: 'accepted', expected: 'contacted' },
      { action: 'badfit', expected: 'badfit' },
      { action: 'snooze', expected: 'snooze' },
      { action: 'dismissed', expected: 'dismissed' },
    ]
    for (const { action, expected } of cases) {
      expect(buildDigestFeedbackActionPlan({ action }).feedbackStatus).toBe(expected)
      // The resolved status must carry an in-app label (FEEDBACK_LABELS) —
      // i.e. the recruiter sees a coherent badge in-app after tapping.
      expect(FEEDBACK_LABELS[expected]).toBeDefined()
    }
  })

  it('the in-app label for the «Беру» resolution is coherent with the Telegram intent', () => {
    // «Беру» = "I'm taking this into work" → in-app it surfaces as «В работе»
    // (contacted). The two vocabularies describe the same triage state; the
    // label differs by channel (shortcut vs full) but the DB status is shared.
    const plan = buildDigestFeedbackActionPlan({ action: 'accepted' })
    expect(FEEDBACK_LABELS[plan.feedbackStatus]?.label).toBe('В работе')
  })
})
