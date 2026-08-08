import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import pg from 'pg'

import {
  COMMERCIAL_SIGNAL_ISOLATED_TEST_CLEANUP_SQL,
} from './lib/commercial-signal-isolated-test-cleanup.mjs'

const { Client } = pg

const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) throw new Error('DATABASE_URL is required.')
if (process.env.COMMERCIAL_SIGNAL_TEST_ROLLBACK_ACK !== 'isolated') {
  throw new Error(
    'Refusing Commercial Signal test rollback without COMMERCIAL_SIGNAL_TEST_ROLLBACK_ACK=isolated.',
  )
}

const migrationsDir = resolve(import.meta.dirname, '..', 'migrations')
const filenames = [
  '20260807180500_complete_query_plan_supply_metrics.down.sql',
  '20260807175500_extend_commercial_signal_annotation_taxonomy.down.sql',
  '20260807174500_extend_query_plan_yield_metrics.down.sql',
  '20260807173600_enforce_company_event_publication_append_only.down.sql',
  '20260807173500_restore_immutable_company_event_publications.down.sql',
  '20260807173000_harden_company_event_and_enrichment_lineage.down.sql',
  '20260807170000_add_commercial_signal_canary_runtime.down.sql',
]
const downSql = await Promise.all(
  filenames.map((filename) => readFile(resolve(migrationsDir, filename), 'utf8')),
)

const database = new Client({ connectionString: databaseUrl })
await database.connect()
try {
  for (let index = 0; index < downSql.length; index += 1) {
    await database.query(downSql[index])
    process.stdout.write(`Rolled back test dependency: ${filenames[index]}\n`)
  }
  await database.query(COMMERCIAL_SIGNAL_ISOLATED_TEST_CLEANUP_SQL)
  process.stdout.write('Removed retained Commercial Signal test schema.\n')
} finally {
  await database.end()
}
