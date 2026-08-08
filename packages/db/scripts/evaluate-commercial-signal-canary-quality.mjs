import { readFile, stat } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import pg from 'pg'

import {
  evaluateCommercialSignalCanaryQuality,
  verifyCommercialSignalCanaryReceipt,
} from './lib/commercial-signal-canary-quality.mjs'

const { Client } = pg
const MAX_RECEIPTS = 20
const MAX_RECEIPT_BYTES = 2 * 1024 * 1024

export async function loadCanaryAnnotations({
  connectionString,
  workspaceId,
  lineageIds,
}) {
  if (lineageIds.length === 0) return []
  const client = new Client({ connectionString })
  await client.connect()
  try {
    const result = await client.query(
      `SELECT DISTINCT ON (
         annotation.lineage_id,
         annotation.reviewer_user_id
       )
         annotation.lineage_id::TEXT AS "lineageId",
         annotation.label,
         annotation.reason_code AS "reasonCode",
         annotation.review_set AS "reviewSet"
       FROM commercial_signal_annotations annotation
       WHERE annotation.workspace_id = $1
         AND annotation.review_set = 'canary'
         AND annotation.lineage_id = ANY($2::BIGINT[])
       ORDER BY
         annotation.lineage_id,
         annotation.reviewer_user_id,
         annotation.annotation_generation DESC,
         annotation.id DESC`,
      [workspaceId, lineageIds],
    )
    return result.rows
  } finally {
    await client.end()
  }
}

function parseArgs(argv) {
  const result = {
    workspaceId: null,
    receiptPaths: [],
    format: 'json',
    requirePass: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--workspace-id') result.workspaceId = argv[++index] ?? null
    else if (arg === '--receipt') result.receiptPaths.push(argv[++index] ?? '')
    else if (arg === '--format') result.format = argv[++index] ?? null
    else if (arg === '--require-pass') result.requirePass = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  result.workspaceId = positiveId(result.workspaceId, 'workspace')
  if (result.receiptPaths.length === 0 || result.receiptPaths.some(
    (value) => !String(value).trim(),
  )) throw new Error('At least one --receipt path is required.')
  if (result.receiptPaths.length > MAX_RECEIPTS) {
    throw new Error(`At most ${MAX_RECEIPTS} receipts may be evaluated at once.`)
  }
  if (!['json', 'markdown'].includes(result.format)) {
    throw new Error('--format must be json or markdown.')
  }
  return result
}

function renderMarkdown(report) {
  const rows = report.metrics.perRun.map((run) =>
    `| ${run.runId} | ${run.reviewed}/${run.selected} | ${display(run.precisionAt5)} |`)
  return [
    '# Commercial Signal canary quality gate',
    '',
    `- Status: \`${report.status}\``,
    `- Quality gate passed: \`${report.qualityGatePassed}\``,
    `- Wider rollout eligible for review: \`${report.widerRolloutEligibleForReview}\``,
    `- Automatic rollout authorized: \`${report.automaticRolloutAuthorized}\``,
    `- Completed runs: ${report.sample.completedRuns}`,
    `- Unique reviewed top-ranked opportunities: ${report.sample.uniqueReviewedTopRanked}`,
    `- Precision@5: ${display(report.metrics.precisionAt5)}`,
    `- Critical false positives in Today: ${report.metrics.criticalFalsePositivesInToday}`,
    '',
    '| Run | TOP-5 reviewed | Precision@5 |',
    '| --- | ---: | ---: |',
    ...rows,
    '',
    'Reason codes:',
    '',
    ...(report.reasonCodes.length > 0
      ? report.reasonCodes.map((code) => `- \`${code}\``)
      : ['- none']),
    '',
    'This gate does not tune weights, claim calibrated deal probabilities, or enable rollout by itself.',
    '',
  ].join('\n')
}

function display(value) {
  return value === null ? 'unavailable' : String(value)
}

function positiveId(value, label) {
  const normalized = String(value ?? '').trim()
  if (!/^[1-9]\d{0,18}$/.test(normalized) ||
      BigInt(normalized) > 9223372036854775807n) {
    throw new TypeError(`Invalid ${label} identifier.`)
  }
  return BigInt(normalized).toString()
}

async function readReceipt(path) {
  const metadata = await stat(path)
  if (!metadata.isFile() || metadata.size > MAX_RECEIPT_BYTES) {
    throw new Error(`Canary receipt is not a regular file below ${MAX_RECEIPT_BYTES} bytes.`)
  }
  return JSON.parse(await readFile(path, 'utf8'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArgs(process.argv.slice(2))
    const connectionString = process.env.DATABASE_URL?.trim()
    if (!connectionString) throw new Error('DATABASE_URL is required.')
    const receipts = await Promise.all(args.receiptPaths.map(readReceipt))
    for (const receipt of receipts) {
      const verification = verifyCommercialSignalCanaryReceipt(receipt)
      if (!verification.ok) {
        throw new Error(`Invalid canary receipt: ${verification.reasonCode}.`)
      }
    }
    const lineageIds = [...new Set(receipts.flatMap((receipt) =>
      receipt.topRanked.map((row) => row.lineageId)))]
    const annotations = await loadCanaryAnnotations({
      connectionString,
      workspaceId: args.workspaceId,
      lineageIds,
    })
    const report = evaluateCommercialSignalCanaryQuality({
      workspaceId: args.workspaceId,
      receipts,
      annotations,
    })
    process.stdout.write(args.format === 'markdown'
      ? renderMarkdown(report)
      : `${JSON.stringify(report, null, 2)}\n`)
    if (args.requirePass && !report.qualityGatePassed) process.exitCode = 2
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
