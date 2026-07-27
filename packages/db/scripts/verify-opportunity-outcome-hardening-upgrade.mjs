import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import pg from 'pg'

const { Client } = pg
const databaseUrl = process.env.DATABASE_URL
const upgradeCase = process.env.OUTCOME_HARDENING_UPGRADE_CASE
const hardeningFile = '20260728100000_harden_opportunity_outcome_ledger.sql'

if (!databaseUrl) throw new Error('DATABASE_URL is required.')
if (!['valid-legacy-meeting', 'invalid-chronology'].includes(upgradeCase)) {
  throw new Error('OUTCOME_HARDENING_UPGRADE_CASE is invalid.')
}

const root = resolve(import.meta.dirname, '..', '..', '..')
const migrationsDir = resolve(root, 'packages', 'db', 'migrations')
const database = new Client({ connectionString: databaseUrl })
const hash = (value) => createHash('sha256').update(value).digest('hex')

await database.connect()
try {
  const migrations = (await readdir(migrationsDir))
    .filter((file) =>
      file.endsWith('.sql') &&
      !file.endsWith('.down.sql') &&
      file < hardeningFile
    )
    .sort()
  for (const migration of migrations) {
    await database.query(await readFile(resolve(migrationsDir, migration), 'utf8'))
  }

  const fixture = await seedFixture(database, upgradeCase)
  const hardeningSql = await readFile(
    resolve(migrationsDir, hardeningFile),
    'utf8',
  )

  if (upgradeCase === 'invalid-chronology') {
    let rejected = false
    try {
      await database.query(hardeningSql)
    } catch (error) {
      rejected = error instanceof Error &&
        error.message.includes('legacy commercial outcome chronology is invalid')
      await database.query('ROLLBACK').catch(() => undefined)
    }
    if (!rejected) {
      throw new Error('Hardening accepted an invalid legacy chronology.')
    }
    console.log(JSON.stringify({
      ok: true,
      case: upgradeCase,
      rejected: true,
    }))
  } else {
    await database.query(hardeningSql)
    const result = await database.query(
      `SELECT
         event.metadata->>'meetingStatus' AS "meetingStatus",
         state.commercial_stage AS "commercialStage",
         state.last_stage_event_id::TEXT AS "lastStageEventId"
       FROM opportunity_outcome_events event
       JOIN opportunity_outcome_state state
         ON state.owner_id = event.owner_id
        AND state.opportunity_id = event.opportunity_id
       WHERE event.id = $1`,
      [fixture.meetingEventId],
    )
    if (
      result.rows[0]?.meetingStatus !== 'scheduled' ||
      result.rows[0]?.commercialStage !== 'meeting' ||
      result.rows[0]?.lastStageEventId !== fixture.meetingEventId
    ) {
      throw new Error('Hardening did not preserve a valid legacy meeting.')
    }
    console.log(JSON.stringify({
      ok: true,
      case: upgradeCase,
      meetingStatus: result.rows[0].meetingStatus,
    }))
  }
} finally {
  await database.end()
}

async function seedFixture(client, fixtureCase) {
  const token = `${fixtureCase}-${process.pid}-${Date.now()}`
  const owner = await client.query(
    `INSERT INTO users (email, full_name)
     VALUES ($1, 'Outcome hardening upgrade')
     RETURNING id::TEXT AS id`,
    [`outcome-hardening-${token}@example.invalid`],
  )
  const ownerId = owner.rows[0].id
  const profile = await client.query(
    `INSERT INTO client_profiles (agency_name, owner_id)
     VALUES ('Outcome hardening upgrade', $1)
     RETURNING id::TEXT AS id`,
    [ownerId],
  )
  const organization = await client.query(
    `INSERT INTO orgs (name, domain)
     VALUES ('Outcome hardening upgrade', $1)
     RETURNING id::TEXT AS id`,
    [`outcome-hardening-${token}.example.invalid`],
  )
  const organizationId = organization.rows[0].id
  const episode = await client.query(
    `INSERT INTO hiring_episodes (
       organization_id, episode_type, episode_key, episode_identity,
       episode_generation, title, summary, started_at, last_seen_at,
       signal_count, vacancy_count, strength_score, freshness_score,
       evidence_hash, engine_version
     )
     VALUES (
       $1, 'vacancy_spike', $2, $3, 1,
       'Outcome hardening upgrade', 'Outcome hardening upgrade',
       NOW() - INTERVAL '1 day', NOW(), 1, 3, 0.8, 0.9, $4,
       'hiring-episode-v1'
     )
     RETURNING id::TEXT AS id`,
    [
      organizationId,
      `outcome-hardening:${token}`,
      `${organizationId}:outcome-hardening:${token}`,
      hash(`episode:${token}`),
    ],
  )
  const opportunity = await client.query(
    `INSERT INTO opportunities (
       owner_id, client_profile_id, organization_id, hiring_episode_id,
       status, title, why_now, problem_hypothesis, recommended_angle,
       recommended_persona, recommended_action, agency_fit_score,
       hiring_intent_score, agency_propensity_score, timing_score,
       reachability_score, confidence_score, opportunity_score,
       confidence_gate, scoring_version, evidence_hash, valid_until,
       episode_evidence_hash, profile_snapshot_hash, fiur_version,
       scoring_config_hash, brief_builder_version, input_hash
     )
     VALUES (
       $1, $2, $3, $4, 'contacted', 'Outcome hardening upgrade',
       'Fresh evidence', 'External support may be useful', 'Narrow offer',
       'Head of recruiting', 'Prepare a draft', 0.8, 0.9, 0.7, 0.9,
       0.8, 0.9, 0.83, 'A', 'opportunity-v1', $5,
       NOW() + INTERVAL '14 days', $5, $6, 'fiur-v1', $7,
       'opportunity-brief-v1', $8
     )
     RETURNING id::TEXT AS id`,
    [
      ownerId,
      profile.rows[0].id,
      organizationId,
      episode.rows[0].id,
      hash(`evidence:${token}`),
      hash(`profile:${token}`),
      hash('scoring-config'),
      hash(`input:${token}`),
    ],
  )
  const opportunityId = opportunity.rows[0].id
  const base = Date.now() - 60_000
  const acceptedAt = fixtureCase === 'invalid-chronology'
    ? new Date(base + 20_000).toISOString()
    : new Date(base + 1_000).toISOString()
  const contactedAt = fixtureCase === 'invalid-chronology'
    ? new Date(base + 10_000).toISOString()
    : new Date(base + 2_000).toISOString()

  const acceptedEventId = await insertEvent(client, {
    ownerId,
    clientProfileId: profile.rows[0].id,
    organizationId,
    hiringEpisodeId: episode.rows[0].id,
    opportunityId,
    eventType: 'accepted',
    previousStage: 'new',
    newStage: 'accepted',
    occurredAt: acceptedAt,
    idempotencyKey: `accepted:${token}`,
    payloadHash: hash(`accepted:${token}`),
  })
  const contactedEventId = await insertEvent(client, {
    ownerId,
    clientProfileId: profile.rows[0].id,
    organizationId,
    hiringEpisodeId: episode.rows[0].id,
    opportunityId,
    eventType: 'contacted',
    previousStage: 'accepted',
    newStage: 'contacted',
    occurredAt: contactedAt,
    idempotencyKey: `contacted:${token}`,
    payloadHash: hash(`contacted:${token}`),
    channel: 'email',
  })

  let meetingEventId = null
  let lastEventId = contactedEventId
  let lastEventAt = acceptedAt > contactedAt ? acceptedAt : contactedAt
  let currentStage = 'contacted'
  let repliedAt = null
  let meetingAt = null
  if (fixtureCase === 'valid-legacy-meeting') {
    repliedAt = new Date(base + 3_000).toISOString()
    const repliedEventId = await insertEvent(client, {
      ownerId,
      clientProfileId: profile.rows[0].id,
      organizationId,
      hiringEpisodeId: episode.rows[0].id,
      opportunityId,
      eventType: 'replied',
      previousStage: 'contacted',
      newStage: 'replied',
      occurredAt: repliedAt,
      idempotencyKey: `replied:${token}`,
      payloadHash: hash(`replied:${token}`),
    })
    meetingAt = new Date(base + 4_000).toISOString()
    meetingEventId = await insertEvent(client, {
      ownerId,
      clientProfileId: profile.rows[0].id,
      organizationId,
      hiringEpisodeId: episode.rows[0].id,
      opportunityId,
      eventType: 'meeting',
      previousStage: 'replied',
      newStage: 'meeting',
      occurredAt: meetingAt,
      idempotencyKey: `meeting:${token}`,
      payloadHash: hash(`meeting:${token}`),
    })
    void repliedEventId
    lastEventId = meetingEventId
    lastEventAt = meetingAt
    currentStage = 'meeting'
  }

  await client.query(
    `INSERT INTO opportunity_outcome_state (
       owner_id, client_profile_id, opportunity_id, hiring_episode_id,
       organization_id, current_stage, last_event_id, last_event_at,
       accepted_at, contacted_at, replied_at, meeting_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8::timestamptz,
       $9::timestamptz, $10::timestamptz, $11::timestamptz, $12::timestamptz
     )`,
    [
      ownerId,
      profile.rows[0].id,
      opportunityId,
      episode.rows[0].id,
      organizationId,
      currentStage,
      lastEventId,
      lastEventAt,
      acceptedAt,
      contactedAt,
      repliedAt,
      meetingAt,
    ],
  )

  return { meetingEventId }
}

async function insertEvent(client, input) {
  const result = await client.query(
    `INSERT INTO opportunity_outcome_events (
       owner_id, client_profile_id, opportunity_id, hiring_episode_id,
       organization_id, event_type, previous_stage, new_stage, channel,
       occurred_at, actor_type, actor_user_id, metadata, analytics_snapshot,
       idempotency_key, payload_hash
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9,
       $10::timestamptz, 'user', $1, '{}'::jsonb, '{}'::jsonb, $11, $12
     )
     RETURNING id::TEXT AS id`,
    [
      input.ownerId,
      input.clientProfileId,
      input.opportunityId,
      input.hiringEpisodeId,
      input.organizationId,
      input.eventType,
      input.previousStage,
      input.newStage,
      input.channel ?? null,
      input.occurredAt,
      input.idempotencyKey,
      input.payloadHash,
    ],
  )
  return result.rows[0].id
}
