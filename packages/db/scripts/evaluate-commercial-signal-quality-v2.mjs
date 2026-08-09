import { evaluateCommercialSignalV2 } from
  './lib/commercial-signal-evaluation-v2.mjs'

const hash = (character) => character.repeat(64)
const rows = Array.from({ length: 30 }, (_, offset) => {
  const index = offset + 1
  const relevant = index <= 12
  const month = index <= 9 ? '06' : index <= 19 ? '07' : '08'
  return {
    sampleKey: index.toString(16).padStart(64, '0'),
    agencyProfileKey: index % 2 === 0 ? hash('a') : hash('b'),
    decisionAt: `2026-${month}-01T00:00:00.000Z`,
    scores: {
      freshness: 1 - index / 40,
      vacancy_volume: index,
      fiur: 1 - index / 50,
      opportunity_v2: 1 - index / 45,
      opportunity_v3: relevant ? 0.82 - index / 100 : 0.38 + index / 1000,
      quality_engine_v2: relevant ? 0.98 - index / 200 : 0.16 + index / 2000,
    },
    qualityCoverage: 0.9,
    reviewLabel: relevant ? 'strong' : 'weak',
    status: relevant ? 'qualified_actionable' : 'review',
    friction: index % 3 === 0 ? 0.85 : 0.3,
    agencyFit: index % 4 === 0 ? 0.9 : 0.5,
    propensity: index % 4 === 0 ? 0.3 : 0.7,
    outcomeProjection: {
      version: 'opportunity-outcome-state-v1',
      candidateId: String(2000 + index),
      opportunityId: String(3000 + index),
      lineageId: String(4000 + index),
      lastEventId: String(1000 + index),
      lastEventAt: `2026-${month}-05T00:00:00.000Z`,
      repliedAt: index <= 8 ? `2026-${month}-02T00:00:00.000Z` : null,
      meetingAt: index <= 5 ? `2026-${month}-03T00:00:00.000Z` : null,
      wonAt: index <= 2 ? `2026-${month}-04T00:00:00.000Z` : null,
    },
    falseNegativeCategory: index === 20 ? 'coverage_gap' : null,
    evidenceObservedAt: ['2026-05-01T00:00:00.000Z'],
  }
})

process.stdout.write(`${JSON.stringify(evaluateCommercialSignalV2(rows, {
  provenance: 'synthetic_contract',
  evaluationAt: '2026-09-01T00:00:00.000Z',
}), null, 2)}\n`)
