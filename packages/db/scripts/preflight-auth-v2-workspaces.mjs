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
  // Keep this command provably read-only: it is safe to run before every batch.
  await pool.query('BEGIN TRANSACTION READ ONLY')

  const schema = await pool.query(
    `SELECT
       TO_REGCLASS('public.workspaces') IS NOT NULL AS workspaces,
       TO_REGCLASS('public.workspace_members') IS NOT NULL AS members,
       COUNT(*) FILTER (
         WHERE column_name = 'workspace_id'
       )::INTEGER AS workspace_columns
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = ANY($1::TEXT[])`,
    [[
      'client_profiles',
      'subscriptions',
      'checkout_orders',
      'pilot_enrollments',
      'leads',
      'deliveries',
      'user_search_preferences',
      'notification_provider_accounts',
      'opportunities',
    ]],
  )
  const schemaReady = schema.rows[0]?.workspaces === true
    && schema.rows[0]?.members === true
    && schema.rows[0]?.workspace_columns === 9

  if (!schemaReady) {
    await pool.query('ROLLBACK')
    console.log(JSON.stringify({
      ok: false,
      blockingViolations: { schemaNotReady: 1 },
      counters: { workspaceNulls: {} },
    }))
    process.exitCode = 2
  } else {
    const result = await pool.query(`
      SELECT JSON_BUILD_OBJECT(
        'providerProfileOwnerMismatch', (
          SELECT COUNT(*)::INTEGER
          FROM notification_provider_accounts AS account
          JOIN client_profiles AS profile
            ON profile.id = account.client_profile_id
          WHERE profile.owner_id <> account.owner_id
        ),
        'opportunityProfileOwnerMismatch', (
          SELECT COUNT(*)::INTEGER
          FROM opportunities AS opportunity
          JOIN client_profiles AS profile
            ON profile.id = opportunity.client_profile_id
          WHERE profile.owner_id <> opportunity.owner_id
        ),
        'deliveryLeadOwnerMismatch', (
          SELECT COUNT(*)::INTEGER
          FROM deliveries AS delivery
          JOIN leads AS lead ON lead.id = delivery.lead_id
          WHERE lead.user_id <> delivery.user_id
        ),
        'profileWorkspaceMismatch', (
          SELECT COUNT(*)::INTEGER
          FROM notification_provider_accounts AS account
          JOIN client_profiles AS profile
            ON profile.id = account.client_profile_id
          WHERE account.workspace_id IS NOT NULL
            AND profile.workspace_id IS NOT NULL
            AND account.workspace_id <> profile.workspace_id
        ) + (
          SELECT COUNT(*)::INTEGER
          FROM opportunities AS opportunity
          JOIN client_profiles AS profile
            ON profile.id = opportunity.client_profile_id
          WHERE opportunity.workspace_id IS NOT NULL
            AND profile.workspace_id IS NOT NULL
            AND opportunity.workspace_id <> profile.workspace_id
        ),
        'leadWorkspaceMismatch', (
          SELECT COUNT(*)::INTEGER
          FROM deliveries AS delivery
          JOIN leads AS lead ON lead.id = delivery.lead_id
          WHERE delivery.workspace_id IS NOT NULL
            AND lead.workspace_id IS NOT NULL
            AND delivery.workspace_id <> lead.workspace_id
        ),
        'workspaceMembershipMissing', (
          SELECT COUNT(*)::INTEGER
          FROM (
            SELECT workspace_id, owner_id AS user_id
            FROM client_profiles
            WHERE workspace_id IS NOT NULL
            UNION ALL
            SELECT workspace_id, user_id FROM subscriptions
            WHERE workspace_id IS NOT NULL
            UNION ALL
            SELECT workspace_id, user_id FROM checkout_orders
            WHERE workspace_id IS NOT NULL
            UNION ALL
            SELECT workspace_id, user_id FROM pilot_enrollments
            WHERE workspace_id IS NOT NULL
            UNION ALL
            SELECT workspace_id, user_id FROM leads
            WHERE workspace_id IS NOT NULL
            UNION ALL
            SELECT workspace_id, user_id FROM deliveries
            WHERE workspace_id IS NOT NULL
            UNION ALL
            SELECT workspace_id, user_id FROM user_search_preferences
            WHERE workspace_id IS NOT NULL
            UNION ALL
            SELECT workspace_id, owner_id FROM notification_provider_accounts
            WHERE workspace_id IS NOT NULL
            UNION ALL
            SELECT workspace_id, owner_id FROM opportunities
            WHERE workspace_id IS NOT NULL
          ) AS tenant_root
          LEFT JOIN workspace_members AS membership
            ON membership.workspace_id = tenant_root.workspace_id
           AND membership.user_id = tenant_root.user_id
          LEFT JOIN workspaces AS workspace
            ON workspace.id = tenant_root.workspace_id
          WHERE membership.user_id IS NULL
             OR membership.status <> 'active'
             OR workspace.status <> 'active'
             OR workspace.deleted_at IS NOT NULL
        )
      ) AS "blockingViolations",
      JSON_BUILD_OBJECT(
        'clientProfiles', (
          SELECT COUNT(*)::INTEGER FROM client_profiles
          WHERE workspace_id IS NULL
        ),
        'subscriptions', (
          SELECT COUNT(*)::INTEGER FROM subscriptions
          WHERE workspace_id IS NULL
        ),
        'checkoutOrders', (
          SELECT COUNT(*)::INTEGER FROM checkout_orders
          WHERE workspace_id IS NULL
        ),
        'pilotEnrollments', (
          SELECT COUNT(*)::INTEGER FROM pilot_enrollments
          WHERE workspace_id IS NULL
        ),
        'leads', (
          SELECT COUNT(*)::INTEGER FROM leads
          WHERE workspace_id IS NULL
        ),
        'deliveries', (
          SELECT COUNT(*)::INTEGER FROM deliveries
          WHERE workspace_id IS NULL
        ),
        'searchPreferences', (
          SELECT COUNT(*)::INTEGER FROM user_search_preferences
          WHERE workspace_id IS NULL
        ),
        'providerAccounts', (
          SELECT COUNT(*)::INTEGER FROM notification_provider_accounts
          WHERE workspace_id IS NULL
        ),
        'opportunities', (
          SELECT COUNT(*)::INTEGER FROM opportunities
          WHERE workspace_id IS NULL
        )
      ) AS "workspaceNulls"
    `)
    await pool.query('COMMIT')

    const blockingViolations = result.rows[0].blockingViolations
    const ok = Object.values(blockingViolations)
      .every((count) => count === 0)

    console.log(JSON.stringify({
      ok,
      blockingViolations,
      counters: {
        workspaceNulls: result.rows[0].workspaceNulls,
      },
    }))
    if (!ok) process.exitCode = 2
  }
} catch (error) {
  await pool.query('ROLLBACK').catch(() => {})
  throw error
} finally {
  await pool.end()
}
