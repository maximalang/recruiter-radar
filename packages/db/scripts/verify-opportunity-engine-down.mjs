import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import pg from 'pg'

const { Client } = pg
const execFileAsync = promisify(execFile)

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required.')

const root = resolve(import.meta.dirname, '..', '..', '..')
const migrationsDir = resolve(root, 'packages', 'db', 'migrations')
const migrateScript = resolve(root, 'packages', 'db', 'scripts', 'migrate.mjs')
const downMigrations = [
  '20260727152000_add_opportunity_public_reference.down.sql',
  '20260727151000_add_opportunity_outcome_projection.down.sql',
  '20260727150000_add_opportunity_outcome_ledger.down.sql',
  '20260727140000_repair_opportunity_authoritative_state.down.sql',
  '20260727130000_fix_opportunity_hardening_edge_cases.down.sql',
  '20260727122000_add_opportunity_supersession.down.sql',
  '20260727121000_add_opportunity_episode_state.down.sql',
  '20260727120000_add_opportunity_engine_hardening.down.sql',
  '20260726130000_add_opportunity_engine_v1.down.sql',
]

const admin = new Client({ connectionString: databaseUrl })
const databaseName = `rr_opportunity_down_${process.pid}_${Date.now()}`
const temporaryUrl = new URL(databaseUrl)
temporaryUrl.pathname = `/${databaseName}`

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

async function seedSupersessionRollbackFixture(database) {
  const token = `${process.pid}-${Date.now()}`
  const owner = await database.query(
    `INSERT INTO users (email, full_name)
     VALUES ($1, 'Opportunity down verifier')
     RETURNING id::TEXT AS id`,
    [`opportunity-down-${token}@example.invalid`],
  )
  const ownerId = owner.rows[0].id
  const profile = await database.query(
    `INSERT INTO client_profiles (agency_name, owner_id)
     VALUES ('Opportunity down verifier', $1)
     RETURNING id::TEXT AS id`,
    [ownerId],
  )
  const organization = await database.query(
    `INSERT INTO orgs (name, domain)
     VALUES ('Opportunity down verifier', $1)
     RETURNING id::TEXT AS id`,
    [`opportunity-down-${token}.example.invalid`],
  )
  const episode = await database.query(
    `INSERT INTO hiring_episodes (
       organization_id, episode_type, episode_key, episode_identity,
       episode_generation, title, summary, started_at, last_seen_at,
       signal_count, vacancy_count, strength_score, freshness_score,
       evidence_hash, engine_version
     )
     VALUES (
       $1, 'role_cluster', $2, $3, 1,
       'Rollback fixture', 'Rollback fixture', NOW(), NOW(),
       1, 1, 0.5, 0.5, repeat('a', 64), 'hiring-episode-v1'
     )
     RETURNING id::TEXT AS id`,
    [organization.rows[0].id, `rollback:${token}`, `rollback:${token}`],
  )

  const insertOpportunity = async (scoringVersion, superseded) => {
    const result = await database.query(
      `INSERT INTO opportunities (
         owner_id, client_profile_id, organization_id, hiring_episode_id,
         status, title, why_now, problem_hypothesis, recommended_angle,
         recommended_persona, recommended_action, agency_fit_score,
         hiring_intent_score, agency_propensity_score, timing_score,
         reachability_score, confidence_score, opportunity_score,
         confidence_gate, scoring_version, evidence_hash, valid_until,
         episode_evidence_hash, profile_snapshot_hash, fiur_version,
         scoring_config_hash, brief_builder_version, input_hash, superseded_at
       )
       VALUES (
         $1, $2, $3, $4,
         'accepted', 'Rollback fixture', 'Fixture', 'Fixture', 'Fixture',
         'Fixture', 'Fixture', 0.5,
         0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
         'B', $5, repeat('b', 64), NOW() + INTERVAL '1 day',
         repeat('b', 64), repeat('c', 64), 'fiur-v1',
         repeat('d', 64), 'opportunity-brief-v1', repeat('e', 64), $6
       )
       RETURNING id::TEXT AS id`,
      [
        ownerId,
        profile.rows[0].id,
        organization.rows[0].id,
        episode.rows[0].id,
        scoringVersion,
        superseded ? new Date().toISOString() : null,
      ],
    )
    return result.rows[0].id
  }

  const historicalOpportunityId = await insertOpportunity('opportunity-v1', true)
  const newerOpportunityId = await insertOpportunity('opportunity-v2', true)
  await database.query(
    `INSERT INTO opportunity_actions (
       owner_id, opportunity_id, action_type, action_key,
       action_fingerprint, previous_status, new_status, metadata
     )
     VALUES
       ($1, $2, 'accepted', 'rollback:accepted', repeat('f', 64), 'new', 'accepted', '{"audit":"first"}'::jsonb),
       ($1, $2, 'dismissed', 'rollback:dismissed', repeat('0', 64), 'accepted', 'dismissed', '{"audit":"second"}'::jsonb)`,
    [ownerId, historicalOpportunityId],
  )
  return { historicalOpportunityId, newerOpportunityId }
}

await admin.connect()
try {
  await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`)
  await execFileAsync(process.execPath, [migrateScript], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: temporaryUrl.toString() },
  })

  const database = new Client({ connectionString: temporaryUrl.toString() })
  await database.connect()
  try {
    const fixture = await seedSupersessionRollbackFixture(database)
    for (const migration of downMigrations) {
      await database.query(await readFile(resolve(migrationsDir, migration), 'utf8'))
      if (migration === '20260727122000_add_opportunity_supersession.down.sql') {
        const actions = await database.query(
          `SELECT
             opportunity_id::TEXT AS "opportunityId",
             action_key AS "actionKey",
             metadata->>'audit' AS audit
           FROM opportunity_actions
           WHERE opportunity_id = $1
           ORDER BY action_key`,
          [fixture.historicalOpportunityId],
        )
        if (
          actions.rowCount !== 2 ||
          actions.rows[0]?.opportunityId !== fixture.historicalOpportunityId ||
          actions.rows[0]?.actionKey !== 'rollback:accepted' ||
          actions.rows[0]?.audit !== 'first' ||
          actions.rows[1]?.opportunityId !== fixture.historicalOpportunityId ||
          actions.rows[1]?.actionKey !== 'rollback:dismissed' ||
          actions.rows[1]?.audit !== 'second'
        ) {
          throw new Error('Supersession rollback did not preserve action audit provenance.')
        }
        const opportunities = await database.query(
          `SELECT id::TEXT AS id
           FROM opportunities
           WHERE id = ANY($1::bigint[])
           ORDER BY id`,
          [[fixture.historicalOpportunityId, fixture.newerOpportunityId]],
        )
        if (opportunities.rowCount !== 2) {
          throw new Error('Supersession rollback deleted a historical opportunity version.')
        }
      }
    }
    const result = await database.query(
      `SELECT
         TO_REGCLASS('public.opportunities') AS opportunities,
         TO_REGCLASS('public.client_episode_state') AS client_episode_state`,
    )
    if (
      result.rows[0]?.opportunities !== null ||
      result.rows[0]?.client_episode_state !== null
    ) {
      throw new Error('Opportunity Engine down migrations left runtime tables behind.')
    }
  } finally {
    await database.end()
  }
  console.log(JSON.stringify({ ok: true, migrations: downMigrations.length }))
} finally {
  await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`)
  await admin.end()
}
