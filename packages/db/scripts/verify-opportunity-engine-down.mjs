import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import pg from 'pg'

const { Client } = pg
const execFileAsync = promisify(execFile)

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required.')

const root = resolve(import.meta.dirname, '..', '..', '..')
const migrationsDir = resolve(root, 'packages', 'db', 'migrations')
const migrateScript = resolve(root, 'packages', 'db', 'scripts', 'migrate.mjs')
const downMigrations = [
  '20260727130000_fix_opportunity_hardening_edge_cases.down.sql',
  '20260727122000_add_opportunity_supersession.down.sql',
  '20260727121000_add_opportunity_episode_state.down.sql',
  '20260727120000_add_opportunity_engine_hardening.down.sql',
  '20260726130000_add_opportunity_engine_v1.down.sql',
]

const admin = new Client({ connectionString: databaseUrl })
const databaseName = `rr_opportunity_down_${process.pid}_${Date.now()}`
const temporaryUrl = new URL(databaseUrl)
temporaryUrl.pathname = `/${databaseName}`

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

await admin.connect()
try {
  await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`)
  await execFileAsync(process.execPath, [migrateScript], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: temporaryUrl.toString() },
  })

  const database = new Client({ connectionString: temporaryUrl.toString() })
  await database.connect()
  try {
    for (const migration of downMigrations) {
      await database.query(await readFile(resolve(migrationsDir, migration), 'utf8'))
    }
    const result = await database.query(
      `SELECT
         TO_REGCLASS('public.opportunities') AS opportunities,
         TO_REGCLASS('public.client_episode_state') AS client_episode_state`,
    )
    if (
      result.rows[0]?.opportunities !== null ||
      result.rows[0]?.client_episode_state !== null
    ) {
      throw new Error('Opportunity Engine down migrations left runtime tables behind.')
    }
  } finally {
    await database.end()
  }
  console.log(JSON.stringify({ ok: true, migrations: downMigrations.length }))
} finally {
  await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`)
  await admin.end()
}
