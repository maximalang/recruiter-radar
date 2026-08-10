import fs from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'
import {
  SAMPLING_POLICY,
  buildGoldSetDataset,
  renderLabelTemplateCsv,
  renderReviewCsv,
  renderReviewHtml,
  serializeDatasetJsonl,
} from './lib/commercial-signal-gold-set-v1.mjs'
import {
  attachManifestContractFingerprint,
  buildStrictBlindReviewPackage,
} from './lib/commercial-signal-gold-review-v1.mjs'
import {
  GOLD_SET_EXPORT_MAX_ELIGIBLE_ROWS,
  loadCommercialSignalGoldSetRows,
} from './lib/commercial-signal-gold-set-export-v1.mjs'

const { Pool } = pg
const args = process.argv.slice(2)
const workspaceId = required('--workspace-id')
const profileId = required('--profile-id')
const from = required('--from')
const to = required('--to')
const datasetVersion = required('--dataset-version')
const samplingPolicy = required('--sampling-policy')
const seed = required('--seed')
const outputDir = path.resolve(required('--output-dir'))
if (samplingPolicy !== SAMPLING_POLICY) {
  throw new TypeError(`--sampling-policy must be ${SAMPLING_POLICY}`)
}
const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required.')
const anonymizationKey = process.env.EVALUATION_ANONYMIZATION_KEY ?? ''
if (anonymizationKey.length < 32) {
  throw new Error('EVALUATION_ANONYMIZATION_KEY must contain at least 32 characters.')
}

await fs.mkdir(outputDir, { recursive: false }).catch((error) => {
  if (error?.code === 'EEXIST') {
    throw new Error('Output directory already exists; frozen review exports are append-by-new-version, never overwritten.')
  }
  throw error
})
const pool = new Pool({ connectionString, max: 1 })
let client = null
try {
  client = await pool.connect()
  await client.query('BEGIN TRANSACTION READ ONLY')
  await client.query("SET LOCAL statement_timeout = '30s'")
  const rawRows = await loadCommercialSignalGoldSetRows(client, {
    workspaceId, profileId, from, to,
  })
  await client.query('COMMIT')
  if (rawRows.length === 0) {
    throw new Error('No exact Opportunity v3 + Quality v2 snapshots exist for the requested workspace/profile/window; refusing to create an empty review package.')
  }
  if (rawRows.length > GOLD_SET_EXPORT_MAX_ELIGIBLE_ROWS) {
    throw new Error(`Gold-set export exceeds the ${GOLD_SET_EXPORT_MAX_ELIGIBLE_ROWS.toLocaleString('en-US')}-row safety limit.`)
  }
  const dataset = attachManifestContractFingerprint(buildGoldSetDataset(rawRows, {
    workspaceId, profileId, from, to, datasetVersion, samplingPolicy, seed,
    anonymizationKey, createdAt: to,
  }))
  const review = buildStrictBlindReviewPackage(dataset)
  await Promise.all([
    fs.writeFile(path.join(outputDir, 'frozen.jsonl'), serializeDatasetJsonl(dataset), { flag: 'wx' }),
    fs.writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(dataset.manifest, null, 2)}\n`, { flag: 'wx' }),
    fs.writeFile(path.join(outputDir, 'review.json'), `${JSON.stringify(review, null, 2)}\n`, { flag: 'wx' }),
    fs.writeFile(path.join(outputDir, 'review.csv'), renderReviewCsv(review), { flag: 'wx' }),
    fs.writeFile(path.join(outputDir, 'review.html'), renderReviewHtml(review), { flag: 'wx' }),
    fs.writeFile(path.join(outputDir, 'labels.csv'), renderLabelTemplateCsv(review), { flag: 'wx' }),
  ])
  process.stdout.write(`${JSON.stringify({
    ok:true,
    status:'READY_FOR_HUMAN_LABELING',
    outputDir,
    datasetVersion,
    sampleCount:dataset.rows.length,
    frozenFingerprint:dataset.manifest.frozenFingerprint,
    contractFingerprint:dataset.manifest.contractFingerprint,
    reviewerFile:'review.html',
    labelFile:'labels.csv',
    productionWrites:false,
  })}\n`)
} catch (error) {
  if (client) await client.query('ROLLBACK').catch(() => {})
  await fs.rm(outputDir, { recursive:true, force:true }).catch(() => {})
  throw error
} finally {
  client?.release()
  await pool.end()
}

function required(name) {
  const index = args.indexOf(name)
  const value = index >= 0 ? args[index + 1] : null
  if (!value || value.startsWith('--')) throw new TypeError(`${name} is required.`)
  return value
}
