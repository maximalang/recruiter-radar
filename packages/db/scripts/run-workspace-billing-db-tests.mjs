import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import pg from 'pg'

const { Client } = pg
const execFileAsync = promisify(execFile)
const databaseUrl = process.env.DATABASE_URL?.trim()

if (!databaseUrl) throw new Error('DATABASE_URL is required.')
if (process.env.WORKSPACE_BILLING_DISPOSABLE_DB_CONFIRMED !== 'true') {
  throw new Error(
    'WORKSPACE_BILLING_DISPOSABLE_DB_CONFIRMED=true is required before creating a disposable database.',
  )
}

const root = resolve(import.meta.dirname, '..', '..', '..')
const webRoot = resolve(root, 'apps', 'web')
const migrateScript = resolve(root, 'packages', 'db', 'scripts', 'migrate.mjs')
const jestScript = resolve(root, 'node_modules', 'jest', 'bin', 'jest.js')
const canonicalMigration = '20260809100000_add_canonical_entitlement_grants'
const workspaceMigration = '20260809110000_add_workspace_checkout_ownership'
const workspaceDownPath = resolve(
  root,
  'packages',
  'db',
  'migrations',
  `${workspaceMigration}.down.sql`,
)
const databaseName = `workspace_billing_${process.pid}_${Date.now()}`
const temporaryUrl = new URL(databaseUrl)
temporaryUrl.pathname = `/${databaseName}`
temporaryUrl.searchParams.delete('schema')
const admin = new Client({ connectionString: databaseUrl })
let databaseCreated = false
let fixture

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

async function run(command, args, cwd = root) {
  const result = await execFileAsync(command, args, {
    cwd,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: temporaryUrl.toString(),
      WORKSPACE_BILLING_DB_TEST: 'true',
    },
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}

await admin.connect()
try {
  await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`)
  databaseCreated = true
  fixture = new Client({ connectionString: temporaryUrl.toString() })
  await fixture.connect()
  await fixture.query(`
    CREATE TABLE schema_migrations (
      version TEXT NOT NULL PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await fixture.query(
    `INSERT INTO schema_migrations (version) VALUES ($1), ($2)`,
    [canonicalMigration, workspaceMigration],
  )
  await fixture.end()
  fixture = undefined
  await run(process.execPath, [migrateScript])

  fixture = new Client({ connectionString: temporaryUrl.toString() })
  await fixture.connect()
  const account = await fixture.query(`
    INSERT INTO users (email, email_normalized, email_verified_at, status)
    VALUES ('workspace-upgrade@example.test', 'workspace-upgrade@example.test', NOW(), 'active')
    RETURNING id::TEXT AS id
  `)
  const userId = account.rows[0].id
  const workspace = await fixture.query(
    `SELECT ensure_auth_user_workspace($1)::TEXT AS id`,
    [userId],
  )
  const workspaceId = workspace.rows[0].id
  await fixture.query(`
    WITH entitlement_window AS (
      SELECT NOW() - INTERVAL '1 day' AS starts_at,
             NOW() + INTERVAL '6 days' AS ends_at
    )
    INSERT INTO pilot_enrollments (
      user_id, workspace_id, status, starts_at, ends_at, activated_by
    )
    SELECT $1, $2, status::pilot_status, starts_at, ends_at, 'admin'
    FROM entitlement_window
    CROSS JOIN (VALUES ('active'), ('canceled')) AS history(status)
  `, [userId, workspaceId])
  const order = await fixture.query(`
    INSERT INTO checkout_orders (
      user_id, workspace_id, plan_code, amount_rub, currency, status,
      customer_name, customer_contact, payload
    ) VALUES ($1, $2, 'pilot', 1, 'RUB', 'paid', 'Legacy owner',
      'legacy@example.test', '{}'::JSONB)
    RETURNING id::TEXT AS id
  `, [userId, workspaceId])
  await fixture.query(`
    INSERT INTO checkout_order_entitlements (
      order_id, user_id, plan_code, duration_days, starts_at, ends_at
    ) VALUES ($1, $2, 'pilot', 7, NOW() - INTERVAL '1 day', NOW() + INTERVAL '6 days')
  `, [order.rows[0].id, userId])
  await fixture.query(
    `DELETE FROM schema_migrations WHERE version = ANY($1::TEXT[])`,
    [[canonicalMigration, workspaceMigration]],
  )
  await fixture.end()
  fixture = undefined

  await run(process.execPath, [migrateScript])
  await run(process.execPath, [migrateScript])

  fixture = new Client({ connectionString: temporaryUrl.toString() })
  await fixture.connect()
  const upgradedOrder = await fixture.query(`
    SELECT purchased_by_user_id::TEXT AS purchaser,
           workspace_id::TEXT AS workspace,
           entitlement_owner_id::TEXT AS owner
    FROM checkout_orders WHERE id = $1
  `, [order.rows[0].id])
  const upgradedGrant = await fixture.query(`
    SELECT workspace_id::TEXT AS workspace,
           entitlement_owner_id::TEXT AS owner,
           starts_at,
           ends_at
    FROM entitlement_grants
    WHERE user_id = $1 AND source = 'admin'
  `, [userId])
  if (
    upgradedOrder.rows[0]?.purchaser !== userId
    || upgradedOrder.rows[0]?.workspace !== workspaceId
    || upgradedOrder.rows[0]?.owner !== userId
    || upgradedGrant.rows[0]?.workspace !== workspaceId
    || upgradedGrant.rows[0]?.owner !== userId
  ) {
    throw new Error(`Existing workspace billing ownership was not backfilled exactly: ${JSON.stringify({
      userId,
      workspaceId,
      order: upgradedOrder.rows,
      grant: upgradedGrant.rows,
    })}`)
  }
  await fixture.end()
  fixture = undefined

  await run(process.execPath, [jestScript, '--runInBand'], webRoot)

  fixture = new Client({ connectionString: temporaryUrl.toString() })
  await fixture.connect()
  const rollbackWorkspace = await fixture.query(`
    INSERT INTO workspaces (name, slug, status)
    VALUES ('Rollback collision', $1, 'active')
    RETURNING id::TEXT AS id
  `, [`rollback-collision-${userId}`])
  const rollbackWorkspaceId = rollbackWorkspace.rows[0].id
  await fixture.query(`
    INSERT INTO workspace_members (workspace_id, user_id, role, status)
    VALUES ($1, $2, 'owner', 'active')
  `, [rollbackWorkspaceId, userId])
  await fixture.query(`
    INSERT INTO entitlement_grants (
      user_id, workspace_id, entitlement_owner_id, source, plan_code,
      features, starts_at, ends_at
    ) VALUES
      ($1, $2, $1, 'promo', 'rollback-a', ARRAY['dashboard'], NOW(), NOW() + INTERVAL '2 days'),
      ($1, $3, $1, 'promo', 'rollback-b', ARRAY['dashboard'], NOW(), NOW() + INTERVAL '3 days')
  `, [userId, workspaceId, rollbackWorkspaceId])
  try {
    await fixture.query(await readFile(workspaceDownPath, 'utf8'))
    throw new Error('Workspace billing down migration accepted ambiguous active grants.')
  } catch (error) {
    await fixture.query('ROLLBACK')
    if (error?.code !== '2BP01') throw error
  }
  const preservedScope = await fixture.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'entitlement_grants' AND column_name = 'workspace_id'
    ) AS preserved
  `)
  if (preservedScope.rows[0]?.preserved !== true) {
    throw new Error('Failed rollback removed scoped columns before rejecting ambiguity.')
  }
  await fixture.query(`
    UPDATE entitlement_grants
    SET status = 'revoked', revoked_at = NOW()
    WHERE workspace_id = $1 AND user_id = $2 AND source = 'promo'
  `, [rollbackWorkspaceId, userId])
  await fixture.query(await readFile(workspaceDownPath, 'utf8'))
  const rolledBack = await fixture.query(`
    SELECT
      NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'checkout_orders' AND column_name = 'purchased_by_user_id'
      ) AS order_columns_removed,
      NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'entitlement_grants' AND column_name = 'workspace_id'
      ) AS grant_columns_removed,
      is_nullable = 'YES' AS checkout_workspace_nullable
    FROM information_schema.columns
    WHERE table_name = 'checkout_orders' AND column_name = 'workspace_id'
  `)
  if (!Object.values(rolledBack.rows[0] ?? {}).every(Boolean)) {
    throw new Error(`Workspace billing down migration was incomplete: ${JSON.stringify(rolledBack.rows)}`)
  }
  console.log('Workspace billing upgrade, idempotency, runtime, and down checks passed.')
} finally {
  await fixture?.end().catch(() => undefined)
  if (databaseCreated) {
    await admin.query(
      `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`,
    ).catch(() => undefined)
  }
  await admin.end().catch(() => undefined)
}
