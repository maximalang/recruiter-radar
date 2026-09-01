import fs from 'node:fs/promises'
import path from 'node:path'

const MAX_ROWS = 50
const TIME_ZONE = 'Europe/Moscow'
const LABELS = new Set(['accepted', 'badfit'])

export function parseArgs(argv) {
  const profileIds = []
  let from = null
  let to = null
  let outputDir = null
  let timeZone = TIME_ZONE
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--profile-id') profileIds.push(positiveId(argv[++index], 'profile-id'))
    else if (argument === '--from') from = isoTimestamp(argv[++index], 'from')
    else if (argument === '--to') to = isoTimestamp(argv[++index], 'to')
    else if (argument === '--output-dir') outputDir = String(argv[++index] ?? '').trim()
    else if (argument === '--timezone') timeZone = String(argv[++index] ?? '').trim()
    else throw new TypeError(`Unknown argument: ${argument}`)
  }
  if (profileIds.length === 0) throw new TypeError('At least one --profile-id is required.')
  if (!from || !to) throw new TypeError('--from and --to are required.')
  if (Date.parse(to) <= Date.parse(from)) throw new TypeError('--to must be later than --from.')
  if (!outputDir) throw new TypeError('--output-dir is required.')
  if (!/^[A-Za-z_]+\/[A-Za-z_]+$/.test(timeZone)) {
    throw new TypeError('--timezone must be an IANA area/location timezone.')
  }
  return { profileIds: [...new Set(profileIds)], from, to, outputDir, timeZone }
}

export function validateLabels(rows) {
  return rows.map((row, index) => {
    const label = row.label === '' || row.label === null ? null : row.label
    if (label !== null && !LABELS.has(label)) {
      throw new TypeError(`Row ${index + 1} has invalid label: ${label}`)
    }
    return { ...row, label }
  })
}

export function calculatePrecisionAt5(rows) {
  const labeled = rows.filter((row) => row.label !== null)
  if (labeled.length < Math.min(5, rows.length)) return null
  const top = rows.slice(0, 5)
  if (top.length === 0 || top.some((row) => row.label === null)) return null
  return Math.round((top.filter((row) => row.label === 'accepted').length / top.length) * 1_000_000) / 1_000_000
}

export async function exportLabelingSession({ connectionString, profileIds, from, to, outputDir, timeZone = TIME_ZONE }) {
  const { default: pg } = await import('pg')
  const { Pool } = pg
  const pool = new Pool({ connectionString, max: 1 })
  const client = await pool.connect()
  const resolvedOutputDir = path.resolve(outputDir)
  try {
    await fs.mkdir(resolvedOutputDir, { recursive: false })
    await client.query('BEGIN TRANSACTION READ ONLY')
    await client.query("SET LOCAL statement_timeout = '30s'")
    const result = await client.query(
      `WITH deduped AS (
         SELECT
           dc.id::TEXT AS candidate_id,
           dc.client_profile_id::TEXT AS profile_id,
           profile.agency_name,
           profile.target_city,
           profile.specialization,
           dc.org_id::TEXT AS organization_id,
           dc.source_display_name AS company_display_name,
           dc.total_score,
           COALESCE(dc.payload->>'confidence_gate', dc.payload->>'confidenceGate') AS confidence_gate,
           dc.source_families,
           dc.latest_published_at::TEXT AS latest_published_at,
           (dc.created_at AT TIME ZONE $3)::DATE::TEXT AS day,
           dc.payload->'evidence_titles' AS evidence_titles,
           dc.payload->'location_names' AS location_names,
           dc.payload->'source_record_urls' AS source_record_urls,
           jsonb_array_length(COALESCE(dc.payload->'contact_paths', '[]'::jsonb)) > 0 AS has_lawful_contact_path,
           ROW_NUMBER() OVER (
             PARTITION BY dc.client_profile_id, (dc.created_at AT TIME ZONE $3)::DATE, dc.org_id
             ORDER BY dc.total_score DESC, dc.created_at DESC, dc.id DESC
           ) AS dedupe_rank
         FROM digest_candidates dc
         JOIN client_profiles profile ON profile.id = dc.client_profile_id
         WHERE dc.client_profile_id = ANY($1::BIGINT[])
           AND dc.created_at >= $2::TIMESTAMPTZ
           AND dc.created_at < $4::TIMESTAMPTZ
       )
       SELECT *
       FROM deduped
       WHERE dedupe_rank = 1
       ORDER BY day DESC, profile_id, total_score DESC, candidate_id
       LIMIT $5`,
      [profileIds.map(Number), from, timeZone, to, MAX_ROWS],
    )
    await client.query('COMMIT')

    const rows = result.rows.map((row, index) => ({
      reviewOrder: index + 1,
      candidateId: row.candidate_id,
      profileId: row.profile_id,
      agencyName: row.agency_name,
      targetCity: row.target_city,
      specialization: row.specialization,
      day: row.day,
      organizationId: row.organization_id,
      companyDisplayName: row.company_display_name,
      totalScore: Number(row.total_score),
      confidenceGate: row.confidence_gate ?? null,
      sourceFamilies: row.source_families ?? [],
      latestPublishedAt: row.latest_published_at,
      evidenceTitles: row.evidence_titles ?? [],
      locationNames: row.location_names ?? [],
      sourceRecordUrls: row.source_record_urls ?? [],
      hasLawfulContactPath: row.has_lawful_contact_path === true,
      label: null,
      labelNote: null,
    }))

    if (rows.length === 0) {
      throw new Error('No matching digest candidates; refusing to create an empty labeling session.')
    }
    const manifest = {
      schemaVersion: 'manual-lead-labeling-v1',
      status: 'READY_FOR_HUMAN_LABELING',
      sampleCount: rows.length,
      maxSampleCount: MAX_ROWS,
      labeling: {
        allowedLabels: [...LABELS],
        instruction: 'accepted = relevant company opportunity for this profile; badfit = not a relevant opportunity.',
        precisionAt5: 'computed only after all first five rows have labels; null before labeling.',
      },
      sampling: {
        source: 'digest_candidates',
        dedupe: 'one highest-score candidate per profile + Europe/Moscow day + organization',
        order: 'day descending, profile ascending, score descending, candidate id ascending',
      },
      query: { profileIds, from, to, timeZone },
      productionWrites: false,
      precisionAt5: calculatePrecisionAt5(rows),
      rows,
    }
    await Promise.all([
      fs.writeFile(path.join(resolvedOutputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' }),
      fs.writeFile(path.join(resolvedOutputDir, 'labels.csv'), renderLabelsCsv(rows), { flag: 'wx' }),
    ])
    return {
      ok: true,
      status: manifest.status,
      sampleCount: rows.length,
      outputDir: resolvedOutputDir,
      precisionAt5: null,
      productionWrites: false,
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    await fs.rm(resolvedOutputDir, { recursive: true, force: true }).catch(() => undefined)
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

function renderLabelsCsv(rows) {
  const header = [
    'review_order', 'candidate_id', 'profile_id', 'agency_name', 'target_city',
    'specialization', 'day', 'organization_id', 'company_display_name', 'total_score',
    'confidence_gate', 'source_families', 'latest_published_at', 'evidence_titles',
    'location_names', 'source_record_urls', 'has_lawful_contact_path', 'label', 'label_note',
  ]
  const lines = [header.join(',')]
  for (const row of rows) {
    lines.push([
      row.reviewOrder, row.candidateId, row.profileId, row.agencyName, row.targetCity,
      row.specialization, row.day, row.organizationId, row.companyDisplayName, row.totalScore,
      row.confidenceGate, row.sourceFamilies.join('|'), row.latestPublishedAt,
      row.evidenceTitles.join('|'), row.locationNames.join('|'), row.sourceRecordUrls.join('|'),
      row.hasLawfulContactPath, row.label ?? '', row.labelNote ?? '',
    ].map(csvCell).join(','))
  }
  return `${lines.join('\n')}\n`
}

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function positiveId(value, label) {
  const normalized = String(value ?? '').trim()
  if (!/^[1-9]\d{0,18}$/.test(normalized) || BigInt(normalized) > 9223372036854775807n) {
    throw new TypeError(`--${label} must be a positive safe integer.`)
  }
  return normalized
}

function isoTimestamp(value, label) {
  const parsed = Date.parse(String(value ?? ''))
  if (!Number.isFinite(parsed)) throw new TypeError(`--${label} is invalid.`)
  return new Date(parsed).toISOString()
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const options = parseArgs(process.argv.slice(2))
    const connectionString = process.env.DATABASE_URL?.trim()
    if (!connectionString) throw new Error('DATABASE_URL is required for a read-only labeling export.')
    process.stdout.write(`${JSON.stringify(await exportLabelingSession({ connectionString, ...options }))}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
