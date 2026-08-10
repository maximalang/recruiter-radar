import fs from 'node:fs/promises'
import path from 'node:path'
import {
  applyHumanReviews,
  parseDatasetJsonl,
  parseReviewCsv,
  serializeDatasetJsonl,
  summarizeReviews,
} from './lib/commercial-signal-gold-set-v1.mjs'

const args = process.argv.slice(2)
const datasetPath = path.resolve(required('--dataset'))
const labelsPath = path.resolve(required('--labels'))
const outputPath = path.resolve(required('--output'))
if (outputPath === datasetPath) {
  throw new Error('Gold-set revisions must be written to a new file; in-place mutation is forbidden.')
}
const dataset = parseDatasetJsonl(await fs.readFile(datasetPath, 'utf8'))
const reviews = parseReviewCsv(await fs.readFile(labelsPath, 'utf8'))
if (!reviews.length) throw new Error('No completed human labels found in the label file.')
const output = applyHumanReviews(dataset, reviews, {
  importedAt: option('--imported-at') ?? new Date().toISOString(),
})
await fs.writeFile(outputPath, serializeDatasetJsonl(output), { flag: 'wx' })
process.stdout.write(`${JSON.stringify({
  ok:true,
  output:outputPath,
  datasetVersion:output.manifest.datasetVersion,
  datasetRevision:output.manifest.datasetRevision,
  labelRevision:output.manifest.labelRevision,
  status:output.manifest.status,
  review:summarizeReviews([output]),
  qualityValidated:false,
})}\n`)

function required(name) {
  const value=option(name)
  if(!value) throw new TypeError(`${name} is required.`)
  return value
}
function option(name) {
  const index=args.indexOf(name)
  return index>=0 ? args[index+1] : null
}
