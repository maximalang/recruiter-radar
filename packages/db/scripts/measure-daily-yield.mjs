const TIME_ZONE = 'Europe/Moscow'
const ALLOWED_LAWFUL_SOURCE_FAMILIES = new Set(['egrul-fns', 'fedresurs'])
const POSITIVE_LAWFUL_REASON_KEYS = new Set([
  'reachability.career-page',
  'reachability.corporate-contact',
  'reachability.direct-surface',
])

export function parseArgs(argv) {
  const profileIds = []
  let from = null
  let to = null
  let timeZone = TIME_ZONE

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--profile-id') {
      profileIds.push(positiveId(argv[++index], 'profile-id'))
    } else if (argument === '--from') {
      from = isoTimestamp(argv[++index], 'from')
    } else if (argument === '--to') {
      to = isoTimestamp(argv[++index], 'to')
    } else if (argument === '--timezone') {
      timeZone = String(argv[++index] ?? '').trim()
      if (!/^[A-Za-z_]+\/[A-Za-z_]+$/.test(timeZone)) {
        throw new TypeError('--timezone must be an IANA area/location timezone.')
      }
    } else {
      throw new TypeError(`Unknown argument: ${argument}`)
    }
  }

  if (profileIds.length === 0) throw new TypeError('At least one --profile-id is required.')
  if (!from || !to) throw new TypeError('--from and --to are required.')
  if (Date.parse(to) <= Date.parse(from)) throw new TypeError('--to must be later than --from.')

  return { profileIds: [...new Set(profileIds)], from, to, timeZone }
}

export function deriveLawfulContactPathIndicator(row) {
  const payload = isObject(row.payload) ? row.payload : {}
  const contactPaths = Array.isArray(payload.contact_paths)
    ? payload.contact_paths
    : Array.isArray(payload.contactPaths)
      ? payload.contactPaths
      : []
  if (contactPaths.length > 0) return 'contact-surface'

  const reasons = Array.isArray(row.reasons) ? row.reasons : []
  if (reasons.some((reason) => isObject(reason) && POSITIVE_LAWFUL_REASON_KEYS.has(reason.key))) {
    return 'reason-derived'
  }
  const sourceFamilies = Array.isArray(row.source_families) ? row.source_families : []
  if (sourceFamilies.some((source) => ALLOWED_LAWFUL_SOURCE_FAMILIES.has(source))) {
    return 'registry-data'
  }
  return null
}

export function aggregateDailyYield(rows) {
  const deduped = new Map()
  for (const row of rows) {
    const key = `${row.profile_id}:${row.day}:${row.org_id}`
    const previous = deduped.get(key)
    if (!previous || compareCandidateRows(row, previous) < 0) deduped.set(key, row)
  }

  const daily = new Map()
  for (const row of deduped.values()) {
    const key = `${row.profile_id}:${row.day}`
    const bucket = daily.get(key) ?? {
      profileId: String(row.profile_id),
      day: row.day,
      candidateRowsAfterDedupe: 0,
      uniqueCompanies: 0,
      abGateCandidates: 0,
      unknownGateCandidates: 0,
      lawfulContactPathCandidates: 0,
    }
    bucket.candidateRowsAfterDedupe += 1
    bucket.uniqueCompanies += 1
    if (row.confidence_gate === 'A' || row.confidence_gate === 'B') bucket.abGateCandidates += 1
    if (!['A', 'B', 'C', 'D'].includes(row.confidence_gate ?? '')) bucket.unknownGateCandidates += 1
    if (deriveLawfulContactPathIndicator(row)) bucket.lawfulContactPathCandidates += 1
    daily.set(key, bucket)
  }

  return [...daily.values()]
    .sort((left, right) => left.profileId.localeCompare(right.profileId) || left.day.localeCompare(right.day))
    .map((bucket) => ({
      ...bucket,
      abGateShare: ratio(bucket.abGateCandidates, bucket.uniqueCompanies),
      lawfulContactPathShare: ratio(
        bucket.lawfulContactPathCandidates,
        bucket.uniqueCompanies,
      ),
    }))
}

export async function measureDailyYield({ connectionString, profileIds, from, to, timeZone = TIME_ZONE }) {
  const { default: pg } = await import('pg')
  const { Pool } = pg
  const pool = new Pool({ connectionString, max: 1 })
  const client = await pool.connect()
  try {
    await client.query('BEGIN TRANSACTION READ ONLY')
    await client.query("SET LOCAL statement_timeout = '30s'")
    const result = await client.query(
      `SELECT
         dc.id::TEXT AS candidate_id,
         dc.client_profile_id::TEXT AS profile_id,
         dc.org_id::TEXT AS org_id,
         dc.total_score,
         dc.created_at::TEXT AS created_at,
         (dc.created_at AT TIME ZONE $3)::DATE::TEXT AS day,
         COALESCE(dc.payload->>'confidence_gate', dc.payload->>'confidenceGate') AS confidence_gate,
         dc.source_families,
         dc.reasons,
         dc.payload
       FROM digest_candidates dc
       JOIN client_profiles profile ON profile.id = dc.client_profile_id
       WHERE dc.client_profile_id = ANY($1::BIGINT[])
         AND dc.created_at >= $2::TIMESTAMPTZ
         AND dc.created_at < $4::TIMESTAMPTZ
       ORDER BY dc.client_profile_id, day, dc.org_id, dc.total_score DESC, dc.created_at DESC, dc.id DESC`,
      [profileIds.map(Number), from, timeZone, to],
    )
    const profiles = await client.query(
      `SELECT id::TEXT AS "profileId", agency_name AS "agencyName",
              target_city AS "targetCity", specialization
       FROM client_profiles
       WHERE id = ANY($1::BIGINT[])
       ORDER BY id`,
      [profileIds.map(Number)],
    )
    await client.query('COMMIT')
    const daily = aggregateDailyYield(result.rows)
    return {
      schemaVersion: 'daily-yield-v1',
      measurementStatus: daily.length > 0 ? 'available' : 'unavailable_no_matching_digest_candidates',
      source: 'digest_candidates',
      from,
      to,
      timeZone,
      requestedProfileIds: profileIds,
      profiles: profiles.rows,
      daily,
      totals: summarizeTotals(daily),
      productionWrites: false,
      limitations: [
        'Counts scored digest candidates, not confirmed customer outcomes.',
        'Deduplication is per profile + local calendar day + org_id; the highest-score row represents a company for that day.',
        'A/B share uses persisted confidence_gate A or B; unknown/missing gates are reported separately.',
        'lawfulContactPath is derived from persisted contact_paths, reachability reasons, or registry source families.',
      ],
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

function summarizeTotals(daily) {
  const totals = daily.reduce((accumulator, row) => ({
    days: accumulator.days + 1,
    uniqueCompanies: accumulator.uniqueCompanies + row.uniqueCompanies,
    abGateCandidates: accumulator.abGateCandidates + row.abGateCandidates,
    lawfulContactPathCandidates:
      accumulator.lawfulContactPathCandidates + row.lawfulContactPathCandidates,
  }), {
    days: 0,
    uniqueCompanies: 0,
    abGateCandidates: 0,
    lawfulContactPathCandidates: 0,
  })
  return {
    ...totals,
    abGateShare: ratio(totals.abGateCandidates, totals.uniqueCompanies),
    lawfulContactPathShare: ratio(
      totals.lawfulContactPathCandidates,
      totals.uniqueCompanies,
    ),
  }
}

function compareCandidateRows(left, right) {
  return Number(right.total_score ?? 0) - Number(left.total_score ?? 0)
    || Date.parse(String(right.created_at ?? '')) - Date.parse(String(left.created_at ?? ''))
    || String(right.candidate_id).localeCompare(String(left.candidate_id))
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 1_000_000) / 1_000_000 : null
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
    if (!connectionString) throw new Error('DATABASE_URL is required for a read-only measurement.')
    const report = await measureDailyYield({ connectionString, ...options })
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
