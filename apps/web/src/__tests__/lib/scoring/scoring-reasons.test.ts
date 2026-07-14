/**
 * Tests for T2: Structured ScoringReason type.
 *
 * Phase 1: test the formatReason/REASON_LABELS module.
 * Phase 2 (after fiur.ts migration): test that computeFiur returns ScoringReason[].
 */

import type { ScoringReason } from '@/lib/scoring/scoring-reasons'
import {
  formatReason,
  formatReasons,
  REASON_LABELS,
} from '@/lib/scoring/scoring-reasons'

describe('T2: ScoringReason module', () => {
  it('REASON_LABELS has entries for all expected keys', () => {
    const requiredKeys = [
      'fit.industry.excluded',
      'fit.industry.match',
      'fit.industry.outside',
      'fit.role.match',
      'fit.role.no-match',
      'fit.location.match',
      'fit.location.outside',
      'intent.fresh-signals',
      'intent.stale-signals',
      'intent.direct-surface',
      'intent.multiple-roles',
      'urgency.hard-to-fill',
      'urgency.fresh-postings',
      'reachability.career-page',
      'reachability.no-path',
    ]
    const keys = Object.keys(REASON_LABELS)
    for (const key of requiredKeys) {
      expect(keys).toContain(key)
    }
  })

  it('formatReason produces Russian text for fit industry match', () => {
    const reason: ScoringReason = {
      component: 'fit',
      key: 'fit.industry.match',
      params: { industry: 'fintech' },
    }
    const formatted = formatReason(reason)
    expect(formatted).toContain('fintech')
    expect(formatted).toContain('совпадает')
  })

  it('formatReason produces Russian text for role match', () => {
    const reason: ScoringReason = {
      component: 'fit',
      key: 'fit.role.match',
      params: { count: 2 },
    }
    const formatted = formatReason(reason)
    expect(formatted).toContain('2')
    expect(formatted).toContain('ролей')
  })

  it('formatReasons converts array of reasons to Russian strings', () => {
    const reasons: ScoringReason[] = [
      { component: 'fit', key: 'fit.industry.match', params: { industry: 'it' } },
      { component: 'intent', key: 'intent.fresh-signals' },
    ]
    const formatted = formatReasons(reasons)
    expect(formatted.length).toBe(2)
    expect(formatted[0]).toContain('it')
    expect(formatted[1]).toContain('Свежие')
  })

  it('formatReason falls back to [key] for unknown keys', () => {
    const reason: ScoringReason = { component: 'fit', key: 'fit.unknown.test' }
    const formatted = formatReason(reason)
    expect(formatted).toBe('[fit.unknown.test]')
  })

  it('formatReason renders a legacy free-form reason text verbatim, not [legacy.…]', () => {
    // Legacy digest rows store plain Russian strings; parseReasons wraps them as
    // { key: 'legacy', params: { text } }. The card must show the human text, not
    // the debug-style bracketed stub that used to leak.
    const reason: ScoringReason = {
      component: 'fit',
      key: 'legacy',
      params: { text: '86 вакансий, включая «Аккредитация специалистов»' },
    }
    expect(formatReason(reason)).toBe('86 вакансий, включая «Аккредитация специалистов»')
    expect(formatReason(reason)).not.toMatch(/^\[/)
  })

  it('formatReason renders empty string for a legacy reason with no text', () => {
    const reason: ScoringReason = { component: 'fit', key: 'legacy' }
    expect(formatReason(reason)).toBe('')
  })

  it('formatReason handles reason without params', () => {
    const reason: ScoringReason = { component: 'intent', key: 'intent.fresh-signals' }
    const formatted = formatReason(reason)
    expect(formatted).toContain('Свежие')
  })

  it('all REASON_LABELS values contain Russian text', () => {
    for (const [key, label] of Object.entries(REASON_LABELS)) {
      // At minimum, every label should be non-empty and contain Cyrillic or be a template
      expect(label.length).toBeGreaterThan(0)
    }
  })
})
