import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim()

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required.')
}

const canaryIds = parseCanaryIds(process.env.AUTH_V2_CANARY_USER_IDS)
const trustedProxyConfiguration = parseTrustedProxyConfiguration(process.env)
const trustedClientAddressRequired =
  authRolloutRequiresTrustedClientAddress(canaryIds)
const trustedClientAddressNotReady =
  !trustedProxyConfiguration.valid
  || (
    trustedClientAddressRequired
    && !trustedProxyConfiguration.configured
  )
const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  statement_timeout: 30_000,
})

try {
  await pool.query('BEGIN TRANSACTION READ ONLY')

  const schema = await pool.query(`
    SELECT COUNT(*)::INTEGER AS "installedTables"
    FROM UNNEST(ARRAY[
      'users',
      'auth_challenges',
      'auth_sessions',
      'auth_security_events',
      'auth_rate_limit_buckets',
      'workspaces',
      'workspace_members',
      'workspace_invites',
      'account_deletion_requests',
      'user_passkeys'
    ]) AS expected(name)
    WHERE TO_REGCLASS('public.' || expected.name) IS NOT NULL
  `)
  const installedTables = schema.rows[0]?.installedTables ?? 0

  if (installedTables !== 10) {
    await pool.query('COMMIT')
    console.log(JSON.stringify({
      ok: false,
      blockingViolations: {
        schemaNotReady: 10 - installedTables,
        invalidCanaryConfiguration: canaryIds === null ? 1 : 0,
        trustedClientAddressNotReady:
          trustedClientAddressNotReady ? 1 : 0,
      },
      counters: {
        installedTables,
        expectedTables: 10,
      },
      configuration: safeConfiguration(
        canaryIds,
        trustedProxyConfiguration,
        trustedClientAddressRequired,
      ),
    }))
    process.exitCode = 2
  } else {
    const result = await pool.query(`
      WITH tenant_roots AS (
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
      )
      SELECT
        JSON_BUILD_OBJECT(
          'duplicateNormalizedIdentities', (
            SELECT COUNT(*)::INTEGER
            FROM (
              SELECT email_normalized
              FROM users
              WHERE email_normalized IS NOT NULL
                AND status <> 'deleted'
              GROUP BY email_normalized
              HAVING COUNT(*) > 1
            ) AS duplicate_identity
          ),
          'invalidNormalizedIdentities', (
            SELECT COUNT(*)::INTEGER
            FROM users
            WHERE email_normalized IS NOT NULL
              AND (
                email_verified_at IS NULL
                OR BTRIM(email_normalized) <> email_normalized
                OR OCTET_LENGTH(email_normalized) NOT BETWEEN 3 AND 254
                OR email_normalized !~ '^[^@[:space:]]+@[a-z0-9][a-z0-9.-]*[a-z0-9]$'
                OR split_part(email_normalized, '@', 2)
                   <> LOWER(split_part(email_normalized, '@', 2))
                OR split_part(email, '@', 1)
                   <> split_part(email_normalized, '@', 1)
                OR LOWER(split_part(email, '@', 2))
                   <> split_part(email_normalized, '@', 2)
              )
          ),
          'legacyFoldedIdentityIndexPresent', (
            SELECT CASE
              WHEN TO_REGCLASS('public.users_email_uidx') IS NULL THEN 0
              ELSE 1
            END
          ),
          'canonicalIdentityIndexMissing', (
            SELECT CASE
              WHEN TO_REGCLASS(
                'public.users_auth_v2_identity_active_uidx'
              ) IS NULL THEN 1
              ELSE 0
            END
          ),
          'activeAccountsWithoutNormalizedIdentity', (
            SELECT CASE
              WHEN $2::BOOLEAN THEN COUNT(*)::INTEGER
              ELSE 0
            END
            FROM users
            WHERE status = 'active'
              AND email_verified_at IS NOT NULL
              AND email_normalized IS NULL
          ),
          'workspaceWithoutBootstrapAccount', (
            SELECT COUNT(*)::INTEGER
            FROM workspaces AS workspace
            LEFT JOIN users AS account
              ON account.id = workspace.bootstrap_user_id
             AND account.status <> 'deleted'
            WHERE workspace.status <> 'deleted'
              AND account.id IS NULL
          ),
          'workspaceWithoutExactlyOneOwner', (
            SELECT COUNT(*)::INTEGER
            FROM (
              SELECT workspace.id
              FROM workspaces AS workspace
              LEFT JOIN workspace_members AS membership
                ON membership.workspace_id = workspace.id
               AND membership.role = 'owner'
               AND membership.status = 'active'
              WHERE workspace.status = 'active'
                AND workspace.deleted_at IS NULL
              GROUP BY workspace.id
              HAVING COUNT(membership.user_id) <> 1
            ) AS invalid_workspace
          ),
          'bootstrapMembershipMissing', (
            SELECT COUNT(*)::INTEGER
            FROM workspaces AS workspace
            LEFT JOIN workspace_members AS membership
              ON membership.workspace_id = workspace.id
             AND membership.user_id = workspace.bootstrap_user_id
             AND membership.status = 'active'
            WHERE workspace.status = 'active'
              AND workspace.deleted_at IS NULL
              AND membership.user_id IS NULL
          ),
          'tenantMembershipMissing', (
            SELECT COUNT(*)::INTEGER
            FROM tenant_roots AS tenant_root
            LEFT JOIN workspace_members AS membership
              ON membership.workspace_id = tenant_root.workspace_id
             AND membership.user_id = tenant_root.user_id
             AND membership.status = 'active'
            LEFT JOIN workspaces AS workspace
              ON workspace.id = tenant_root.workspace_id
             AND workspace.status = 'active'
             AND workspace.deleted_at IS NULL
            WHERE membership.user_id IS NULL
               OR workspace.id IS NULL
          ),
          'sessionWorkspaceMismatch', (
            SELECT COUNT(*)::INTEGER
            FROM auth_sessions AS session
            LEFT JOIN workspace_members AS membership
              ON membership.workspace_id = session.workspace_id
             AND membership.user_id = session.user_id
             AND membership.status = 'active'
            WHERE session.workspace_id IS NOT NULL
              AND membership.user_id IS NULL
          ),
          'profileRelationMismatch', (
            SELECT (
              SELECT COUNT(*)::INTEGER
              FROM notification_provider_accounts AS account
              JOIN client_profiles AS profile
                ON profile.id = account.client_profile_id
              WHERE account.owner_id <> profile.owner_id
                 OR account.workspace_id IS DISTINCT FROM profile.workspace_id
            ) + (
              SELECT COUNT(*)::INTEGER
              FROM opportunities AS opportunity
              JOIN client_profiles AS profile
                ON profile.id = opportunity.client_profile_id
              WHERE opportunity.owner_id <> profile.owner_id
                 OR opportunity.workspace_id IS DISTINCT FROM profile.workspace_id
            ) + (
              SELECT COUNT(*)::INTEGER
              FROM deliveries AS delivery
              JOIN leads AS lead ON lead.id = delivery.lead_id
              WHERE delivery.user_id <> lead.user_id
                 OR delivery.workspace_id IS DISTINCT FROM lead.workspace_id
            )
          ),
          'invalidCanaryConfiguration', $1::INTEGER
        ) AS "blockingViolations",
        JSON_BUILD_OBJECT(
          'activeAccountsWithoutNormalizedIdentity', (
            SELECT COUNT(*)::INTEGER
            FROM users
            WHERE status = 'active'
              AND email_verified_at IS NOT NULL
              AND email_normalized IS NULL
          ),
          'activeAccountsWithoutWorkspace', (
            SELECT COUNT(*)::INTEGER
            FROM users AS account
            WHERE account.status = 'active'
              AND NOT EXISTS (
                SELECT 1
                FROM workspace_members AS membership
                JOIN workspaces AS workspace
                  ON workspace.id = membership.workspace_id
                 AND workspace.status = 'active'
                 AND workspace.deleted_at IS NULL
                WHERE membership.user_id = account.id
                  AND membership.status = 'active'
              )
          ),
          'sessionsWithoutWorkspace', (
            SELECT COUNT(*)::INTEGER
            FROM auth_sessions
            WHERE workspace_id IS NULL
          ),
          'userChallengesWithoutWorkspace', (
            SELECT COUNT(*)::INTEGER
            FROM auth_challenges
            WHERE user_id IS NOT NULL
              AND workspace_id IS NULL
          ),
          'workspaceNullTenantRows', (
            SELECT
              (SELECT COUNT(*) FROM client_profiles WHERE workspace_id IS NULL)
              + (SELECT COUNT(*) FROM subscriptions WHERE workspace_id IS NULL)
              + (SELECT COUNT(*) FROM checkout_orders WHERE workspace_id IS NULL)
              + (SELECT COUNT(*) FROM pilot_enrollments WHERE workspace_id IS NULL)
              + (SELECT COUNT(*) FROM leads WHERE workspace_id IS NULL)
              + (SELECT COUNT(*) FROM deliveries WHERE workspace_id IS NULL)
              + (SELECT COUNT(*) FROM user_search_preferences WHERE workspace_id IS NULL)
              + (SELECT COUNT(*) FROM notification_provider_accounts WHERE workspace_id IS NULL)
              + (SELECT COUNT(*) FROM opportunities WHERE workspace_id IS NULL)
          )::INTEGER
        ) AS counters
    `, [
      canaryIds === null ? 1 : 0,
      process.env.AUTH_PLATFORM_V2_ENABLED === 'true',
    ])
    await pool.query('COMMIT')

    const blockingViolations = {
      ...result.rows[0].blockingViolations,
      trustedClientAddressNotReady:
        trustedClientAddressNotReady ? 1 : 0,
    }
    const ok = Object.values(blockingViolations)
      .every((count) => count === 0)
    console.log(JSON.stringify({
      ok,
      blockingViolations,
      counters: result.rows[0].counters,
      configuration: safeConfiguration(
        canaryIds,
        trustedProxyConfiguration,
        trustedClientAddressRequired,
      ),
    }))
    if (!ok) process.exitCode = 2
  }
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

function parseTrustedProxyConfiguration(env) {
  const header = env.AUTH_TRUSTED_PROXY_HEADER?.trim() ?? ''
  const hops = env.AUTH_TRUSTED_PROXY_HOPS?.trim() ?? ''

  if (!header) {
    return {
      configured: false,
      valid: hops === '',
      header: null,
      trustedHops: null,
    }
  }
  if (header === 'cf-connecting-ip' || header === 'x-real-ip') {
    return {
      configured: true,
      valid: hops === '',
      header: hops === '' ? header : null,
      trustedHops: null,
    }
  }
  if (
    header !== 'x-forwarded-for'
    || !/^[1-9]\d*$/.test(hops)
  ) {
    return {
      configured: true,
      valid: false,
      header: null,
      trustedHops: null,
    }
  }

  const trustedHops = Number(hops)
  if (!Number.isSafeInteger(trustedHops) || trustedHops > 10) {
    return {
      configured: true,
      valid: false,
      header: null,
      trustedHops: null,
    }
  }
  return {
    configured: true,
    valid: true,
    header,
    trustedHops,
  }
}

function authRolloutRequiresTrustedClientAddress(ids) {
  return (
    (Array.isArray(ids) && ids.length > 0)
    || [
      'AUTH_PLATFORM_V2_ENABLED',
      'AUTH_WORKSPACES_V2_ENABLED',
      'AUTH_ONBOARDING_V2_ENABLED',
      'AUTH_PASSKEYS_ENABLED',
      'AUTH_LEGACY_SESSION_MIGRATION_ENABLED',
      'AUTH_V2_SESSION_ROLLBACK_COMPAT_ENABLED',
    ].some((name) => process.env[name] === 'true')
  )
}

function safeConfiguration(
  ids,
  trustedProxy,
  clientAddressRequired,
) {
  return {
    platformEnabled: process.env.AUTH_PLATFORM_V2_ENABLED === 'true',
    workspacesEnabled: process.env.AUTH_WORKSPACES_V2_ENABLED === 'true',
    onboardingEnabled: process.env.AUTH_ONBOARDING_V2_ENABLED === 'true',
    passkeysEnabled: process.env.AUTH_PASSKEYS_ENABLED === 'true',
    rollbackCompatibilityEnabled:
      process.env.AUTH_V2_SESSION_ROLLBACK_COMPAT_ENABLED === 'true',
    canaryConfigurationValid: ids !== null,
    canaryUserCount: ids?.length ?? 0,
    trustedClientAddressRequired: clientAddressRequired,
    trustedProxyConfigured: trustedProxy.configured,
    trustedProxyConfigurationValid: trustedProxy.valid,
    trustedProxyHeader: trustedProxy.header,
    trustedProxyHops: trustedProxy.trustedHops,
  }
}
