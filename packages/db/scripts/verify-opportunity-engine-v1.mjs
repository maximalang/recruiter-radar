import assert from 'node:assert/strict'

import pg from 'pg'

const { Client } = pg
const databaseUrl = process.env.DATABASE_URL?.trim()

if (!databaseUrl) {
  console.error('DATABASE_URL is required for the opportunity engine integration test.')
  process.exit(1)
}

const client = new Client({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 10_000,
})

try {
  await client.connect()
  await client.query('BEGIN')

  const ownerResult = await client.query(
    `INSERT INTO users (email, full_name)
     VALUES ($1, 'Opportunity Engine Test')
     RETURNING id`,
    [`opportunity-${Date.now()}@example.invalid`],
  )
  const otherOwnerResult = await client.query(
    `INSERT INTO users (email, full_name)
     VALUES ($1, 'Opportunity Engine Other Tenant')
     RETURNING id`,
    [`opportunity-other-${Date.now()}@example.invalid`],
  )
  const ownerId = ownerResult.rows[0].id
  const otherOwnerId = otherOwnerResult.rows[0].id

  const profileResult = await client.query(
    `INSERT INTO client_profiles (agency_name, owner_id)
     VALUES ('Opportunity Engine Test Agency', $1)
     RETURNING id`,
    [ownerId],
  )
  const organizationResult = await client.query(
    `INSERT INTO orgs (name, domain)
     VALUES ('Opportunity Engine Test Organization', $1)
     RETURNING id`,
    [`opportunity-${Date.now()}.example.invalid`],
  )
  const clientProfileId = profileResult.rows[0].id
  const organizationId = organizationResult.rows[0].id

  const signalResult = await client.query(
    `INSERT INTO signals (
       org_id,
       signal_type,
       source,
       external_id,
       headline,
       source_url,
       occurred_at
     )
     VALUES ($1, 'job_posting', 'integration-test', $2, 'Backend developer', $3, NOW())
     RETURNING id`,
    [
      organizationId,
      `opportunity-signal-${Date.now()}`,
      'https://example.invalid/jobs/backend',
    ],
  )
  const evidenceResult = await client.query(
    `INSERT INTO evidence_items (
       org_id,
       source,
       url,
       fetched_at,
       content_hash,
       tier
     )
     VALUES ($1, 'integration-test', $2, NOW(), $3, 'direct')
     RETURNING id`,
    [
      organizationId,
      'https://example.invalid/jobs/backend',
      'a'.repeat(64),
    ],
  )

  const episodeResult = await client.query(
    `INSERT INTO hiring_episodes (
       organization_id,
       episode_type,
       episode_key,
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
       'vacancy_spike',
       'integration-test:backend',
       'Test hiring episode',
       'Test evidence-backed hiring episode.',
       NOW() - INTERVAL '3 days',
       NOW(),
       1,
       1,
       0.8,
       0.9,
       $2,
       'hiring-episode-v1'
     )
     RETURNING id`,
    [organizationId, 'b'.repeat(64)],
  )
  const hiringEpisodeId = episodeResult.rows[0].id

  await client.query(
    `INSERT INTO hiring_episode_evidence (
       hiring_episode_id,
       organization_id,
       signal_id,
       evidence_id,
       relation_type
     )
     VALUES ($1, $2, $3, $4, 'source')`,
    [
      hiringEpisodeId,
      organizationId,
      signalResult.rows[0].id,
      evidenceResult.rows[0].id,
    ],
  )

  const opportunityResult = await client.query(
    `INSERT INTO opportunities (
       owner_id,
       client_profile_id,
       organization_id,
       hiring_episode_id,
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
       valid_until
     )
     VALUES (
       $1, $2, $3, $4,
       'Test opportunity',
       'Fresh direct hiring evidence.',
       'The hiring pace may create a recruiting bottleneck.',
       'Offer a narrow evidence-backed recruiting case.',
       'Head of recruiting',
       'Prepare a draft for a lawful corporate channel.',
       0.8, 0.9, 0.7, 0.9, 0.8, 0.9, 0.83,
       'A',
       'opportunity-v1',
       $5,
       NOW() + INTERVAL '14 days'
     )
     RETURNING id`,
    [
      ownerId,
      clientProfileId,
      organizationId,
      hiringEpisodeId,
      'c'.repeat(64),
    ],
  )
  const opportunityId = opportunityResult.rows[0].id

  const firstAction = await client.query(
    `INSERT INTO opportunity_actions (
       owner_id,
       opportunity_id,
       action_type,
       action_key,
       action_fingerprint
     )
     VALUES ($1, $2, 'accepted', 'accepted:test', $3)
     ON CONFLICT (opportunity_id, action_key) DO NOTHING`,
    [ownerId, opportunityId, 'd'.repeat(64)],
  )
  const repeatedAction = await client.query(
    `INSERT INTO opportunity_actions (
       owner_id,
       opportunity_id,
       action_type,
       action_key,
       action_fingerprint
     )
     VALUES ($1, $2, 'accepted', 'accepted:test', $3)
     ON CONFLICT (opportunity_id, action_key) DO NOTHING`,
    [ownerId, opportunityId, 'd'.repeat(64)],
  )
  assert.equal(firstAction.rowCount, 1, 'the first action must be persisted')
  assert.equal(repeatedAction.rowCount, 0, 'a repeated action key must be idempotent')

  await client.query('SAVEPOINT tenant_check')
  let crossTenantRejected = false
  try {
    await client.query(
      `INSERT INTO opportunity_actions (
         owner_id,
         opportunity_id,
         action_type,
         action_key,
         action_fingerprint
       )
       VALUES ($1, $2, 'dismissed', 'dismissed:other-tenant', $3)`,
      [otherOwnerId, opportunityId, 'e'.repeat(64)],
    )
  } catch {
    crossTenantRejected = true
    await client.query('ROLLBACK TO SAVEPOINT tenant_check')
  }
  assert.equal(
    crossTenantRejected,
    true,
    'the composite owner foreign key must reject a cross-tenant action',
  )

  const evidenceLinks = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM hiring_episode_evidence
     WHERE hiring_episode_id = $1
       AND organization_id = $2`,
    [hiringEpisodeId, organizationId],
  )
  assert.equal(evidenceLinks.rows[0].count, 1, 'episode evidence must be traceable')

  console.log(
    JSON.stringify({
      ok: true,
      checks: ['tenant_ownership', 'action_idempotency', 'evidence_traceability'],
    }),
  )
} finally {
  try {
    await client.query('ROLLBACK')
  } catch {
    // The connection may have failed before the transaction began.
  }
  await client.end().catch(() => undefined)
}
