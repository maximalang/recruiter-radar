import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  DATASET_KINDS,
  FALSE_POSITIVE_CATEGORIES,
  MODEL_KEYS,
  evaluateCommercialSignalDatasets,
} from './lib/commercial-signal-evaluation.mjs'
import {
  anonymizeEvaluationRow,
  mapFalsePositiveReason,
} from './lib/commercial-signal-evaluation-export.mjs'

const root = resolve(
  import.meta.dirname,
  '..',
  'fixtures',
  'commercial-signal-evaluation',
)
const fixtureNames = [
  'synthetic-contract-v1.json',
  'anonymized-labeled-v1.json',
  'holdout-v1.json',
  'production-shadow-v1.json',
]
const fixtures = await Promise.all(fixtureNames.map(async (name) =>
  JSON.parse(await readFile(resolve(root, name), 'utf8'))))
const report = evaluateCommercialSignalDatasets(fixtures)

assert.deepEqual(report.missingDatasetKinds, [])
assert.equal(report.datasets.length, DATASET_KINDS.length)
assert.equal(report.calibrationStatus, 'uncalibrated_insufficient_real_outcomes')
assert.equal(report.comparison.status, 'contract_only')
assert.ok(report.comparison.deltas.precisionAt5 >= 0)
assert.ok(report.comparison.deltas.ndcgAt10 > 0)

const synthetic = report.datasets.find((dataset) =>
  dataset.kind === 'synthetic_contract')
assert.equal(synthetic.dataStatus, 'sufficient_data')
assert.equal(synthetic.absoluteCounts.samples, 12)
assert.equal(synthetic.coveragePerAgencyProfile.length, 2)
assert.ok(synthetic.coveragePerEpisodeType.length >= 3)
assert.ok(synthetic.sourceYield.length >= 4)
assert.ok(synthetic.queryPlanYield.length >= 4)
assert.equal(synthetic.falsePositiveTaxonomy.length, FALSE_POSITIVE_CATEGORIES.length)
for (const model of MODEL_KEYS) {
  assert.equal(synthetic.models[model].status, 'sufficient_data')
  assert.equal(typeof synthetic.models[model].precisionAt5.value, 'number')
  assert.equal(typeof synthetic.models[model].precisionAt10.value, 'number')
  assert.equal(typeof synthetic.models[model].ndcgAt10.value, 'number')
}

for (const unavailable of report.datasets.filter((dataset) =>
  dataset.kind !== 'synthetic_contract')) {
  assert.equal(unavailable.dataStatus, 'unavailable')
  assert.equal(unavailable.models.opportunity_v3.precisionAt5.value, null)
  assert.equal(unavailable.funnel.acceptedRate.value, null)
  assert.ok(unavailable.unavailableReason)
}

const reverseReport = evaluateCommercialSignalDatasets([
  { ...fixtures[0], rows: [...fixtures[0].rows].reverse() },
  ...fixtures.slice(1),
])
assert.deepEqual(reverseReport.datasets[0].models, synthetic.models)
assert.equal(reverseReport.datasets[0].contentHash, synthetic.contentHash)

assert.throws(() => evaluateCommercialSignalDatasets([
  {
    ...fixtures[0],
    rows: fixtures[0].rows.map((row, index) => index === 0 ? {
      ...row,
      labels: { ...row.labels, falsePositiveCategory: 'made_up_category' },
    } : row),
  },
]), /Unknown false-positive category/)

const realRows = fixtures[0].rows.slice(0, 2)
const labeled = {
  ...fixtures[1],
  status: 'ready',
  rows: realRows,
  minimumSample: 1,
  minimumLabeled: 1,
}
const holdout = {
  ...fixtures[2],
  status: 'ready',
  rows: [realRows[0]],
  minimumSample: 1,
  minimumLabeled: 1,
}
assert.throws(
  () => evaluateCommercialSignalDatasets([labeled, holdout]),
  /Holdout sample overlaps/,
)

const rawRow = {
  profileId: '10',
  episodeId: '20',
  opportunityId: '30',
  episodeType: 'vacancy_spike',
  sourceFamilies: ['hh'],
  observedAt: '2026-07-20T00:00:00.000Z',
  vacancyCount: 5,
  oldFiur: 0.5,
  opportunityV2: 0.6,
  opportunityV3: null,
  accepted: false,
  contacted: false,
  replied: false,
  meeting: false,
  dismissReasonCode: null,
  lostReasonCode: null,
  hasOutcome: false,
}
const exportKey = 'a'.repeat(32)
const observational = anonymizeEvaluationRow(
  rawRow,
  'anonymized_labeled',
  exportKey,
)
assert.deepEqual(observational.labels, {
  qualified: null,
  accepted: null,
  contacted: null,
  replied: null,
  meeting: null,
  falsePositiveCategory: null,
})
const dismissed = anonymizeEvaluationRow({
  ...rawRow,
  hasOutcome: true,
  dismissReasonCode: 'wrong_roles',
}, 'anonymized_labeled', exportKey)
assert.deepEqual(dismissed.labels, {
  qualified: false,
  accepted: false,
  contacted: false,
  replied: false,
  meeting: false,
  falsePositiveCategory: 'wrong_role',
})
const progressedLoss = anonymizeEvaluationRow({
  ...rawRow,
  hasOutcome: true,
  accepted: true,
  contacted: true,
  lostReasonCode: 'price',
}, 'anonymized_labeled', exportKey)
assert.equal(progressedLoss.labels.qualified, true)
assert.equal(progressedLoss.labels.falsePositiveCategory, null)
assert.equal(mapFalsePositiveReason('other'), null)

process.stdout.write(`${JSON.stringify({
  ok: true,
  checks: [
    'four_dataset_contracts',
    'five_required_baselines',
    'profile_scoped_precision_and_ndcg',
    'funnel_rates',
    'closed_false_positive_taxonomy',
    'profile_episode_source_query_coverage',
    'deterministic_ties_and_content_hash',
    'holdout_isolation',
    'no_false_calibration_claim',
    'unavailable_is_null_not_zero',
    'observational_outcomes_remain_unlabeled',
    'terminal_false_positive_mapping',
    'progressed_losses_are_not_false_positives',
  ],
})}\n`)
