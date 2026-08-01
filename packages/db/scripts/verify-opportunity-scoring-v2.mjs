import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import pg from 'pg'

const { Pool } = pg

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required.')
}
if (process.env.OPPORTUNITY_SCORING_V2_DB_TEST_ACK !== 'isolated') {
  throw new Error(
    'Refusing to write fixtures without OPPORTUNITY_SCORING_V2_DB_TEST_ACK=isolated.',
  )
}

const database = new Pool({ connectionString: process.env.DATABASE_URL })
const token = randomUUID()
const ownerIds = []
const snapshotIds = []

const snapshotInsert = `
  INSERT INTO opportunity_scoring_snapshots (
    opportunity_id,
    owner_id,
    workspace_id,
    client_profile_id,
    hiring_episode_id,
    scoring_version,
    baseline_scoring_version,
    feature_schema_version,
    gate_version,
    agency_dna_version,
    profile_snapshot_hash,
    evidence_hash,
    config_hash,
    input_hash,
    comparison_input_hash,
    component_scores,
    baseline_component_scores,
    hard_gate_results,
    confidence_gate,
    ranking_score,
    baseline_ranking_score,
    action_queue_eligible
  )
  VALUES (
    $1, $2, $3, $4, $5,
    'opportunity-v2', 'opportunity-v1',
    'opportunity-features-v2', 'opportunity-gates-v2', 1,
    repeat('a', 64), repeat('b', 64), repeat('c', 64), $6,
    repeat('d', 64),
    '{"eligibility":{"score":1}}'::jsonb,
    '{"agencyFit":{"score":0.5}}'::jsonb,
    '[]'::jsonb, 'A', 0.6, 0.5, TRUE
  )
  ON CONFLICT (opportunity_id, scoring_version, input_hash) DO NOTHING
  RETURNING id::TEXT AS id
`

try {
  const owners = await database.query(
    `INSERT INTO users (email, full_name)
     VALUES ($1, 'Scoring v2 verifier'), ($2, 'Scoring v2 other tenant')
     RETURNING id::TEXT AS id`,
    [
      `scoring-v2-${token}@example.invalid`,
      `scoring-v2-other-${token}@example.invalid`,
    ],
  )
  ownerIds.push(...owners.rows.map((row) => String(row.id)))
  const [ownerId, otherOwnerId] = ownerIds

  const profiles = await database.query(
    `INSERT INTO client_profiles (agency_name, owner_id)
     VALUES ('Scoring v2 verifier', $1), ('Scoring v2 other tenant', $2)
     RETURNING
       id::TEXT AS id,
       owner_id::TEXT AS "ownerId",
       workspace_id::TEXT AS "workspaceId"`,
    [ownerId, otherOwnerId],
  )
  const profile = profiles.rows.find((row) => row.ownerId === ownerId)
  const otherProfile = profiles.rows.find((row) => row.ownerId === otherOwnerId)
  assert.ok(profile?.workspaceId)
  assert.ok(otherProfile?.workspaceId)

  const organization = await database.query(
    `INSERT INTO orgs (name, domain)
     VALUES ('Scoring v2 verifier', $1)
     RETURNING id::TEXT AS id`,
    [`scoring-v2-${token}.example.invalid`],
  )
  const organizationId = organization.rows[0].id
  const episode = await database.query(
    `INSERT INTO hiring_episodes (
       organization_id, episode_type, episode_key, episode_identity,
       episode_generation, title, summary, started_at, last_seen_at,
       signal_count, vacancy_count, strength_score, freshness_score,
       evidence_hash, engine_version
     )
     VALUES (
       $1, 'role_cluster', $2, $2, 1,
       'Scoring v2 fixture', 'Scoring v2 fixture', NOW(), NOW(),
       1, 1, 0.5, 0.5, repeat('b', 64), 'hiring-episode-v1'
     )
     RETURNING id::TEXT AS id`,
    [organizationId, `scoring-v2:${token}`],
  )
  const episodeId = episode.rows[0].id
  const opportunity = await database.query(
    `INSERT INTO opportunities (
       owner_id, workspace_id, client_profile_id, organization_id,
       hiring_episode_id, status, title, why_now, problem_hypothesis,
       recommended_angle, recommended_persona, recommended_action,
       agency_fit_score, hiring_intent_score, agency_propensity_score,
       timing_score, reachability_score, confidence_score, opportunity_score,
       confidence_gate, scoring_version, evidence_hash, valid_until,
       episode_evidence_hash, profile_snapshot_hash, fiur_version,
       scoring_config_hash, brief_builder_version, input_hash,
       agency_dna_version, feature_schema_version, gate_version,
       component_scores, hard_gate_results, ranking_score,
       action_queue_eligible
     )
     VALUES (
       $1, $2, $3, $4, $5, 'new',
       'Scoring v2 fixture', 'Fixture', 'Fixture', 'Fixture', 'Fixture',
       'Fixture', 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.6,
       'A', 'opportunity-v2', repeat('b', 64), NOW() + INTERVAL '1 day',
       repeat('b', 64), repeat('a', 64), 'fiur-v1', repeat('c', 64),
       'opportunity-brief-v1', repeat('e', 64), 1,
       'opportunity-features-v2', 'opportunity-gates-v2',
       '{"eligibility":{"score":1}}'::jsonb, '[]'::jsonb, 0.6, TRUE
     )
     RETURNING id::TEXT AS id`,
    [
      ownerId,
      profile.workspaceId,
      profile.id,
      organizationId,
      episodeId,
    ],
  )
  const opportunityId = opportunity.rows[0].id

  const first = await database.query(snapshotInsert, [
    opportunityId,
    ownerId,
    profile.workspaceId,
    profile.id,
    episodeId,
    '1'.repeat(64),
  ])
  assert.equal(first.rowCount, 1)
  snapshotIds.push(first.rows[0].id)

  const replay = await database.query(snapshotInsert, [
    opportunityId,
    ownerId,
    profile.workspaceId,
    profile.id,
    episodeId,
    '1'.repeat(64),
  ])
  assert.equal(replay.rowCount, 0)

  await assert.rejects(
    database.query(snapshotInsert, [
      opportunityId,
      ownerId,
      otherProfile.workspaceId,
      profile.id,
      episodeId,
      '2'.repeat(64),
    ]),
    (error) => error?.code === '23503',
  )

  await assert.rejects(
    database.query(
      'UPDATE opportunity_scoring_snapshots SET ranking_score = 0.1 WHERE id = $1',
      [first.rows[0].id],
    ),
    /append-only/,
  )
  await assert.rejects(
    database.query(
      'DELETE FROM opportunity_scoring_snapshots WHERE id = $1',
      [first.rows[0].id],
    ),
    /append-only/,
  )

  const concurrentInputHash = '3'.repeat(64)
  const concurrent = await Promise.all([
    database.query(snapshotInsert, [
      opportunityId,
      ownerId,
      profile.workspaceId,
      profile.id,
      episodeId,
      concurrentInputHash,
    ]),
    database.query(snapshotInsert, [
      opportunityId,
      ownerId,
      profile.workspaceId,
      profile.id,
      episodeId,
      concurrentInputHash,
    ]),
  ])
  assert.deepEqual(concurrent.map((result) => result.rowCount).sort(), [0, 1])
  snapshotIds.push(...concurrent.flatMap((result) =>
    result.rows.map((row) => row.id),
  ))

  const rollbackSql = await readFile(
    resolve(
      import.meta.dirname,
      '..',
      'migrations',
      '20260801120000_add_opportunity_scoring_v2.down.sql',
    ),
    'utf8',
  )
  await assert.rejects(
    database.query(rollbackSql),
    /opportunity scoring v2 rollback refused/,
  )
  await database.query('ROLLBACK').catch(() => undefined)

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'snapshot_inserted',
      'idempotent_replay_stable',
      'tenant_scope_rejected',
      'update_rejected',
      'delete_rejected',
      'concurrent_replay_serialized',
      'rollback_guarded',
    ],
  }))
} finally {
  await database.query(
    'ALTER TABLE opportunity_scoring_snapshots DISABLE TRIGGER opportunity_scoring_snapshots_append_only',
  ).catch(() => undefined)
  await database.query(
    'DELETE FROM opportunity_scoring_snapshots WHERE id = ANY($1::BIGINT[])',
    [snapshotIds],
  ).catch(() => undefined)
  await database.query(
    'ALTER TABLE opportunity_scoring_snapshots ENABLE TRIGGER opportunity_scoring_snapshots_append_only',
  ).catch(() => undefined)
  if (ownerIds.length > 0) {
    await database.query(
      'DELETE FROM client_profiles WHERE owner_id = ANY($1::BIGINT[])',
      [ownerIds],
    ).catch(() => undefined)
    await database.query(
      'DELETE FROM workspaces WHERE bootstrap_user_id = ANY($1::BIGINT[])',
      [ownerIds],
    ).catch(() => undefined)
    await database.query(
      'DELETE FROM users WHERE id = ANY($1::BIGINT[])',
      [ownerIds],
    ).catch(() => undefined)
  }
  await database.end()
}
