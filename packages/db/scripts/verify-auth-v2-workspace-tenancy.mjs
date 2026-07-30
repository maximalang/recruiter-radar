import { execFile } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import pg from 'pg'

import { executeMigrationSql } from './migration-execution.mjs'

const { Pool } = pg
const execFileAsync = promisify(execFile)
const databaseUrl = process.env.DATABASE_URL?.trim()
const targetMigration = '20260729121000_add_auth_workspace_tenant_context.sql'
const tenantMigrations = [
  targetMigration,
  '20260729121100_add_auth_workspace_tenant_indexes.sql',
  '20260729121200_add_auth_workspace_tenant_guards.sql',
]
const rollbackFile =
  '20260729121000_add_auth_workspace_tenant_context.down.sql'

if (!databaseUrl) throw new Error('DATABASE_URL is required.')
if (process.env.AUTH_V2_DB_TEST_ISOLATED !== 'true') {
  throw new Error('AUTH_V2_DB_TEST_ISOLATED=true is required.')
}

const root = resolve(import.meta.dirname, '..', '..', '..')
const migrationsDir = resolve(root, 'packages', 'db', 'migrations')
const scriptsDir = resolve(root, 'packages', 'db', 'scripts')
const pool = new Pool({ connectionString: databaseUrl, max: 4 })

try {
  const databaseName = await pool.query('SELECT CURRENT_DATABASE() AS name')
  if (!/^auth_v2_test_workspace_tenancy_[a-z0-9_]+$/.test(
    databaseName.rows[0]?.name ?? '',
  )) {
    throw new Error(
      'Refusing to run outside auth_v2_test_workspace_tenancy_<suffix>.',
    )
  }

  const migrations = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql') && !file.endsWith('.down.sql'))
    .sort()
  for (const filename of migrations) {
    if (filename >= targetMigration) break
    await pool.query(await readFile(resolve(migrationsDir, filename), 'utf8'))
  }

  const fixture = await seedLegacyTenant()
  const beforeCounts = await readRootCounts()
  const beforeIdentity = await readIdentitySnapshot(fixture)
  const beforeOutcomeChecksum = await readOutcomeChecksum()

  for (const filename of tenantMigrations) {
    const sql = await readFile(resolve(migrationsDir, filename), 'utf8')
    await executeMigrationSql(pool, sql)
  }

  const preflight = await runTool('preflight-auth-v2-workspaces.mjs')
  if (!preflight.ok) {
    throw new Error('Workspace preflight rejected a valid legacy fixture.')
  }
  if (!Object.values(preflight.counters.workspaceNulls)
    .some((count) => count > 0)) {
    throw new Error('Preflight did not report legacy workspace nulls.')
  }

  const dryRun = await runTool('backfill-auth-v2-workspaces.mjs')
  if (
    !dryRun.ok
    || dryRun.dryRun !== true
    || dryRun.candidateUsers !== 1
    || dryRun.changedRows !== 0
  ) {
    throw new Error('Workspace backfill dry-run contract failed.')
  }
  const afterDryRunNulls = await countWorkspaceNulls()
  if (afterDryRunNulls === 0) {
    throw new Error('Workspace dry-run unexpectedly wrote tenant context.')
  }

  const applied = await runTool(
    'backfill-auth-v2-workspaces.mjs',
    '--apply',
    '--batch-size=1',
    '--max-batches=2',
  )
  if (
    !applied.ok
    || applied.dryRun !== false
    || applied.complete !== true
    || applied.processedUsers !== 1
    || applied.changedRows !== 9
  ) {
    throw new Error('Workspace backfill apply contract failed.')
  }

  const verified = await runTool('verify-auth-v2-workspace-backfill.mjs')
  if (
    !verified.ok
    || !verified.rowCountParity.ok
    || !verified.workspaceParity.ok
    || !verified.crossWorkspaceGuards.ok
  ) {
    throw new Error('Workspace parity verification failed.')
  }
  const anonymousChallenge = await pool.query(
    `SELECT
       challenge.user_id IS NULL AS "userUnbound",
       challenge.workspace_id IS NULL AS "workspaceUnbound"
     FROM auth_challenges AS challenge
     WHERE challenge.email_normalized =
       'anonymous-workspace-signup@example.invalid'`,
  )
  if (
    anonymousChallenge.rows[0]?.userUnbound !== true
    || anonymousChallenge.rows[0]?.workspaceUnbound !== true
  ) {
    throw new Error('Anonymous signup challenge gained tenant authority.')
  }

  const rerun = await runTool(
    'backfill-auth-v2-workspaces.mjs',
    '--apply',
    '--batch-size=1',
  )
  if (
    !rerun.ok
    || rerun.processedUsers !== 0
    || rerun.changedRows !== 0
    || rerun.remainingCandidates !== 0
  ) {
    throw new Error('Workspace backfill was not idempotent.')
  }

  const afterCounts = await readRootCounts()
  const afterIdentity = await readIdentitySnapshot(fixture)
  const afterOutcomeChecksum = await readOutcomeChecksum()
  if (JSON.stringify(afterCounts) !== JSON.stringify(beforeCounts)) {
    throw new Error('Workspace backfill changed tenant root row counts.')
  }
  if (JSON.stringify(afterIdentity) !== JSON.stringify(beforeIdentity)) {
    throw new Error('Workspace backfill changed stable tenant identities.')
  }
  if (afterOutcomeChecksum !== beforeOutcomeChecksum) {
    throw new Error('Workspace backfill changed outcome ledger history.')
  }

  await verifyCrossWorkspaceGuards(fixture)

  const beforeRollbackCounts = await readRootCounts()
  const rollback = await readFile(resolve(migrationsDir, rollbackFile), 'utf8')
  await pool.query(rollback)
  const reverse = await pool.query(`
    SELECT
      NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'client_profiles'
          AND column_name = 'workspace_id'
      ) AS columns_removed,
      TO_REGCLASS('public.workspaces') IS NOT NULL AS foundation_preserved
  `)
  const reversedCounts = await readRootCounts()
  if (
    reverse.rows[0]?.columns_removed !== true
    || reverse.rows[0]?.foundation_preserved !== true
    || JSON.stringify(reversedCounts) !== JSON.stringify(beforeRollbackCounts)
  ) {
    throw new Error('Workspace tenant-context reverse path lost legacy data.')
  }

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'legacy_upgrade',
      'read_only_preflight',
      'dry_run_no_writes',
      'batched_apply',
      'row_count_parity',
      'anonymous_signup_challenge_allowed',
      'stable_identity_parity',
      'outcome_ledger_unchanged',
      'cross_workspace_guards',
      'idempotent_rerun',
      'clean_reverse',
    ],
  }))
} finally {
  await pool.end()
}

async function seedLegacyTenant() {
  const user = await pool.query(
    `INSERT INTO users (
       email,
       email_normalized,
       email_verified_at,
       created_at,
       updated_at
     )
     VALUES (
       'workspace-tenancy@example.invalid',
       'workspace-tenancy@example.invalid',
       NOW(),
       NOW(),
       NOW()
     )
     RETURNING id::TEXT AS id`,
  )
  const userId = user.rows[0].id
  await pool.query(
    `INSERT INTO auth_challenges (
       purpose,
       email_normalized,
       token_hash,
       send_status,
       expires_at,
       created_at
     )
     VALUES (
       'signup',
       'anonymous-workspace-signup@example.invalid',
       repeat('f', 64),
       'sent',
       NOW() + INTERVAL '10 minutes',
       NOW()
     )`,
  )
  const profile = await pool.query(
    `INSERT INTO client_profiles (agency_name, owner_id)
     VALUES ('Workspace tenancy fixture', $1)
     RETURNING id::TEXT AS id`,
    [userId],
  )
  const organization = await pool.query(
    `INSERT INTO orgs (name, domain)
     VALUES ('Workspace tenancy fixture', 'workspace-tenancy.example.invalid')
     RETURNING id::TEXT AS id`,
  )

  await pool.query(
    `INSERT INTO subscriptions (user_id, plan_code)
     VALUES ($1, 'workspace-fixture')`,
    [userId],
  )
  await pool.query(
    `INSERT INTO checkout_orders (
       user_id,
       plan_code,
       amount_rub,
       status
     )
     VALUES ($1, 'workspace-fixture', 1000, 'created')`,
    [userId],
  )
  await pool.query(
    `INSERT INTO pilot_enrollments (user_id, status)
     VALUES ($1, 'requested')`,
    [userId],
  )
  const lead = await pool.query(
    `INSERT INTO leads (user_id, org_id)
     VALUES ($1, $2)
     RETURNING id::TEXT AS id`,
    [userId, organization.rows[0].id],
  )
  await pool.query(
    `INSERT INTO deliveries (lead_id, user_id, telegram_chat_id)
     VALUES ($1, $2, 900000001)`,
    [lead.rows[0].id, userId],
  )
  await pool.query(
    `INSERT INTO user_search_preferences (user_id, source, params)
     VALUES ($1, 'hh', '{"text":"fixture"}'::JSONB)`,
    [userId],
  )
  const provider = await pool.query(
    `INSERT INTO notification_provider_accounts (
       owner_id,
       client_profile_id,
       provider,
       auth_mode,
       display_name,
       status,
       external_account_id,
       secret_ciphertext
     )
     VALUES (
       $1,
       $2,
       'webhook',
       'hmac',
       'Workspace fixture',
       'active',
       'workspace-fixture-provider',
       'fixture-ciphertext'
     )
     RETURNING id::TEXT AS id, public_id::TEXT AS "publicId"`,
    [userId, profile.rows[0].id],
  )
  const endpoint = await pool.query(
    `INSERT INTO notification_endpoints (
       provider_account_id,
       client_profile_id,
       endpoint_type,
       status,
       destination_id
     )
     VALUES ($1, $2, 'generic_webhook', 'active', 'fixture-endpoint')
     RETURNING id::TEXT AS id`,
    [provider.rows[0].id, profile.rows[0].id],
  )
  const route = await pool.query(
    `INSERT INTO notification_routes (
       endpoint_id,
       client_profile_id,
       event_kind
     )
     VALUES ($1, $2, 'daily_digest')
     RETURNING id::TEXT AS id`,
    [endpoint.rows[0].id, profile.rows[0].id],
  )
  const job = await pool.query(
    `INSERT INTO notification_delivery_jobs (
       client_profile_id,
       route_id,
       endpoint_id,
       provider_account_id,
       event_kind,
       idempotency_key
     )
     VALUES ($1, $2, $3, $4, 'daily_digest', 'workspace-fixture-job')
     RETURNING id::TEXT AS id`,
    [
      profile.rows[0].id,
      route.rows[0].id,
      endpoint.rows[0].id,
      provider.rows[0].id,
    ],
  )

  const episode = await pool.query(
    `INSERT INTO hiring_episodes (
       organization_id,
       episode_type,
       episode_key,
       episode_identity,
       episode_generation,
       title,
       summary,
       started_at,
       last_seen_at,
       signal_count,
       vacancy_count,
       strength_score,
       freshness_score,
       evidence_hash,
       engine_version
     )
     VALUES (
       $1,
       'role_cluster',
       'workspace-fixture',
       'workspace-fixture',
       1,
       'Workspace fixture',
       'Workspace fixture',
       NOW(),
       NOW(),
       1,
       1,
       0.5,
       0.5,
       repeat('a', 64),
       'hiring-episode-v1'
     )
     RETURNING id::TEXT AS id`,
    [organization.rows[0].id],
  )
  const opportunity = await pool.query(
    `INSERT INTO opportunities (
       owner_id,
       client_profile_id,
       organization_id,
       hiring_episode_id,
       status,
       title,
       why_now,
       problem_hypothesis,
       recommended_angle,
       recommended_persona,
       recommended_action,
       agency_fit_score,
       hiring_intent_score,
       agency_propensity_score,
       timing_score,
       reachability_score,
       confidence_score,
       opportunity_score,
       confidence_gate,
       scoring_version,
       evidence_hash,
       valid_until,
       episode_evidence_hash,
       profile_snapshot_hash,
       fiur_version,
       scoring_config_hash,
       brief_builder_version,
       input_hash
     )
     VALUES (
       $1,
       $2,
       $3,
       $4,
       'new',
       'Workspace fixture',
       'Fixture',
       'Fixture',
       'Fixture',
       'Fixture',
       'Fixture',
       0.5,
       0.5,
       0.5,
       0.5,
       0.5,
       0.5,
       0.5,
       'B',
       'workspace-fixture-v1',
       repeat('b', 64),
       NOW() + INTERVAL '1 day',
       repeat('b', 64),
       repeat('c', 64),
       'fiur-v1',
       repeat('d', 64),
       'opportunity-brief-v1',
       repeat('e', 64)
     )
     RETURNING id::TEXT AS id`,
    [
      userId,
      profile.rows[0].id,
      organization.rows[0].id,
      episode.rows[0].id,
    ],
  )

  return {
    userId,
    profileId: profile.rows[0].id,
    leadId: lead.rows[0].id,
    providerId: provider.rows[0].id,
    providerPublicId: provider.rows[0].publicId,
    endpointId: endpoint.rows[0].id,
    routeId: route.rows[0].id,
    jobId: job.rows[0].id,
    opportunityId: opportunity.rows[0].id,
  }
}

async function verifyCrossWorkspaceGuards(fixture) {
  const foreign = await pool.query(
    `INSERT INTO users (
       email,
       email_normalized,
       email_verified_at,
       created_at,
       updated_at
     )
     VALUES (
       'workspace-foreign-tenancy@example.invalid',
       'workspace-foreign-tenancy@example.invalid',
       NOW(),
       NOW(),
       NOW()
     )
     RETURNING id::TEXT AS id`,
  )
  const foreignUserId = foreign.rows[0].id
  const foreignWorkspace = await pool.query(
    `SELECT ensure_auth_user_workspace($1)::TEXT AS id`,
    [foreignUserId],
  )

  let rootRejected = false
  try {
    await pool.query(
      'UPDATE leads SET workspace_id = $1 WHERE id = $2',
      [foreignWorkspace.rows[0].id, fixture.leadId],
    )
  } catch {
    rootRejected = true
  }
  if (!rootRejected) {
    throw new Error('Tenant root accepted a foreign workspace.')
  }

  const foreignProfile = await pool.query(
    `INSERT INTO client_profiles (agency_name, owner_id)
     VALUES ('Foreign workspace fixture', $1)
     RETURNING id::TEXT AS id`,
    [foreignUserId],
  )
  let graphRejected = false
  try {
    await pool.query(
      `INSERT INTO notification_endpoints (
         provider_account_id,
         client_profile_id,
         endpoint_type,
         status,
         destination_id
       )
       VALUES ($1, $2, 'generic_webhook', 'active', 'foreign-endpoint')`,
      [fixture.providerId, foreignProfile.rows[0].id],
    )
  } catch {
    graphRejected = true
  }
  if (!graphRejected) {
    throw new Error('Notification graph accepted a cross-workspace profile.')
  }
}

async function readRootCounts() {
  const result = await pool.query(`
    SELECT JSON_BUILD_OBJECT(
      'clientProfiles', (SELECT COUNT(*)::INTEGER FROM client_profiles),
      'subscriptions', (SELECT COUNT(*)::INTEGER FROM subscriptions),
      'checkoutOrders', (SELECT COUNT(*)::INTEGER FROM checkout_orders),
      'pilotEnrollments', (SELECT COUNT(*)::INTEGER FROM pilot_enrollments),
      'leads', (SELECT COUNT(*)::INTEGER FROM leads),
      'deliveries', (SELECT COUNT(*)::INTEGER FROM deliveries),
      'searchPreferences', (
        SELECT COUNT(*)::INTEGER FROM user_search_preferences
      ),
      'providerAccounts', (
        SELECT COUNT(*)::INTEGER FROM notification_provider_accounts
      ),
      'opportunities', (SELECT COUNT(*)::INTEGER FROM opportunities)
    ) AS counts
  `)
  return result.rows[0].counts
}

async function readIdentitySnapshot(fixture) {
  const result = await pool.query(
    `SELECT JSON_BUILD_OBJECT(
       'profileId', profile.id::TEXT,
       'leadId', lead.id::TEXT,
       'providerId', account.id::TEXT,
       'providerPublicId', account.public_id::TEXT,
       'secretHash', ENCODE(DIGEST(account.secret_ciphertext, 'sha256'), 'hex'),
       'endpointId', endpoint.id::TEXT,
       'routeId', route.id::TEXT,
       'jobId', job.id::TEXT,
       'opportunityId', opportunity.id::TEXT
     ) AS identity
     FROM client_profiles AS profile
     JOIN leads AS lead ON lead.id = $2
     JOIN notification_provider_accounts AS account ON account.id = $3
     JOIN notification_endpoints AS endpoint ON endpoint.id = $4
     JOIN notification_routes AS route ON route.id = $5
     JOIN notification_delivery_jobs AS job ON job.id = $6
     JOIN opportunities AS opportunity ON opportunity.id = $7
     WHERE profile.id = $1`,
    [
      fixture.profileId,
      fixture.leadId,
      fixture.providerId,
      fixture.endpointId,
      fixture.routeId,
      fixture.jobId,
      fixture.opportunityId,
    ],
  )
  return result.rows[0].identity
}

async function readOutcomeChecksum() {
  const result = await pool.query(`
    SELECT ENCODE(
      DIGEST(
        COALESCE(
          STRING_AGG(
            id::TEXT || ':' || payload_hash,
            ','
            ORDER BY id
          ),
          ''
        ),
        'sha256'
      ),
      'hex'
    ) AS checksum
    FROM opportunity_outcome_events
  `)
  return result.rows[0].checksum
}

async function countWorkspaceNulls() {
  const result = await pool.query(`
    SELECT (
      (SELECT COUNT(*) FROM client_profiles WHERE workspace_id IS NULL)
      + (SELECT COUNT(*) FROM subscriptions WHERE workspace_id IS NULL)
      + (SELECT COUNT(*) FROM checkout_orders WHERE workspace_id IS NULL)
      + (SELECT COUNT(*) FROM pilot_enrollments WHERE workspace_id IS NULL)
      + (SELECT COUNT(*) FROM leads WHERE workspace_id IS NULL)
      + (SELECT COUNT(*) FROM deliveries WHERE workspace_id IS NULL)
      + (
        SELECT COUNT(*) FROM user_search_preferences
        WHERE workspace_id IS NULL
      )
      + (
        SELECT COUNT(*) FROM notification_provider_accounts
        WHERE workspace_id IS NULL
      )
      + (SELECT COUNT(*) FROM opportunities WHERE workspace_id IS NULL)
    )::INTEGER AS count
  `)
  return result.rows[0].count
}

async function runTool(filename, ...args) {
  const result = await execFileAsync(
    process.execPath,
    [resolve(scriptsDir, filename), ...args],
    {
      cwd: root,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
      windowsHide: true,
    },
  )
  const lines = result.stdout.trim().split(/\r?\n/)
  return JSON.parse(lines.at(-1))
}
