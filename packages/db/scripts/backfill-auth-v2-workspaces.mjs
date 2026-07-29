import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim()
const apply = process.argv.includes('--apply')
const dryRun = !apply
const batchSize = parsePositiveInteger(
  readArgument('--batch-size')
    ?? process.env.AUTH_V2_WORKSPACE_BACKFILL_BATCH_SIZE,
  100,
  1_000,
)
const maxBatches = parsePositiveInteger(
  readArgument('--max-batches')
    ?? process.env.AUTH_V2_WORKSPACE_BACKFILL_MAX_BATCHES,
  10,
  10_000,
)

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required.')
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  statement_timeout: 60_000,
})

const candidateUsersSql = `
  SELECT app_user.id
  FROM users AS app_user
  WHERE EXISTS (
    SELECT 1 FROM client_profiles
    WHERE owner_id = app_user.id AND workspace_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM subscriptions
    WHERE user_id = app_user.id AND workspace_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM checkout_orders
    WHERE user_id = app_user.id AND workspace_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM pilot_enrollments
    WHERE user_id = app_user.id AND workspace_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM leads
    WHERE user_id = app_user.id AND workspace_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM deliveries
    WHERE user_id = app_user.id AND workspace_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM user_search_preferences
    WHERE user_id = app_user.id AND workspace_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM notification_provider_accounts
    WHERE owner_id = app_user.id AND workspace_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM opportunities
    WHERE owner_id = app_user.id AND workspace_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM auth_sessions
    WHERE user_id = app_user.id AND workspace_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM auth_challenges
    WHERE user_id = app_user.id AND workspace_id IS NULL
  )
`

try {
  const blockingViolations = await readBlockingViolations()
  if (Object.values(blockingViolations).some((count) => count !== 0)) {
    console.log(JSON.stringify({
      ok: false,
      dryRun,
      blockingViolations,
      message: 'Backfill refused because preflight found tenant conflicts.',
    }))
    process.exitCode = 2
  } else {
    const before = await countCandidates()

    if (dryRun) {
      console.log(JSON.stringify({
        ok: true,
        dryRun: true,
        batchSize,
        maxBatches,
        candidateUsers: before,
        changedRows: 0,
      }))
    } else {
      let processedUsers = 0
      let changedRows = 0
      let batches = 0

      while (batches < maxBatches) {
        await pool.query('BEGIN')
        try {
          const candidates = await pool.query(
            `${candidateUsersSql}
             ORDER BY app_user.id
             LIMIT $1
             FOR UPDATE OF app_user SKIP LOCKED`,
            [batchSize],
          )

          if (candidates.rowCount === 0) {
            await pool.query('COMMIT')
            break
          }

          for (const candidate of candidates.rows) {
            const result = await pool.query(
              `SELECT workspace_id::TEXT AS "workspaceId",
                      changed_rows::INTEGER AS "changedRows"
               FROM backfill_auth_workspace_user($1)`,
              [candidate.id],
            )
            changedRows += result.rows[0]?.changedRows ?? 0
          }

          await pool.query('COMMIT')
          processedUsers += candidates.rowCount
          batches += 1
        } catch (error) {
          await pool.query('ROLLBACK').catch(() => {})
          throw error
        }
      }

      const remainingCandidates = await countCandidates()
      console.log(JSON.stringify({
        ok: true,
        dryRun: false,
        batchSize,
        maxBatches,
        batches,
        processedUsers,
        changedRows,
        remainingCandidates,
        complete: remainingCandidates === 0,
      }))
    }
  }
} finally {
  await pool.end()
}

async function readBlockingViolations() {
  await pool.query('BEGIN TRANSACTION READ ONLY')
  try {
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
      ) AS violations
    `)
    await pool.query('COMMIT')
    return result.rows[0].violations
  } catch (error) {
    await pool.query('ROLLBACK').catch(() => {})
    throw error
  }
}

async function countCandidates() {
  const result = await pool.query(
    `SELECT COUNT(*)::INTEGER AS count
     FROM (${candidateUsersSql}) AS candidates`,
  )
  return result.rows[0].count
}

function readArgument(name) {
  const prefix = `${name}=`
  const inline = process.argv.find((argument) => argument.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function parsePositiveInteger(rawValue, fallback, maximum) {
  if (rawValue === undefined || rawValue === '') return fallback
  const value = Number(rawValue)
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`Expected an integer between 1 and ${maximum}.`)
  }
  return value
}
