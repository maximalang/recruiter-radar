import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim()
const argumentsList = process.argv.slice(2)

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required.')
}
if (
  argumentsList.length !== 1
  || !/^--user-id=[1-9]\d*$/.test(argumentsList[0])
) {
  throw new Error('Exactly one --user-id=<positive bigint> is required.')
}

const userId = argumentsList[0].slice('--user-id='.length)
const canaryIds = parseCanaryIds(process.env.AUTH_V2_CANARY_USER_IDS)
const configuration = {
  platformExplicitlyDisabled: process.env.AUTH_PLATFORM_V2_ENABLED === 'false',
  workspacesEnabled: process.env.AUTH_WORKSPACES_V2_ENABLED === 'true',
  onboardingEnabled: process.env.AUTH_ONBOARDING_V2_ENABLED === 'true',
  passkeysEnabled: process.env.AUTH_PASSKEYS_ENABLED === 'true',
  exactSingleCanary:
    canaryIds !== null
    && canaryIds.length === 1
    && canaryIds[0] === userId,
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  statement_timeout: 30_000,
})

try {
  await pool.query('BEGIN TRANSACTION READ ONLY')
  const result = await pool.query(`
    SELECT JSON_BUILD_OBJECT(
      'eligibleAccount', (
        SELECT COUNT(*)::INTEGER
        FROM users
        WHERE id = $1
          AND status = 'active'
          AND deleted_at IS NULL
          AND email_verified_at IS NOT NULL
          AND email_normalized IS NOT NULL
      ),
      'activeWorkspaces', (
        SELECT COUNT(*)::INTEGER
        FROM workspace_members AS membership
        JOIN workspaces AS workspace
          ON workspace.id = membership.workspace_id
         AND workspace.status = 'active'
         AND workspace.deleted_at IS NULL
        WHERE membership.user_id = $1
          AND membership.status = 'active'
      ),
      'bootstrapWorkspaces', (
        SELECT COUNT(*)::INTEGER
        FROM workspaces
        WHERE bootstrap_user_id = $1
          AND status = 'active'
          AND deleted_at IS NULL
      ),
      'invalidActiveSessions', (
        SELECT COUNT(*)::INTEGER
        FROM auth_sessions AS session
        LEFT JOIN workspace_members AS membership
          ON membership.workspace_id = session.workspace_id
         AND membership.user_id = session.user_id
         AND membership.status = 'active'
        WHERE session.user_id = $1
          AND session.revoked_at IS NULL
          AND session.idle_expires_at > NOW()
          AND session.absolute_expires_at > NOW()
          AND (
            session.workspace_id IS NULL
            OR membership.user_id IS NULL
          )
      ),
      'unscopedTenantRows', (
        SELECT
          (SELECT COUNT(*) FROM client_profiles
           WHERE owner_id = $1 AND workspace_id IS NULL)
          + (SELECT COUNT(*) FROM subscriptions
             WHERE user_id = $1 AND workspace_id IS NULL)
          + (SELECT COUNT(*) FROM checkout_orders
             WHERE user_id = $1 AND workspace_id IS NULL)
          + (SELECT COUNT(*) FROM pilot_enrollments
             WHERE user_id = $1 AND workspace_id IS NULL)
          + (SELECT COUNT(*) FROM leads
             WHERE user_id = $1 AND workspace_id IS NULL)
          + (SELECT COUNT(*) FROM deliveries
             WHERE user_id = $1 AND workspace_id IS NULL)
          + (SELECT COUNT(*) FROM user_search_preferences
             WHERE user_id = $1 AND workspace_id IS NULL)
          + (SELECT COUNT(*) FROM notification_provider_accounts
             WHERE owner_id = $1 AND workspace_id IS NULL)
          + (SELECT COUNT(*) FROM opportunities
             WHERE owner_id = $1 AND workspace_id IS NULL)
      )::INTEGER,
      'registeredPasskeys', (
        SELECT COUNT(*)::INTEGER
        FROM user_passkeys
        WHERE user_id = $1
      )
    ) AS checks
  `, [userId])
  await pool.query('COMMIT')

  const checks = result.rows[0].checks
  const configurationReady = Object.values(configuration).every(Boolean)
  const databaseReady =
    checks.eligibleAccount === 1
    && checks.activeWorkspaces >= 1
    && checks.bootstrapWorkspaces === 1
    && checks.invalidActiveSessions === 0
    && checks.unscopedTenantRows === 0
  const report = {
    ok: configurationReady && databaseReady,
    configuration,
    database: {
      eligibleAccountCount: checks.eligibleAccount,
      activeWorkspaceCount: checks.activeWorkspaces,
      bootstrapWorkspaceCount: checks.bootstrapWorkspaces,
      invalidActiveSessionCount: checks.invalidActiveSessions,
      unscopedTenantRowCount: checks.unscopedTenantRows,
      registeredPasskeyCount: checks.registeredPasskeys,
    },
  }
  console.log(JSON.stringify(report))
  if (!report.ok) process.exitCode = 2
} catch (error) {
  await pool.query('ROLLBACK').catch(() => {})
  throw error
} finally {
  await pool.end()
}

function parseCanaryIds(rawValue) {
  if (rawValue === undefined || rawValue === '') return []
  const ids = rawValue.split(',').map((value) => value.trim())
  if (
    ids.some((value) => !/^[1-9]\d*$/.test(value))
    || new Set(ids).size !== ids.length
  ) {
    return null
  }
  return ids
}
