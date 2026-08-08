import {
  applyNegativeEvidence,
  evaluateNegativeEvidence,
  type NegativeEvidenceInput,
} from '@/lib/opportunities/negative-evidence-v1'

function negative(
  overrides: Partial<NegativeEvidenceInput> = {},
): NegativeEvidenceInput {
  return {
    type: 'hiring_slowdown',
    classification: 'confirmed_negative',
    sourceKind: 'official',
    severity: 0.7,
    eventIds: ['201'],
    evidenceIds: ['101'],
    observedAt: '2026-08-08T09:00:00.000Z',
    validUntil: '2026-09-08T09:00:00.000Z',
    ...overrides,
  }
}

describe('Negative Evidence Engine v1', () => {
  it.each([
    'hiring_freeze',
    'explicit_no_agencies',
    'procurement_barrier',
  ] as const)('rejects %s when it is inferred by an LLM', (type) => {
    expect(() => evaluateNegativeEvidence([
      negative({ type, sourceKind: 'llm' }),
    ], new Date('2026-08-09T09:00:00.000Z'))).toThrow(/LLM/i)
  })

  it('requires evidence for every confirmed negative assertion', () => {
    expect(() => evaluateNegativeEvidence([
      negative({ evidenceIds: [] }),
    ], new Date('2026-08-09T09:00:00.000Z'))).toThrow(/evidence/i)
  })

  it('lets a confirmed hiring freeze close an active opportunity', () => {
    const result = evaluateNegativeEvidence([
      negative({ type: 'hiring_freeze', severity: 0.95 }),
    ], new Date('2026-08-09T09:00:00.000Z'))

    expect(result.action).toBe('close')
    expect(result.scoreMultiplier).toBe(0)
    expect(result.confirmedReasons).toEqual([
      expect.objectContaining({
        code: 'HIRING_FREEZE_CONFIRMED',
        evidenceIds: ['101'],
      }),
    ])
  })

  it('never lets heuristic negative evidence block or close', () => {
    const result = evaluateNegativeEvidence([
      negative({
        type: 'procurement_barrier',
        classification: 'heuristic_negative',
        sourceKind: 'heuristic',
        severity: 1,
      }),
    ], new Date('2026-08-09T09:00:00.000Z'))

    expect(['reduce', 'review']).toContain(result.action)
    expect(result.action).not.toBe('block')
    expect(result.action).not.toBe('close')
    expect(result.heuristicReasons).toHaveLength(1)
  })

  it('can downgrade a previously high opportunity when new negative evidence arrives', () => {
    const negativeResult = evaluateNegativeEvidence([
      negative({
        type: 'large_internal_ta_capacity',
        severity: 0.8,
      }),
      negative({
        type: 'explicit_no_agencies',
        severity: 1,
        eventIds: ['202'],
        evidenceIds: ['102'],
      }),
    ], new Date('2026-08-09T09:00:00.000Z'))
    const result = applyNegativeEvidence({
      qualityScore: 0.9,
      status: 'qualified_actionable',
      negativeEvidence: negativeResult,
    })

    expect(result.qualityScore).toBe(0)
    expect(result.status).toBe('blocked')
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'EXPLICIT_NO_AGENCIES_CONFIRMED',
      'LARGE_INTERNAL_TA_CAPACITY_CONFIRMED',
    ]))
  })

  it('ignores expired negative evidence instead of making it permanent', () => {
    const result = evaluateNegativeEvidence([
      negative({
        type: 'budget_pause',
        severity: 1,
        validUntil: '2026-08-08T10:00:00.000Z',
      }),
    ], new Date('2026-08-09T09:00:00.000Z'))

    expect(result.action).toBe('none')
    expect(result.scoreMultiplier).toBe(1)
    expect(result.expiredEvidenceIds).toEqual(['101'])
  })
})
