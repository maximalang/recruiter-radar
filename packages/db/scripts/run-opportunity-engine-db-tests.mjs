import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import pg from 'pg'

const { Client } = pg
const execFileAsync = promisify(execFile)

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required.')

const root = resolve(import.meta.dirname, '..', '..', '..')
const migrateScript = resolve(root, 'packages', 'db', 'scripts', 'migrate.mjs')
const verifierScript = resolve(
  root,
  'packages',
  'db',
  'scripts',
  'verify-opportunity-engine-v1.mjs',
)
const upgradeVerifierScript = resolve(
  root,
  'packages',
  'db',
  'scripts',
  'verify-opportunity-authoritative-state-upgrade.mjs',
)
const outcomeRebuildVerifierScript = resolve(
  root,
  'packages',
  'db',
  'scripts',
  'verify-opportunity-outcome-rebuild.mjs',
)
const outcomeUpgradeVerifierScript = resolve(
  root,
  'packages',
  'db',
  'scripts',
  'verify-opportunity-outcome-hardening-upgrade.mjs',
)
const outcomeLifecycleUpgradeVerifierScript = resolve(
  root,
  'packages',
  'db',
  'scripts',
  'verify-opportunity-outcome-lifecycle-upgrade.mjs',
)
const outcomeCanaryScript = resolve(
  root,
  'packages',
  'db',
  'scripts',
  'canary-opportunity-outcomes.mjs',
)
const outcomePreflightScript = resolve(
  root,
  'packages',
  'db',
  'scripts',
  'preflight-opportunity-outcomes.mjs',
)
const jestScript = resolve(root, 'node_modules', 'jest', 'bin', 'jest.js')
const webRoot = resolve(root, 'apps', 'web')
const admin = new Client({ connectionString: databaseUrl })
const databaseName = `rr_opportunity_runtime_${process.pid}_${Date.now()}`
const upgradeDatabaseName = `rr_opportunity_upgrade_${process.pid}_${Date.now()}`
const outcomeMeetingUpgradeDatabaseName =
  `rr_outcome_meeting_upgrade_${process.pid}_${Date.now()}`
const outcomeChronologyUpgradeDatabaseName =
  `rr_outcome_chronology_upgrade_${process.pid}_${Date.now()}`
const temporaryUrl = new URL(databaseUrl)
temporaryUrl.pathname = `/${databaseName}`
const upgradeUrl = new URL(databaseUrl)
upgradeUrl.pathname = `/${upgradeDatabaseName}`
const outcomeMeetingUpgradeUrl = new URL(databaseUrl)
outcomeMeetingUpgradeUrl.pathname = `/${outcomeMeetingUpgradeDatabaseName}`
const outcomeChronologyUpgradeUrl = new URL(databaseUrl)
outcomeChronologyUpgradeUrl.pathname = `/${outcomeChronologyUpgradeDatabaseName}`
const testEnvironment = {
  ...process.env,
  DATABASE_URL: temporaryUrl.toString(),
  OPPORTUNITY_ENGINE_V1_ENABLED: 'true',
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

async function run(command, args, cwd = root, environment = testEnvironment) {
  const result = await execFileAsync(command, args, {
    cwd,
    env: environment,
    maxBuffer: 20 * 1024 * 1024,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}

await admin.connect()
try {
  await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`)
  await run(process.execPath, [migrateScript])
  await run(process.execPath, [verifierScript])
  await run(process.execPath, [
    jestScript,
    '--runInBand',
    '--runTestsByPath',
    'src/__tests__/lib/opportunities/runtime-db.test.ts',
  ], webRoot)
  await run(process.execPath, [
    jestScript,
    '--runInBand',
    '--runTestsByPath',
    'src/__tests__/lib/opportunities/outcome-runtime-db.test.ts',
  ], webRoot, {
    ...testEnvironment,
    OPPORTUNITY_OUTCOMES_ENABLED: 'true',
  })
  await run(process.execPath, [outcomeRebuildVerifierScript])
  const fixtureClient = new Client({
    connectionString: temporaryUrl.toString(),
  })
  await fixtureClient.connect()
  let fixtureOwnerId
  try {
    const fixtureOwner = await fixtureClient.query(
      `SELECT owner_id
       FROM opportunity_outcome_state
       ORDER BY owner_id
       LIMIT 1`,
    )
    fixtureOwnerId = fixtureOwner.rows[0]?.owner_id
  } finally {
    await fixtureClient.end()
  }
  if (!fixtureOwnerId) {
    throw new Error('Outcome runtime fixture did not create an owner.')
  }
  await run(
    process.execPath,
    [
      outcomePreflightScript,
      '--owner-id',
      String(fixtureOwnerId),
      '--json',
    ],
  )
  const canaryEnvironment = {
    ...testEnvironment,
    OPPORTUNITY_ENGINE_V1_ENABLED: 'false',
    OPPORTUNITY_OUTCOMES_ENABLED: 'false',
    OPPORTUNITY_OUTCOMES_UI_ENABLED: 'false',
    OPPORTUNITY_OUTCOMES_EXTERNAL_INGEST_ENABLED: 'false',
    OPPORTUNITY_CANARY_OWNER_IDS: '',
  }
  await run(
    process.execPath,
    [
      outcomeCanaryScript,
      '--owner-id',
      String(fixtureOwnerId),
      '--pre-activation',
    ],
    root,
    canaryEnvironment,
  )
  await run(
    process.execPath,
    [outcomeCanaryScript, '--owner-id', String(fixtureOwnerId)],
    root,
    {
      ...canaryEnvironment,
      OPPORTUNITY_CANARY_OWNER_IDS: String(fixtureOwnerId),
    },
  )
  await admin.query(
    `CREATE DATABASE ${quoteIdentifier(outcomeMeetingUpgradeDatabaseName)}`,
  )
  await run(process.execPath, [outcomeUpgradeVerifierScript], root, {
    ...process.env,
    DATABASE_URL: outcomeMeetingUpgradeUrl.toString(),
    OUTCOME_HARDENING_UPGRADE_CASE: 'valid-legacy-meeting',
  })
  await run(process.execPath, [outcomeLifecycleUpgradeVerifierScript], root, {
    ...process.env,
    DATABASE_URL: outcomeMeetingUpgradeUrl.toString(),
  })
  await admin.query(
    `CREATE DATABASE ${quoteIdentifier(outcomeChronologyUpgradeDatabaseName)}`,
  )
  await run(process.execPath, [outcomeUpgradeVerifierScript], root, {
    ...process.env,
    DATABASE_URL: outcomeChronologyUpgradeUrl.toString(),
    OUTCOME_HARDENING_UPGRADE_CASE: 'invalid-chronology',
  })
  await admin.query(`CREATE DATABASE ${quoteIdentifier(upgradeDatabaseName)}`)
  await run(process.execPath, [upgradeVerifierScript], root, {
    ...process.env,
    DATABASE_URL: upgradeUrl.toString(),
  })
} finally {
  await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`)
  await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(upgradeDatabaseName)} WITH (FORCE)`)
  await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(outcomeMeetingUpgradeDatabaseName)} WITH (FORCE)`)
  await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(outcomeChronologyUpgradeDatabaseName)} WITH (FORCE)`)
  await admin.end()
}
