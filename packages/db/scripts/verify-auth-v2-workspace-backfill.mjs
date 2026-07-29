import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim()

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required.')
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  statement_timeout: 30_000,
})

try {
  await pool.query('BEGIN TRANSACTION READ ONLY')
  const result = await pool.query(`
    WITH roots AS (
      SELECT 'clientProfiles' AS name,
             COUNT(*)::INTEGER AS total,
             COUNT(workspace_id)::INTEGER AS scoped
      FROM client_profiles
      UNION ALL
      SELECT 'subscriptions', COUNT(*)::INTEGER, COUNT(workspace_id)::INTEGER
      FROM subscriptions
      UNION ALL
      SELECT 'checkoutOrders', COUNT(*)::INTEGER, COUNT(workspace_id)::INTEGER
      FROM checkout_orders
      UNION ALL
      SELECT 'pilotEnrollments', COUNT(*)::INTEGER, COUNT(workspace_id)::INTEGER
      FROM pilot_enrollments
      UNION ALL
      SELECT 'leads', COUNT(*)::INTEGER, COUNT(workspace_id)::INTEGER
      FROM leads
      UNION ALL
      SELECT 'deliveries', COUNT(*)::INTEGER, COUNT(workspace_id)::INTEGER
      FROM deliveries
      UNION ALL
      SELECT 'searchPreferences', COUNT(*)::INTEGER, COUNT(workspace_id)::INTEGER
      FROM user_search_preferences
      UNION ALL
      SELECT 'providerAccounts', COUNT(*)::INTEGER, COUNT(workspace_id)::INTEGER
      FROM notification_provider_accounts
      UNION ALL
      SELECT 'opportunities', COUNT(*)::INTEGER, COUNT(workspace_id)::INTEGER
      FROM opportunities
      UNION ALL
      SELECT 'authSessions', COUNT(*)::INTEGER, COUNT(workspace_id)::INTEGER
      FROM auth_sessions
      UNION ALL
      SELECT 'authChallenges', COUNT(*)::INTEGER, COUNT(workspace_id)::INTEGER
      FROM auth_challenges
    ),
    mismatches AS (
      SELECT (
        SELECT COUNT(*)::INTEGER
        FROM notification_provider_accounts AS account
        JOIN client_profiles AS profile
          ON profile.id = account.client_profile_id
        WHERE account.owner_id <> profile.owner_id
           OR account.workspace_id <> profile.workspace_id
      ) + (
        SELECT COUNT(*)::INTEGER
        FROM opportunities AS opportunity
        JOIN client_profiles AS profile
          ON profile.id = opportunity.client_profile_id
        WHERE opportunity.owner_id <> profile.owner_id
           OR opportunity.workspace_id <> profile.workspace_id
      ) + (
        SELECT COUNT(*)::INTEGER
        FROM deliveries AS delivery
        JOIN leads AS lead ON lead.id = delivery.lead_id
        WHERE delivery.user_id <> lead.user_id
           OR delivery.workspace_id <> lead.workspace_id
      ) AS count
    ),
    guards AS (
      SELECT COUNT(*)::INTEGER AS count
      FROM pg_constraint
      WHERE conname = ANY(ARRAY[
        'client_profiles_workspace_member_fkey',
        'deliveries_lead_workspace_fkey',
        'notification_provider_accounts_profile_workspace_fkey',
        'opportunities_profile_workspace_fkey',
        'notification_endpoints_provider_profile_fkey',
        'notification_routes_endpoint_profile_fkey',
        'notification_jobs_route_context_fkey'
      ])
    )
    SELECT
      JSON_OBJECT_AGG(
        roots.name,
        JSON_BUILD_OBJECT('total', roots.total, 'scoped', roots.scoped)
      ) AS "rowCounts",
      BOOL_AND(roots.total = roots.scoped) AS "allRootsScoped",
      (SELECT count FROM mismatches) AS "mismatches",
      (SELECT count FROM guards) AS "guardCount"
    FROM roots
  `)
  await pool.query('COMMIT')

  const rowCounts = result.rows[0].rowCounts
  const noMismatches = result.rows[0].mismatches === 0
  const allRootsScoped = result.rows[0].allRootsScoped === true
  const guardsInstalled = result.rows[0].guardCount === 7

  const report = {
    ok: allRootsScoped && noMismatches && guardsInstalled,
    rowCountParity: {
      ok: allRootsScoped,
      tables: rowCounts,
    },
    workspaceParity: {
      ok: allRootsScoped && noMismatches,
      mismatches: result.rows[0].mismatches,
    },
    crossWorkspaceGuards: {
      ok: guardsInstalled,
      installed: result.rows[0].guardCount,
      expected: 7,
    },
    idempotentRerun: {
      ok: allRootsScoped,
      expectedChangedRows: allRootsScoped ? 0 : null,
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
