import {
  classifyFeedbackSentiment,
  computeClientQueryAdjustments,
  industryDemoteTerms,
  roleDemoteValues,
  roleBoostValues,
  NO_ADJUSTMENTS,
  MIN_SAMPLES_PER_AXIS,
  NEGATIVE_FEEDBACK_ACTIONS,
  POSITIVE_FEEDBACK_ACTIONS,
  type FeedbackPatternEvent,
} from '@/lib/lead-discovery/query-feedback-tuning'
import { INDUSTRY_KEYWORDS, VALID_INDUSTRIES } from '@/lib/clientProfiles'

function ev(
  overrides: Partial<FeedbackPatternEvent> = {},
): FeedbackPatternEvent {
  return { industry: null, role: null, sentiment: 'negative', ...overrides }
}

describe('classifyFeedbackSentiment', () => {
  it('maps badfit and dismissed to negative', () => {
    expect(classifyFeedbackSentiment('badfit')).toBe('negative')
    expect(classifyFeedbackSentiment('dismissed')).toBe('negative')
  })

  it('maps contacted, replied, won to positive', () => {
    expect(classifyFeedbackSentiment('contacted')).toBe('positive')
    expect(classifyFeedbackSentiment('replied')).toBe('positive')
    expect(classifyFeedbackSentiment('won')).toBe('positive')
  })

  it('maps none and snooze to null (neutral, not query-quality signals)', () => {
    expect(classifyFeedbackSentiment('none')).toBeNull()
    expect(classifyFeedbackSentiment('snooze')).toBeNull()
  })

  it('maps unknown values to null', () => {
    expect(classifyFeedbackSentiment('garbage')).toBeNull()
  })
})

describe('computeClientQueryAdjustments', () => {
  it('returns NO_ADJUSTMENTS for empty history', () => {
    expect(computeClientQueryAdjustments([])).toEqual(NO_ADJUSTMENTS)
  })

  it('does NOT demote an industry on a single badfit (minimum sample gate)', () => {
    // One badfit must never narrow the query.
    const result = computeClientQueryAdjustments([
      ev({ industry: 'finance', sentiment: 'negative' }),
    ])
    expect(result.demote).toHaveLength(0)
    expect(result.boost).toHaveLength(0)
  })

  it('demotes an industry once badfits reach MIN_SAMPLES_PER_AXIS and outnumber positives', () => {
    const result = computeClientQueryAdjustments([
      ev({ industry: 'finance', sentiment: 'negative' }),
      ev({ industry: 'finance', sentiment: 'negative' }),
      ev({ industry: 'finance', sentiment: 'negative' }),
    ])
    expect(result.demote).toHaveLength(1)
    expect(result.demote[0]).toMatchObject({
      axis: 'industry',
      value: 'finance',
      direction: 'demote',
      sampleCount: 3,
      netScore: -3,
    })
    expect(result.boost).toHaveLength(0)
  })

  it('does NOT demote when positives balance negatives (net zero is neutral)', () => {
    const result = computeClientQueryAdjustments([
      ev({ industry: 'finance', sentiment: 'negative' }),
      ev({ industry: 'finance', sentiment: 'negative' }),
      ev({ industry: 'finance', sentiment: 'positive' }),
      ev({ industry: 'finance', sentiment: 'positive' }),
    ])
    // 4 events (>= MIN) but net 0 → no adjustment.
    expect(result.demote).toHaveLength(0)
    expect(result.boost).toHaveLength(0)
  })

  it('boosts an industry when positives outnumber negatives at min sample', () => {
    const result = computeClientQueryAdjustments([
      ev({ industry: 'it', sentiment: 'positive' }),
      ev({ industry: 'it', sentiment: 'positive' }),
      ev({ industry: 'it', sentiment: 'positive' }),
      ev({ industry: 'it', sentiment: 'negative' }),
    ])
    expect(result.boost).toHaveLength(1)
    expect(result.boost[0]).toMatchObject({
      axis: 'industry',
      value: 'it',
      direction: 'boost',
      sampleCount: 4,
      netScore: 2,
    })
  })

  it('ignores events with an unknown industry (not in VALID_INDUSTRIES)', () => {
    const result = computeClientQueryAdjustments([
      ev({ industry: 'not-an-industry', sentiment: 'negative' }),
      ev({ industry: 'not-an-industry', sentiment: 'negative' }),
      ev({ industry: 'not-an-industry', sentiment: 'negative' }),
    ])
    expect(result.demote).toHaveLength(0)
  })

  it('ignores events with null industry AND null role (no axis to tune on)', () => {
    const result = computeClientQueryAdjustments([
      ev({ industry: null, role: null, sentiment: 'negative' }),
      ev({ industry: null, role: null, sentiment: 'negative' }),
      ev({ industry: null, role: null, sentiment: 'negative' }),
    ])
    expect(result.demote).toHaveLength(0)
  })

  it('separates demote and boost across multiple industries', () => {
    const result = computeClientQueryAdjustments([
      // finance: 3 bad → demote
      ev({ industry: 'finance', sentiment: 'negative' }),
      ev({ industry: 'finance', sentiment: 'negative' }),
      ev({ industry: 'finance', sentiment: 'negative' }),
      // it: 3 won → boost
      ev({ industry: 'it', sentiment: 'positive' }),
      ev({ industry: 'it', sentiment: 'positive' }),
      ev({ industry: 'it', sentiment: 'positive' }),
    ])
    const demotedIndustries = result.demote.map(a => a.value)
    const boostedIndustries = result.boost.map(a => a.value)
    expect(demotedIndustries).toContain('finance')
    expect(boostedIndustries).toContain('it')
    expect(demotedIndustries).not.toContain('it')
    expect(boostedIndustries).not.toContain('finance')
  })

  it('sorts adjustments by absolute net score descending, then value ascending (deterministic)', () => {
    const result = computeClientQueryAdjustments([
      // finance: net -3
      ev({ industry: 'finance', sentiment: 'negative' }),
      ev({ industry: 'finance', sentiment: 'negative' }),
      ev({ industry: 'finance', sentiment: 'negative' }),
      // it: net -5 (stronger)
      ev({ industry: 'it', sentiment: 'negative' }),
      ev({ industry: 'it', sentiment: 'negative' }),
      ev({ industry: 'it', sentiment: 'negative' }),
      ev({ industry: 'it', sentiment: 'negative' }),
      ev({ industry: 'it', sentiment: 'negative' }),
    ])
    expect(result.demote[0].value).toBe('it') // stronger net
    expect(result.demote[1].value).toBe('finance')
  })

  it('MIN_SAMPLES_PER_AXIS is 3 (matches the existing reweight threshold)', () => {
    expect(MIN_SAMPLES_PER_AXIS).toBe(3)
  })

  it('every NEGATIVE/POSITIVE action enum is a non-empty string', () => {
    expect(NEGATIVE_FEEDBACK_ACTIONS.length).toBeGreaterThan(0)
    expect(POSITIVE_FEEDBACK_ACTIONS.length).toBeGreaterThan(0)
    for (const a of NEGATIVE_FEEDBACK_ACTIONS) expect(typeof a).toBe('string')
    for (const a of POSITIVE_FEEDBACK_ACTIONS) expect(typeof a).toBe('string')
  })

  it('computes role-axis adjustments (reserved for future term mapping)', () => {
    const result = computeClientQueryAdjustments([
      ev({ role: 'hr', sentiment: 'negative' }),
      ev({ role: 'hr', sentiment: 'negative' }),
      ev({ role: 'hr', sentiment: 'negative' }),
    ])
    expect(roleDemoteValues(result)).toContain('hr')
    expect(roleBoostValues(result)).toHaveLength(0)
  })
})

describe('industryDemoteTerms', () => {
  it('expands a demoted industry into its INDUSTRY_KEYWORDS terms (lowercased)', () => {
    const adjustments = computeClientQueryAdjustments([
      ev({ industry: 'finance', sentiment: 'negative' }),
      ev({ industry: 'finance', sentiment: 'negative' }),
      ev({ industry: 'finance', sentiment: 'negative' }),
    ])
    const terms = industryDemoteTerms(adjustments)
    const expectedTerms = (INDUSTRY_KEYWORDS.get('finance') ?? []).map(t => t.toLowerCase())
    for (const t of expectedTerms) expect(terms.has(t)).toBe(true)
  })

  it('returns an empty set when there are no demoted industries', () => {
    expect(industryDemoteTerms(NO_ADJUSTMENTS).size).toBe(0)
  })

  it('only maps demote, never boost (boost is re-ordering, not term expansion)', () => {
    const adjustments = computeClientQueryAdjustments([
      ev({ industry: 'it', sentiment: 'positive' }),
      ev({ industry: 'it', sentiment: 'positive' }),
      ev({ industry: 'it', sentiment: 'positive' }),
    ])
    // it is boosted, not demoted → no demote terms.
    expect(industryDemoteTerms(adjustments).size).toBe(0)
  })

  it('every demoted industry value is a canonical VALID_INDUSTRIES key', () => {
    // Sanity: the tuner only emits industry values it validated.
    const adjustments = computeClientQueryAdjustments([
      ev({ industry: 'finance', sentiment: 'negative' }),
      ev({ industry: 'finance', sentiment: 'negative' }),
      ev({ industry: 'finance', sentiment: 'negative' }),
      ev({ industry: 'it', sentiment: 'negative' }),
      ev({ industry: 'it', sentiment: 'negative' }),
      ev({ industry: 'it', sentiment: 'negative' }),
    ])
    for (const a of adjustments.demote) {
      if (a.axis === 'industry') expect(VALID_INDUSTRIES.has(a.value)).toBe(true)
    }
  })
})
