import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  DATASET_KINDS,
  evaluateCommercialSignalDatasets,
} from './lib/commercial-signal-evaluation.mjs'

const args = process.argv.slice(2)
const format = optionValue(args, '--format') ?? 'json'
if (!['json', 'markdown'].includes(format)) {
  throw new TypeError('--format must be json or markdown.')
}
const suppliedPaths = optionValues(args, '--dataset')
const fixtureRoot = resolve(
  import.meta.dirname,
  '..',
  'fixtures',
  'commercial-signal-evaluation',
)
const paths = suppliedPaths.length > 0 ? suppliedPaths : [
  resolve(fixtureRoot, 'synthetic-contract-v1.json'),
  resolve(fixtureRoot, 'anonymized-labeled-v1.json'),
  resolve(fixtureRoot, 'holdout-v1.json'),
  resolve(fixtureRoot, 'production-shadow-v1.json'),
]
const datasets = await Promise.all(paths.map(async (path) =>
  JSON.parse(await readFile(resolve(path), 'utf8'))))
const report = evaluateCommercialSignalDatasets(datasets)

if (args.includes('--require-all-ready') &&
    report.datasets.some((dataset) => dataset.status !== 'ready')) {
  process.exitCode = 2
}
if (report.missingDatasetKinds.length > 0) process.exitCode = 2

process.stdout.write(format === 'markdown'
  ? renderMarkdown(report)
  : `${JSON.stringify(report, null, 2)}\n`)

function renderMarkdown(report) {
  const unavailableNotes = []
  const lines = [
    '# Commercial Signal Engine evaluation',
    '',
    `- Report schema: \`${report.schemaVersion}\``,
    `- Calibration: \`${report.calibrationStatus}\``,
    `- Required datasets: ${DATASET_KINDS.map((kind) => `\`${kind}\``).join(', ')}`,
    `- V3 vs V2 comparison: \`${report.comparison.status}\``,
    '',
    '| Dataset | Provenance | Status | Samples | Labeled | P@5 v2 | P@5 v3 | NDCG@10 v2 | NDCG@10 v3 |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ]
  for (const dataset of report.datasets) {
    lines.push([
      `| ${dataset.kind}`,
      dataset.provenance,
      dataset.dataStatus,
      dataset.absoluteCounts.samples,
      dataset.absoluteCounts.labeled,
      display(dataset.models.opportunity_v2.precisionAt5.value),
      display(dataset.models.opportunity_v3.precisionAt5.value),
      display(dataset.models.opportunity_v2.ndcgAt10.value),
      `${display(dataset.models.opportunity_v3.ndcgAt10.value)} |`,
    ].join(' | '))
    if (dataset.unavailableReason) {
      unavailableNotes.push(
        `- \`${dataset.kind}\`: ${dataset.unavailableReason}`,
      )
    }
  }
  if (unavailableNotes.length > 0) {
    lines.push('', 'Unavailable datasets:', '', ...unavailableNotes)
  }
  lines.push(
    '',
    'This report evaluates deterministic ranking contracts. It does not claim calibrated deal probabilities or authorize rollout.',
    '',
  )
  return lines.join('\n')
}

function display(value) {
  return value === null ? 'unavailable' : String(value)
}

function optionValue(input, name) {
  const index = input.indexOf(name)
  return index >= 0 ? input[index + 1] : null
}

function optionValues(input, name) {
  return input.flatMap((value, index) => value === name && input[index + 1]
    ? [input[index + 1]] : [])
}
