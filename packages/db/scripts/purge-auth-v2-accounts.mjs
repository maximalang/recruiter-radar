import pg from 'pg'

const { Client } = pg
const args = new Set(process.argv.slice(2))
const apply = args.has('--apply')
const batchSize = readBatchSize(args)
const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required.')
}

const client = new Client({ connectionString: databaseUrl })

await client.connect()
try {
  if (!apply) {
    const eligible = await client.query(
      `SELECT COUNT(*)::INTEGER AS count
       FROM (
         SELECT request.id
         FROM account_deletion_requests AS request
         JOIN users AS account ON account.id = request.user_id
         WHERE request.status = 'pending'
           AND request.purge_after IS NOT NULL
           AND request.purge_after <= NOW()
           AND account.status = 'deletion_pending'
         ORDER BY request.purge_after, request.id
         LIMIT $1
       ) AS due`,
      [batchSize],
    )
    writeResult({
      mode: 'dry-run',
      eligible: eligible.rows[0]?.count ?? 0,
      processed: 0,
      batchSize,
    })
  } else {
    const processed = await purgeDueAccounts(client, batchSize)
    writeResult({
      mode: 'apply',
      eligible: processed,
      processed,
      batchSize,
    })
  }
} finally {
  await client.end()
}

async function purgeDueAccounts(database, limit) {
  await database.query('BEGIN')
  try {
    const due = await database.query(
      `SELECT
         request.id::TEXT AS "requestId",
         request.user_id::TEXT AS "userId"
       FROM account_deletion_requests AS request
       JOIN users AS account ON account.id = request.user_id
       WHERE request.status = 'pending'
         AND request.purge_after IS NOT NULL
         AND request.purge_after <= NOW()
         AND account.status = 'deletion_pending'
       ORDER BY request.purge_after, request.id
       LIMIT $1
       FOR UPDATE OF request SKIP LOCKED`,
      [limit],
    )

    for (const row of due.rows) {
      await purgeOneAccount(database, row.requestId, row.userId)
    }

    await database.query('COMMIT')
    return due.rowCount ?? 0
  } catch (error) {
    await database.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}

async function purgeOneAccount(database, requestId, userId) {
  const deletedEmail = `deleted+${userId}@deleted.invalid`

  await database.query(
    `UPDATE auth_sessions
     SET revoked_at = COALESCE(revoked_at, NOW()),
         revoke_reason = COALESCE(revoke_reason, 'account_unavailable')
     WHERE user_id = $1`,
    [userId],
  )
  await database.query(
    `UPDATE auth_challenges
     SET invalidated_at = CASE
           WHEN consumed_at IS NULL THEN COALESCE(invalidated_at, NOW())
           ELSE invalidated_at
         END,
         email_normalized = $2
     WHERE user_id = $1`,
    [userId, deletedEmail],
  )
  await database.query(
    `UPDATE workspace_invites
     SET email_normalized = $2
     WHERE accepted_by = $1`,
    [userId, deletedEmail],
  )
  await database.query(
    `UPDATE workspace_members
     SET status = 'removed',
         updated_at = GREATEST(updated_at, NOW())
     WHERE user_id = $1
       AND status <> 'removed'`,
    [userId],
  )
  await database.query(
    `UPDATE workspaces AS workspace
     SET status = 'deleted',
         deleted_at = NOW(),
         updated_at = GREATEST(workspace.updated_at, NOW())
     WHERE workspace.status = 'deletion_pending'
       AND workspace.deleted_at IS NULL
       AND EXISTS (
         SELECT 1
         FROM workspace_members AS ownership
         WHERE ownership.workspace_id = workspace.id
           AND ownership.user_id = $1
           AND ownership.role = 'owner'
       )
       AND NOT EXISTS (
         SELECT 1
         FROM workspace_members AS active_membership
         WHERE active_membership.workspace_id = workspace.id
           AND active_membership.status = 'active'
       )`,
    [userId],
  )
  const anonymized = await database.query(
    `UPDATE users AS account
     SET email = $2,
         email_normalized = $2,
         email_verified_at = NOW(),
         full_name = NULL,
         display_name = NULL,
         telegram_chat_id = NULL,
         telegram_username = NULL,
         onboarding_status = 'not_started',
         onboarding_step = NULL,
         onboarding_data = '{}'::JSONB,
         last_authenticated_at = NULL,
         status = 'deleted',
         deleted_at = NOW(),
         updated_at = NOW()
     WHERE account.id = $1
       AND account.status = 'deletion_pending'`,
    [userId, deletedEmail],
  )
  if ((anonymized.rowCount ?? 0) !== 1) {
    throw new Error(`Deletion-pending account ${userId} was not anonymized.`)
  }
  const completed = await database.query(
    `UPDATE account_deletion_requests
     SET status = 'completed',
         completed_at = NOW()
     WHERE id = $1
       AND user_id = $2
       AND status = 'pending'`,
    [requestId, userId],
  )
  if ((completed.rowCount ?? 0) !== 1) {
    throw new Error(`Deletion request ${requestId} was not completed.`)
  }
}

function readBatchSize(inputArgs) {
  const values = [...inputArgs]
  const unknown = values.filter(
    (value) => value !== '--apply' && !value.startsWith('--batch-size='),
  )
  if (unknown.length > 0) {
    throw new Error(`Unknown argument: ${unknown[0]}`)
  }
  const batchArgs = values.filter((value) => value.startsWith('--batch-size='))
  if (batchArgs.length > 1) {
    throw new Error('Provide --batch-size only once.')
  }
  const raw = batchArgs[0]?.slice('--batch-size='.length) ?? '100'
  if (!/^[1-9]\d{0,2}$/.test(raw)) {
    throw new Error('--batch-size must be an integer between 1 and 500.')
  }
  const parsed = Number(raw)
  if (parsed > 500) {
    throw new Error('--batch-size must be an integer between 1 and 500.')
  }
  return parsed
}

function writeResult(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
