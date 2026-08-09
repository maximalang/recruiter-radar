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
    replied: index <= 8,
    meeting: index <= 5,
    won: index <= 2,
    falseNegativeCategory: index === 20 ? 'coverage_gap' : null,
    evidenceObservedAt: ['2026-05-01T00:00:00.000Z'],
  }
})

process.stdout.write(`${JSON.stringify(evaluateCommercialSignalV2(rows, {
  provenance: 'synthetic_contract',
}), null, 2)}\n`)
