import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim()

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required.')
}

const expectedTables = [
  'auth_challenges',
  'auth_sessions',
  'auth_security_events',
  'auth_rate_limit_buckets',
  'workspaces',
  'workspace_members',
  'workspace_invites',
  'account_deletion_requests',
  'user_passkeys',
]
const expectedFunctions = [
  'auth_security_metadata_is_safe',
  'reject_auth_security_event_mutation',
  'consume_auth_rate_limit',
  'issue_auth_login_challenge',
  'consume_auth_login_challenge',
  'ensure_auth_user_workspace',
  'assign_auth_workspace_context',
  'auth_workspace_resolve_user',
  'auth_workspace_resolve_profile',
  'auth_workspace_resolve_lead',
  'backfill_auth_workspace_user',
  'change_auth_session_workspace',
  'auth_lock_owner_writes',
  'auth_require_active_owner_write',
]
const expectedMigrations = [
  '20260728120000_add_auth_platform_v2_foundation',
  '20260728121000_add_auth_challenge_issuance',
  '20260728122000_add_auth_challenge_consumption',
  '20260729120000_add_auth_workspaces',
  '20260729121000_add_auth_workspace_tenant_context',
  '20260729121100_add_auth_workspace_tenant_indexes',
  '20260729121200_add_auth_workspace_tenant_guards',
  '20260729122000_add_auth_workspace_session_switch',
  '20260729130000_add_auth_account_security_and_team',
  '20260729131000_guard_auth_active_owner_writes',
  '20260729132000_add_auth_passkeys',
  '20260730100000_harden_auth_email_identity',
  '20260730101000_add_legacy_session_revocation',
]

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  statement_timeout: 30_000,
})

try {
  await pool.query('BEGIN TRANSACTION READ ONLY')
  const result = await pool.query(`
    SELECT
      (
        SELECT COUNT(*)::INTEGER
        FROM UNNEST($1::TEXT[]) AS expected(name)
        WHERE TO_REGCLASS('public.' || expected.name) IS NOT NULL
      ) AS "installedTables",
      (
        SELECT COUNT(DISTINCT procedure.proname)::INTEGER
        FROM pg_proc AS procedure
        JOIN pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND procedure.proname = ANY($2::TEXT[])
      ) AS "installedFunctions",
      (
        SELECT COUNT(*)::INTEGER
        FROM schema_migrations
        WHERE version = ANY($3::TEXT[])
      ) AS "appliedMigrations",
      (
        SELECT COUNT(*)::INTEGER
        FROM pg_constraint
        WHERE conname = ANY(ARRAY[
          'users_auth_v2_verified_identity_check',
          'auth_sessions_workspace_member_fkey',
          'auth_challenges_workspace_member_fkey',
          'workspace_members_role_check',
          'workspace_invites_send_status_check',
          'auth_security_events_metadata_safe_check',
          'user_passkeys_credential_id_key'
        ])
      ) AS "installedConstraints",
      (
        SELECT COUNT(*)::INTEGER
        FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgname = ANY(ARRAY[
            'auth_security_events_append_only',
            'auth_security_events_reject_truncate',
            'auth_sessions_assign_workspace',
            'auth_challenges_assign_workspace',
            'auth_sessions_invalidate_email_change_after_revoke'
          ])
      ) AS "installedTriggers",
      (
        SELECT COUNT(*)::INTEGER
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = ANY(ARRAY[
            'users_email_normalized_active_uidx',
            'users_auth_v2_identity_active_uidx',
            'auth_sessions_user_active_idx',
            'auth_security_events_type_created_idx',
            'workspace_members_user_active_idx',
            'workspace_invites_active_email_uidx',
            'account_deletion_requests_user_pending_uidx',
            'user_passkeys_user_activity_idx',
            'auth_security_events_legacy_revocation_uidx'
          ])
      ) AS "installedIndexes"
  `, [expectedTables, expectedFunctions, expectedMigrations])
  await pool.query('COMMIT')

  const counts = result.rows[0]
  const report = {
    ok:
      counts.installedTables === expectedTables.length
      && counts.installedFunctions === expectedFunctions.length
      && counts.appliedMigrations === expectedMigrations.length
      && counts.installedConstraints === 7
      && counts.installedTriggers === 5
      && counts.installedIndexes === 9,
    schema: {
      tables: {
        installed: counts.installedTables,
        expected: expectedTables.length,
      },
      functions: {
        installed: counts.installedFunctions,
        expected: expectedFunctions.length,
      },
      constraints: {
        installed: counts.installedConstraints,
        expected: 7,
      },
      triggers: {
        installed: counts.installedTriggers,
        expected: 5,
      },
      indexes: {
        installed: counts.installedIndexes,
        expected: 9,
      },
    },
    migrations: {
      applied: counts.appliedMigrations,
      expected: expectedMigrations.length,
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
