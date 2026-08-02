import pg from 'pg'

const { Client } = pg
const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) throw new Error('DATABASE_URL is required.')

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const dryRun = args.includes('--dry-run') || !apply
const workspaceIndex = args.indexOf('--workspace-id')
const workspaceId = workspaceIndex >= 0 ? args[workspaceIndex + 1] : null

if (apply && args.includes('--dry-run')) {
  throw new Error('Cannot combine --apply with --dry-run.')
}
if (workspaceId !== null && !/^[1-9]\d*$/.test(workspaceId)) {
  throw new Error('--workspace-id requires a positive integer.')
}
if (apply && !workspaceId) {
  throw new Error('--apply requires --workspace-id to prevent a global write.')
}

const allowed = new Set([
  '--apply',
  '--dry-run',
  '--workspace-id',
  ...(workspaceId ? [workspaceId] : []),
])
const unknown = args.find((argument) => !allowed.has(argument))
if (unknown) throw new Error(`Unknown argument: ${unknown}`)

const client = new Client({ connectionString: databaseUrl })
await client.connect()

try {
  const candidates = await client.query(
    `SELECT COUNT(*)::INTEGER AS count
     FROM client_profiles
     WHERE agency_dna_snapshot_hash IS NULL
       AND ($1::BIGINT IS NULL OR workspace_id = $1)`,
    [workspaceId],
  )
  let changed = 0

  if (apply) {
    await client.query('BEGIN')
    try {
      const updated = await client.query(
        `UPDATE client_profiles
         SET service_types = service_types
         WHERE agency_dna_snapshot_hash IS NULL
           AND workspace_id = $1
         RETURNING id`,
        [workspaceId],
      )
      changed = updated.rowCount ?? 0
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  }

  process.stdout.write(`${JSON.stringify({
    event: 'agency_dna.backfill_completed',
    mode: dryRun ? 'dry_run' : 'apply',
    workspaceScoped: Boolean(workspaceId),
    candidates: Number(candidates.rows[0]?.count ?? 0),
    changed,
  })}\n`)
} finally {
  await client.end()
}
