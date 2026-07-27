import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import pg from 'pg'

const { Client } = pg
const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) throw new Error('DATABASE_URL is required.')

const root = resolve(import.meta.dirname, '..', '..', '..')
const migrationsDir = resolve(root, 'packages', 'db', 'migrations')
const client = new Client({ connectionString: databaseUrl })

await client.connect()
try {
  await client.query(`
    CREATE TABLE schema_migrations (
      version TEXT NOT NULL PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  const migrations = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql') && !file.endsWith('.down.sql'))
    .sort()

  let fixture = null
  for (const filename of migrations) {
    const sql = await readFile(resolve(migrationsDir, filename), 'utf8')
    await client.query('BEGIN')
    try {
      await client.query(sql)
      await client.query(
        'INSERT INTO schema_migrations (version) VALUES ($1)',
        [filename.replace(/\.sql$/, '')],
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
    if (filename === '20260726130000_add_opportunity_engine_v1.sql') {
      fixture = await seedLegacyOpportunityState(client)
    }
    if (
      filename === '20260727130000_fix_opportunity_hardening_edge_cases.sql' &&
      fixture
    ) {
      await client.query(
        `DELETE FROM client_episode_state
         WHERE client_profile_id = $1
           AND owner_id = $2
           AND hiring_episode_id = $3`,
        [fixture.clientProfileId, fixture.ownerId, fixture.snoozeEpisodeId],
      )
    }
  }

  if (!fixture) throw new Error('Legacy Opportunity Engine migration was not applied.')
  const recovered = await client.query(
    `SELECT
       state.status,
       opportunity.status AS "currentStatus"
     FROM client_episode_state state
     JOIN opportunities opportunity
       ON opportunity.client_profile_id = state.client_profile_id
      AND opportunity.owner_id = state.owner_id
      AND opportunity.hiring_episode_id = state.hiring_episode_id
      AND opportunity.superseded_at IS NULL
     WHERE state.client_profile_id = $1
       AND state.owner_id = $2
       AND state.hiring_episode_id = $3`,
    [fixture.clientProfileId, fixture.ownerId, fixture.lifecycleEpisodeId],
  )
  if (
    recovered.rows[0]?.status !== 'dismissed' ||
    recovered.rows[0]?.currentStatus !== 'dismissed'
  ) {
    throw new Error('Latest lifecycle action was not recovered during upgrade.')
  }

  const orphan = await client.query(
    `SELECT
       state.status,
       state.suppressed_until::TEXT AS "suppressedUntil",
       opportunity.snoozed_until::TEXT AS "opportunityDeadline"
     FROM client_episode_state state
     JOIN opportunities opportunity
       ON opportunity.client_profile_id = state.client_profile_id
      AND opportunity.owner_id = state.owner_id
      AND opportunity.hiring_episode_id = state.hiring_episode_id
      AND opportunity.superseded_at IS NULL
     WHERE state.client_profile_id = $1
       AND state.owner_id = $2
       AND state.hiring_episode_id = $3`,
    [fixture.clientProfileId, fixture.ownerId, fixture.snoozeEpisodeId],
  )
  if (
    orphan.rows[0]?.status !== 'snoozed' ||
    orphan.rows[0]?.suppressedUntil !== orphan.rows[0]?.opportunityDeadline
  ) {
    throw new Error('Orphaned future snooze was not backfilled during upgrade.')
  }
  const hostileSnooze = await client.query(
    `SELECT
       state.status,
       state.suppressed_until = action.created_at + INTERVAL '7 days'
         AS "deadlineRepaired"
     FROM client_episode_state state
     JOIN opportunities opportunity
       ON opportunity.client_profile_id = state.client_profile_id
      AND opportunity.owner_id = state.owner_id
      AND opportunity.hiring_episode_id = state.hiring_episode_id
     JOIN opportunity_actions action
       ON action.opportunity_id = opportunity.id
      AND action.owner_id = opportunity.owner_id
      AND action.action_key = 'upgrade:hostile-snooze'
     WHERE state.client_profile_id = $1
       AND state.owner_id = $2
       AND state.hiring_episode_id = $3`,
    [fixture.clientProfileId, fixture.ownerId, fixture.hostileSnoozeEpisodeId],
  )
  if (
    hostileSnooze.rows[0]?.status !== 'snoozed' ||
    hostileSnooze.rows[0]?.deadlineRepaired !== true
  ) {
    throw new Error('Oversized legacy snoozeDays metadata was not repaired safely.')
  }
  console.log(JSON.stringify({
    ok: true,
    checks: [
      'latest_action_recovered',
      'orphan_snooze_backfilled',
      'oversized_snooze_days_safe',
    ],
  }))
} finally {
  await client.end()
}

async function seedLegacyOpportunityState(database) {
  const token = `${process.pid}-${Date.now()}`
  const owner = await database.query(
    `INSERT INTO users (email, full_name)
     VALUES ($1, 'Opportunity upgrade verifier')
     RETURNING id::TEXT AS id`,
    [`opportunity-upgrade-${token}@example.invalid`],
  )
  const profile = await database.query(
    `INSERT INTO client_profiles (agency_name, owner_id)
     VALUES ('Opportunity upgrade verifier', $1)
     RETURNING id::TEXT AS id`,
    [owner.rows[0].id],
  )
  const organization = await database.query(
    `INSERT INTO orgs (name, domain)
     VALUES ('Opportunity upgrade verifier', $1)
     RETURNING id::TEXT AS id`,
    [`opportunity-upgrade-${token}.example.invalid`],
  )
  const insertEpisode = async (suffix) => {
    const episode = await database.query(
      `INSERT INTO hiring_episodes (
         organization_id, episode_type, episode_key, title, summary,
         started_at, last_seen_at, signal_count, vacancy_count,
         strength_score, freshness_score, evidence_hash, engine_version
       )
       VALUES (
         $1, 'new_role_cluster', $2, 'Upgrade fixture', 'Upgrade fixture',
         NOW() - INTERVAL '2 days', NOW(), 1, 1,
         0.5, 0.5, repeat('a', 64), 'hiring-episode-v1'
       )
       RETURNING id::TEXT AS id`,
      [organization.rows[0].id, `new_role_cluster:upgrade:${suffix}:${token}`],
    )
    return episode.rows[0].id
  }
  const lifecycleEpisodeId = await insertEpisode('lifecycle')
  const snoozeEpisodeId = await insertEpisode('snooze')
  const hostileSnoozeEpisodeId = await insertEpisode('hostile-snooze')

  const insertOpportunity = async ({ episodeId, status, scoringVersion, snoozedUntil }) => {
    const opportunity = await database.query(
      `INSERT INTO opportunities (
         owner_id, client_profile_id, organization_id, hiring_episode_id,
         status, title, why_now, problem_hypothesis, recommended_angle,
         recommended_persona, recommended_action, agency_fit_score,
         hiring_intent_score, agency_propensity_score, timing_score,
         reachability_score, confidence_score, opportunity_score,
         confidence_gate, scoring_version, evidence_hash, valid_until,
         snoozed_until
       )
       VALUES (
         $1, $2, $3, $4,
         $5, 'Upgrade fixture', 'Fixture', 'Fixture', 'Fixture',
         'Fixture', 'Fixture', 0.5,
         0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
         'B', $6, repeat('b', 64), NOW() + INTERVAL '30 days', $7
       )
       RETURNING id::TEXT AS id`,
      [
        owner.rows[0].id,
        profile.rows[0].id,
        organization.rows[0].id,
        episodeId,
        status,
        scoringVersion,
        snoozedUntil,
      ],
    )
    return opportunity.rows[0].id
  }

  const acceptedId = await insertOpportunity({
    episodeId: lifecycleEpisodeId,
    status: 'accepted',
    scoringVersion: 'opportunity-v1',
    snoozedUntil: null,
  })
  const dismissedId = await insertOpportunity({
    episodeId: lifecycleEpisodeId,
    status: 'dismissed',
    scoringVersion: 'opportunity-v2',
    snoozedUntil: null,
  })
  await database.query(
    `INSERT INTO opportunity_actions (
       owner_id, opportunity_id, action_type, action_key,
       action_fingerprint, metadata, created_at
     )
     VALUES
       ($1, $2, 'accepted', 'upgrade:accepted', repeat('c', 64), '{}'::jsonb, NOW() - INTERVAL '2 days'),
       ($1, $3, 'dismissed', 'upgrade:dismissed', repeat('d', 64), '{}'::jsonb, NOW() - INTERVAL '1 day')`,
    [owner.rows[0].id, acceptedId, dismissedId],
  )
  await insertOpportunity({
    episodeId: snoozeEpisodeId,
    status: 'snoozed',
    scoringVersion: 'opportunity-v1',
    snoozedUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  })
  const hostileSnoozeId = await insertOpportunity({
    episodeId: hostileSnoozeEpisodeId,
    status: 'snoozed',
    scoringVersion: 'opportunity-v1',
    snoozedUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  })
  await database.query(
    `INSERT INTO opportunity_actions (
       owner_id, opportunity_id, action_type, action_key,
       action_fingerprint, metadata, created_at
     )
     VALUES (
       $1, $2, 'snoozed', 'upgrade:hostile-snooze', repeat('e', 64),
       '{"snoozeDays":"999999999999999999999"}'::jsonb,
       NOW() - INTERVAL '1 day'
     )`,
    [owner.rows[0].id, hostileSnoozeId],
  )

  return {
    ownerId: owner.rows[0].id,
    clientProfileId: profile.rows[0].id,
    lifecycleEpisodeId,
    snoozeEpisodeId,
    hostileSnoozeEpisodeId,
  }
}
