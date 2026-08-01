import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import pg from 'pg'

const { Client } = pg
const databaseUrl = process.env.DATABASE_URL?.trim()

if (!databaseUrl) {
  console.error('DATABASE_URL is required for the opportunity engine integration test.')
  process.exit(1)
}

const ALLOWED_TRANSITIONS = {
  new: ['accepted', 'dismissed', 'snoozed'],
  review: ['accepted', 'dismissed', 'snoozed'],
  accepted: ['contacted', 'dismissed', 'snoozed'],
  snoozed: ['accepted', 'dismissed'],
  dismissed: [],
  contacted: [],
  expired: [],
}
const JOB_LOCK_KEY = 7_271_002
const hash = (value) => createHash('sha256').update(value).digest('hex')
const evidenceHash = (signalIds, evidenceIds = []) => hash([
  ...signalIds.map((id) => `signal:${id}`),
  ...evidenceIds.map((id) => `evidence:${id}`),
].sort().join('|'))

const client = new Client({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 10_000,
})
const competingClient = new Client({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 10_000,
})
const checks = []

async function expectDatabaseRejection(name, operation) {
  const savepoint = `verify_${name.replaceAll('-', '_')}`
  await client.query(`SAVEPOINT ${savepoint}`)
  try {
    await operation()
  } catch {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
    return
  }
  assert.fail(`${name} must be rejected by PostgreSQL`)
}

async function reconcileEvidence(
  hiringEpisodeId,
  organizationId,
  signalIds,
  evidenceIds = [],
) {
  const nextHash = evidenceHash(signalIds, evidenceIds)
  await client.query(
    `DELETE FROM hiring_episode_evidence
     WHERE hiring_episode_id = $1`,
    [hiringEpisodeId],
  )
  for (const signalId of signalIds) {
    await client.query(
      `INSERT INTO hiring_episode_evidence (
         hiring_episode_id,
         organization_id,
         signal_id,
         relation_type
       )
       VALUES ($1, $2, $3, 'source')`,
      [hiringEpisodeId, organizationId, signalId],
    )
  }
  for (const evidenceId of evidenceIds) {
    await client.query(
      `INSERT INTO hiring_episode_evidence (
         hiring_episode_id,
         organization_id,
         evidence_id,
         relation_type
       )
       VALUES ($1, $2, $3, 'supporting')`,
      [hiringEpisodeId, organizationId, evidenceId],
    )
  }
  await client.query(
    `UPDATE hiring_episodes
     SET
       evidence_hash = $2,
       signal_count = $3,
       updated_at = NOW()
     WHERE id = $1`,
    [hiringEpisodeId, nextHash, signalIds.length],
  )
  const stored = await client.query(
    `SELECT
       episode.evidence_hash AS "evidenceHash",
       COALESCE(
         ARRAY_AGG(link.signal_id::TEXT ORDER BY link.signal_id)
           FILTER (WHERE link.signal_id IS NOT NULL),
         ARRAY[]::TEXT[]
       ) AS "signalIds",
       COALESCE(
         ARRAY_AGG(link.evidence_id::TEXT ORDER BY link.evidence_id)
           FILTER (WHERE link.evidence_id IS NOT NULL),
         ARRAY[]::TEXT[]
       ) AS "evidenceIds"
     FROM hiring_episodes episode
     JOIN hiring_episode_evidence link
       ON link.hiring_episode_id = episode.id
     WHERE episode.id = $1
     GROUP BY episode.id`,
    [hiringEpisodeId],
  )
  assert.equal(stored.rows[0].evidenceHash, nextHash)
  assert.deepEqual(stored.rows[0].signalIds, [...signalIds].sort((a, b) => Number(a) - Number(b)))
  assert.deepEqual(stored.rows[0].evidenceIds, [...evidenceIds].sort((a, b) => Number(a) - Number(b)))
}

async function transitionOpportunity({
  ownerId,
  opportunityId,
  action,
  actionKey,
  fingerprint,
}) {
  const existing = await client.query(
    `SELECT action_type AS "actionType", action_fingerprint AS fingerprint
     FROM opportunity_actions
     WHERE opportunity_id = $1
       AND owner_id = $2
       AND action_key = $3`,
    [opportunityId, ownerId, actionKey],
  )
  if (existing.rows[0]) {
    assert.equal(existing.rows[0].actionType, action)
    assert.equal(existing.rows[0].fingerprint, fingerprint)
    return { replayed: true }
  }

  const opportunity = await client.query(
    `SELECT
       status,
       client_profile_id::TEXT AS "clientProfileId",
       organization_id::TEXT AS "organizationId",
       hiring_episode_id::TEXT AS "hiringEpisodeId"
     FROM opportunities
     WHERE id = $1
       AND owner_id = $2
     FOR UPDATE`,
    [opportunityId, ownerId],
  )
  assert.ok(opportunity.rows[0], 'the opportunity must exist')
  const previousStatus = opportunity.rows[0].status
  if (!ALLOWED_TRANSITIONS[previousStatus]?.includes(action)) {
    throw new Error(`forbidden transition: ${previousStatus} -> ${action}`)
  }

  await client.query(
    `INSERT INTO opportunity_actions (
       owner_id,
       opportunity_id,
       action_type,
       action_key,
       action_fingerprint,
       previous_status,
       new_status
     )
     VALUES ($1, $2, $3, $4, $5, $6, $3)`,
    [
      ownerId,
      opportunityId,
      action,
      actionKey,
      fingerprint,
      previousStatus,
    ],
  )
  await client.query(
    `UPDATE opportunities
     SET status = $2, updated_at = NOW()
     WHERE id = $1`,
    [opportunityId, action],
  )
  await client.query(
    `INSERT INTO client_episode_state (
       client_profile_id,
       owner_id,
       hiring_episode_id,
       organization_id,
       status
     )
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (client_profile_id, hiring_episode_id)
     DO UPDATE SET
       status = EXCLUDED.status,
       suppressed_until = NULL,
       updated_at = NOW()`,
    [
      opportunity.rows[0].clientProfileId,
      ownerId,
      opportunity.rows[0].hiringEpisodeId,
      opportunity.rows[0].organizationId,
      action,
    ],
  )
  return { replayed: false }
}

async function insertOpportunity({
  ownerId,
  clientProfileId,
  organizationId,
  hiringEpisodeId,
  digestCandidateId,
  scoringVersion,
  inputHash,
  status = 'new',
}) {
  const result = await client.query(
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
       digest_candidate_id,
       fiur_version,
       scoring_config_hash,
       brief_builder_version,
       input_hash
     )
     VALUES (
       $1, $2, $3, $4, $5,
       'Test opportunity',
       'Fresh direct hiring evidence.',
       'The hiring pace may create a recruiting bottleneck.',
       'Offer a narrow evidence-backed recruiting case.',
       'Head of recruiting',
       'Prepare a draft for a lawful corporate channel.',
       0.8, 0.9, 0.7, 0.9, 0.8, 0.9, 0.83,
       'A', $6, $7, NOW() + INTERVAL '14 days',
       $7, $8, $9, 'fiur-v1', $10, 'opportunity-brief-v1', $11
     )
     RETURNING id::TEXT AS id`,
    [
      ownerId,
      clientProfileId,
      organizationId,
      hiringEpisodeId,
      status,
      scoringVersion,
      hash('episode-evidence'),
      hash('profile-snapshot'),
      digestCandidateId,
      hash('scoring-config'),
      inputHash,
    ],
  )
  return result.rows[0].id
}

try {
  await client.connect()
  await competingClient.connect()
  await client.query('BEGIN')

  const migrationShape = await client.query(
    `SELECT
       to_regclass('public.client_episode_state') IS NOT NULL AS "hasEpisodeState",
       EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'hiring_episodes'
           AND column_name = 'episode_identity'
       ) AS "hasEpisodeIdentity",
       EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'opportunities'
           AND column_name = 'superseded_at'
       ) AS "hasSupersession"`,
  )
  assert.deepEqual(migrationShape.rows[0], {
    hasEpisodeState: true,
    hasEpisodeIdentity: true,
    hasSupersession: true,
  })
  checks.push('clean_or_current_schema_migrated')

  const token = `${Date.now()}-${process.pid}`
  const ownerResult = await client.query(
    `INSERT INTO users (email, full_name)
     VALUES ($1, 'Opportunity Engine Test')
     RETURNING id::TEXT AS id`,
    [`opportunity-${token}@example.invalid`],
  )
  const otherOwnerResult = await client.query(
    `INSERT INTO users (email, full_name)
     VALUES ($1, 'Opportunity Engine Other Tenant')
     RETURNING id::TEXT AS id`,
    [`opportunity-other-${token}@example.invalid`],
  )
  const ownerId = ownerResult.rows[0].id
  const otherOwnerId = otherOwnerResult.rows[0].id

  const profileResult = await client.query(
    `INSERT INTO client_profiles (agency_name, owner_id)
     VALUES ('Opportunity Engine Test Agency', $1)
     RETURNING id::TEXT AS id`,
    [ownerId],
  )
  const organizationResult = await client.query(
    `INSERT INTO orgs (name, domain)
     VALUES ('Opportunity Engine Test Organization', $1)
     RETURNING id::TEXT AS id`,
    [`opportunity-${token}.example.invalid`],
  )
  const clientProfileId = profileResult.rows[0].id
  const organizationId = organizationResult.rows[0].id

  const digestRunResult = await client.query(
    `INSERT INTO digest_runs (
       client_profile_id,
       status,
       requested_limit,
       selected_count,
       completed_at
     )
     VALUES ($1, 'completed', 5, 1, NOW())
     RETURNING id::TEXT AS id`,
    [clientProfileId],
  )
  const digestCandidateResult = await client.query(
    `INSERT INTO digest_candidates (
       digest_run_id,
       client_profile_id,
       org_id,
       source_display_name,
       source_families,
       vacancies_count,
       distinct_vacancy_names_count,
       total_score,
       reasons,
       opener
     )
     VALUES ($1, $2, $3, 'Opportunity Engine Test Organization',
       '["integration-test"]'::jsonb, 1, 1, 80, '[]'::jsonb, 'Test opener')
     RETURNING id::TEXT AS id`,
    [
      digestRunResult.rows[0].id,
      clientProfileId,
      organizationId,
    ],
  )
  const digestCandidateId = digestCandidateResult.rows[0].id

  const signalIds = []
  for (const publication of ['direct', 'mirror', 'archive', 'fresh']) {
    const signal = await client.query(
      `INSERT INTO signals (
         org_id,
         signal_type,
         source,
         external_id,
         headline,
         source_url,
         occurred_at
       )
       VALUES ($1, 'job_posting', 'integration-test', $2,
         'Backend developer', $3, NOW())
       RETURNING id::TEXT AS id`,
      [
        organizationId,
        `opportunity-${publication}-${token}`,
        `https://example.invalid/jobs/backend?publication=${publication}`,
      ],
    )
    signalIds.push(signal.rows[0].id)
  }

  const evidenceIds = []
  for (const evidenceName of ['first', 'second', 'third']) {
    const evidence = await client.query(
      `INSERT INTO evidence_items (
         org_id,
         source,
         url,
         fetched_at,
         content_hash,
         tier
       )
       VALUES ($1, 'integration-test', $2, NOW(), $3, 'corroboration')
       RETURNING id::TEXT AS id`,
      [
        organizationId,
        `https://example.invalid/evidence/${evidenceName}`,
        hash(`${token}:evidence:${evidenceName}`),
      ],
    )
    evidenceIds.push(evidence.rows[0].id)
  }

  const episodeIdentity = hash(`${organizationId}:role_cluster:engineering`)
  const firstEpisodeResult = await client.query(
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
       $1, 'role_cluster', 'role_cluster:engineering:g1', $2, 1,
       'Test hiring episode', 'Two publications describe one canonical vacancy.',
       NOW() - INTERVAL '3 days', NOW(), 2, 1, 0.8, 0.9, $3, 'hiring-episode-v1'
     )
     RETURNING id::TEXT AS id`,
    [organizationId, episodeIdentity, evidenceHash(signalIds.slice(0, 2))],
  )
  const firstEpisodeId = firstEpisodeResult.rows[0].id
  await reconcileEvidence(firstEpisodeId, organizationId, signalIds.slice(0, 2))

  const canonicalEvidence = await client.query(
    `SELECT
       episode.vacancy_count AS "vacancyCount",
       COUNT(link.id)::int AS "publicationCount"
     FROM hiring_episodes episode
     JOIN hiring_episode_evidence link ON link.hiring_episode_id = episode.id
     WHERE episode.id = $1
     GROUP BY episode.id`,
    [firstEpisodeId],
  )
  assert.deepEqual(canonicalEvidence.rows[0], {
    vacancyCount: 1,
    publicationCount: 2,
  })
  checks.push('canonical_vacancy_with_all_publications')

  await client.query(
    `UPDATE hiring_episodes
     SET last_seen_at = last_seen_at + INTERVAL '7 days'
     WHERE id = $1`,
    [firstEpisodeId],
  )
  const continuation = await client.query(
    `SELECT COUNT(*)::int AS count, MAX(episode_generation)::int AS generation
     FROM hiring_episodes
     WHERE organization_id = $1
       AND episode_identity = $2
       AND status = 'active'`,
    [organizationId, episodeIdentity],
  )
  assert.deepEqual(continuation.rows[0], { count: 1, generation: 1 })

  await client.query(
    `UPDATE hiring_episodes
     SET status = 'closed', closed_at = last_seen_at
     WHERE id = $1`,
    [firstEpisodeId],
  )
  const nextEpisodeResult = await client.query(
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
       $1, 'role_cluster', 'role_cluster:engineering:g2', $2, 2,
       'Restarted hiring episode', 'A new generation after inactivity.',
       NOW() + INTERVAL '40 days', NOW() + INTERVAL '40 days',
       1, 1, 0.8, 0.9, $3, 'hiring-episode-v1'
     )
     RETURNING id::TEXT AS id`,
    [
      organizationId,
      episodeIdentity,
      evidenceHash([signalIds[0]], [evidenceIds[0]]),
    ],
  )
  const hiringEpisodeId = nextEpisodeResult.rows[0].id
  await reconcileEvidence(
    hiringEpisodeId,
    organizationId,
    [signalIds[0]],
    [evidenceIds[0]],
  )
  const generations = await client.query(
    `SELECT
       ARRAY_AGG(episode_generation ORDER BY episode_generation) AS generations,
       COUNT(*) FILTER (WHERE status = 'active')::int AS "activeCount"
     FROM hiring_episodes
     WHERE organization_id = $1
       AND episode_identity = $2`,
    [organizationId, episodeIdentity],
  )
  assert.deepEqual(generations.rows[0], {
    generations: [1, 2],
    activeCount: 1,
  })
  await expectDatabaseRejection('duplicate-active-episode', () =>
    client.query(
      `INSERT INTO hiring_episodes (
         organization_id, episode_type, episode_key, episode_identity,
         episode_generation, title, summary, started_at, last_seen_at,
         signal_count, vacancy_count, strength_score, freshness_score,
         evidence_hash, engine_version
       )
       VALUES (
         $1, 'role_cluster', 'role_cluster:engineering:g3', $2, 3,
         'Duplicate', 'Must be rejected.', NOW(), NOW(),
         1, 1, 0.5, 0.5, $3, 'hiring-episode-v1'
       )`,
      [organizationId, episodeIdentity, hash('duplicate')],
    ))
  checks.push('episode_continuation_and_generation')

  const initialSignalIds = signalIds.slice(0, 3)
  const initialEvidenceIds = evidenceIds.slice(0, 2)
  const updatedSignalIds = signalIds.slice(1, 4)
  const updatedEvidenceIds = evidenceIds.slice(1, 3)
  await reconcileEvidence(
    hiringEpisodeId,
    organizationId,
    initialSignalIds,
    initialEvidenceIds,
  )
  await client.query('SAVEPOINT evidence_contraction')
  await reconcileEvidence(
    hiringEpisodeId,
    organizationId,
    updatedSignalIds,
    updatedEvidenceIds,
  )
  await client.query('ROLLBACK TO SAVEPOINT evidence_contraction')
  const restoredEvidence = await client.query(
    `SELECT
       COUNT(*)::int AS count,
       ARRAY_AGG(signal_id::TEXT ORDER BY signal_id)
         FILTER (WHERE signal_id IS NOT NULL) AS "signalIds",
       ARRAY_AGG(evidence_id::TEXT ORDER BY evidence_id)
         FILTER (WHERE evidence_id IS NOT NULL) AS "evidenceIds"
     FROM hiring_episode_evidence
     WHERE hiring_episode_id = $1`,
    [hiringEpisodeId],
  )
  assert.deepEqual(restoredEvidence.rows[0], {
    count: 5,
    signalIds: [...initialSignalIds].sort((a, b) => Number(a) - Number(b)),
    evidenceIds: [...initialEvidenceIds].sort((a, b) => Number(a) - Number(b)),
  })
  await reconcileEvidence(
    hiringEpisodeId,
    organizationId,
    updatedSignalIds,
    updatedEvidenceIds,
  )
  checks.push('atomic_evidence_expansion_and_contraction')

  const inputHashV1 = hash('stable-input-v1')
  const opportunityId = await insertOpportunity({
    ownerId,
    clientProfileId,
    organizationId,
    hiringEpisodeId,
    digestCandidateId,
    scoringVersion: 'opportunity-v1',
    inputHash: inputHashV1,
  })
  const sameInput = await client.query(
    `SELECT id::TEXT AS id
     FROM opportunities
     WHERE client_profile_id = $1
       AND hiring_episode_id = $2
       AND superseded_at IS NULL
       AND input_hash = $3`,
    [clientProfileId, hiringEpisodeId, inputHashV1],
  )
  assert.equal(sameInput.rows[0].id, opportunityId)
  const opportunityCountBefore = await client.query(
    `SELECT COUNT(*)::int AS count FROM opportunities
     WHERE client_profile_id = $1 AND hiring_episode_id = $2`,
    [clientProfileId, hiringEpisodeId],
  )
  assert.equal(opportunityCountBefore.rows[0].count, 1)
  checks.push('stable_same_input_build')

  const illegalActionCountBefore = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM opportunity_actions
     WHERE opportunity_id = $1`,
    [opportunityId],
  )
  await assert.rejects(
    transitionOpportunity({
      ownerId,
      opportunityId,
      action: 'contacted',
      actionKey: 'illegal:contacted',
      fingerprint: hash('illegal-contacted'),
    }),
    /forbidden transition/,
  )
  const illegalActionCountAfter = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM opportunity_actions
     WHERE opportunity_id = $1`,
    [opportunityId],
  )
  assert.equal(
    illegalActionCountAfter.rows[0].count,
    illegalActionCountBefore.rows[0].count,
  )
  checks.push('illegal_transition_has_no_action')

  const acceptedFingerprint = hash('accepted')
  const accepted = await transitionOpportunity({
    ownerId,
    opportunityId,
    action: 'accepted',
    actionKey: 'accepted:test',
    fingerprint: acceptedFingerprint,
  })
  assert.equal(accepted.replayed, false)
  const acceptedReplay = await transitionOpportunity({
    ownerId,
    opportunityId,
    action: 'accepted',
    actionKey: 'accepted:test',
    fingerprint: acceptedFingerprint,
  })
  assert.equal(acceptedReplay.replayed, true)
  await assert.rejects(
    transitionOpportunity({
      ownerId,
      opportunityId,
      action: 'accepted',
      actionKey: 'accepted:test',
      fingerprint: hash('different-accepted-payload'),
    }),
  )
  const legacyAfterAccepted = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM client_digest_org_state
     WHERE client_profile_id = $1
       AND org_id = $2`,
    [clientProfileId, organizationId],
  )
  assert.equal(legacyAfterAccepted.rows[0].count, 0)
  const acceptedState = await client.query(
    `SELECT status
     FROM client_episode_state
     WHERE client_profile_id = $1
       AND hiring_episode_id = $2`,
    [clientProfileId, hiringEpisodeId],
  )
  assert.equal(acceptedState.rows[0].status, 'accepted')

  await transitionOpportunity({
    ownerId,
    opportunityId,
    action: 'contacted',
    actionKey: 'contacted:test',
    fingerprint: hash('contacted'),
  })
  const contactedState = await client.query(
     `SELECT
       state.status,
       state.suppressed_until::TEXT AS "suppressedUntil",
       legacy.feedback_status AS "legacyFeedback"
      FROM client_episode_state state
      LEFT JOIN client_digest_org_state legacy
       ON legacy.client_profile_id = state.client_profile_id
      AND legacy.org_id = state.organization_id
     WHERE state.client_profile_id = $1
       AND state.hiring_episode_id = $2`,
    [clientProfileId, hiringEpisodeId],
  )
  assert.deepEqual(contactedState.rows[0], {
    status: 'contacted',
    suppressedUntil: null,
    legacyFeedback: null,
  })
  checks.push('accepted_then_episode_scoped_contacted')
  checks.push('action_idempotency')

  await expectDatabaseRejection('cross-tenant-action', () =>
    client.query(
      `INSERT INTO opportunity_actions (
         owner_id,
         opportunity_id,
         action_type,
         action_key,
         action_fingerprint
       )
       VALUES ($1, $2, 'dismissed', 'dismissed:other-tenant', $3)`,
      [otherOwnerId, opportunityId, hash('cross-tenant')],
    ))
  checks.push('tenant_ownership')

  await client.query(
    `UPDATE opportunities
     SET superseded_at = NOW()
     WHERE id = $1`,
    [opportunityId],
  )
  const opportunityV2Id = await insertOpportunity({
    ownerId,
    clientProfileId,
    organizationId,
    hiringEpisodeId,
    digestCandidateId,
    scoringVersion: 'opportunity-v2',
    inputHash: hash('stable-input-v2'),
    status: 'contacted',
  })
  const currentVersions = await client.query(
    `SELECT
       COUNT(*) FILTER (WHERE superseded_at IS NULL)::int AS "currentCount",
       ARRAY_AGG(scoring_version ORDER BY scoring_version) AS versions
     FROM opportunities
     WHERE client_profile_id = $1
       AND hiring_episode_id = $2`,
    [clientProfileId, hiringEpisodeId],
  )
  assert.deepEqual(currentVersions.rows[0], {
    currentCount: 1,
    versions: ['opportunity-v1', 'opportunity-v2'],
  })
  const currentList = await client.query(
    `SELECT id::TEXT AS id
     FROM opportunities
     WHERE owner_id = $1
       AND superseded_at IS NULL`,
    [ownerId],
  )
  assert.deepEqual(currentList.rows, [{ id: opportunityV2Id }])
  checks.push('single_current_scoring_version')
  checks.push('current_query_excludes_superseded')

  const lifecycleEpisode = await client.query(
    `INSERT INTO hiring_episodes (
       organization_id, episode_type, episode_key, episode_identity,
       episode_generation, title, summary, started_at, last_seen_at,
       signal_count, vacancy_count, strength_score, freshness_score,
       evidence_hash, engine_version
     )
     VALUES (
       $1, 'role_cluster', 'role_cluster:lifecycle:g1', $2, 1,
       'Lifecycle episode', 'Snooze and expiry verification.',
       NOW() - INTERVAL '10 days', NOW() - INTERVAL '1 day',
       1, 1, 0.7, 0.8, $3, 'hiring-episode-v1'
     )
     RETURNING id::TEXT AS id`,
    [organizationId, `${organizationId}:role_cluster:lifecycle`, hash('lifecycle-evidence')],
  )
  const lifecycleEpisodeId = lifecycleEpisode.rows[0].id
  const lifecycleOpportunityId = await insertOpportunity({
    ownerId,
    clientProfileId,
    organizationId,
    hiringEpisodeId: lifecycleEpisodeId,
    digestCandidateId,
    scoringVersion: 'opportunity-v1',
    inputHash: hash('lifecycle-input'),
    status: 'new',
  })
  await client.query(
    `UPDATE opportunities
     SET status = 'snoozed', snoozed_until = NOW() + INTERVAL '1 minute'
     WHERE id = $1`,
    [lifecycleOpportunityId],
  )
  await client.query(
    `INSERT INTO client_episode_state (
       client_profile_id, owner_id, hiring_episode_id,
       organization_id, status, suppressed_until
     )
     VALUES ($1, $2, $3, $4, 'snoozed', NOW() + INTERVAL '1 minute')`,
    [clientProfileId, ownerId, lifecycleEpisodeId, organizationId],
  )
  const awakened = await client.query(
    `UPDATE opportunities
     SET status = 'new', snoozed_until = NULL, updated_at = NOW()
     WHERE id = $1
       AND status = 'snoozed'
       AND snoozed_until <= NOW() + INTERVAL '2 minutes'
     RETURNING id`,
    [lifecycleOpportunityId],
  )
  assert.equal(awakened.rowCount, 1)
  await client.query(
    `DELETE FROM client_episode_state
     WHERE client_profile_id = $1
       AND hiring_episode_id = $2
       AND status = 'snoozed'`,
    [clientProfileId, lifecycleEpisodeId],
  )
  await client.query(
    `UPDATE hiring_episodes
     SET status = 'closed', closed_at = NOW()
     WHERE id = $1`,
    [lifecycleEpisodeId],
  )
  const expired = await client.query(
    `UPDATE opportunities opportunity
     SET status = 'expired', updated_at = NOW()
     FROM hiring_episodes episode
     WHERE opportunity.id = $1
       AND episode.id = opportunity.hiring_episode_id
       AND episode.status = 'closed'
       AND opportunity.status IN ('new', 'review', 'snoozed')
     RETURNING opportunity.status`,
    [lifecycleOpportunityId],
  )
  assert.equal(expired.rows[0].status, 'expired')
  const lifecycleState = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM client_episode_state
     WHERE client_profile_id = $1
       AND hiring_episode_id = $2`,
    [clientProfileId, lifecycleEpisodeId],
  )
  assert.equal(lifecycleState.rows[0].count, 0)
  checks.push('expire_snooze_lifecycle')

  const firstLock = await client.query(
    'SELECT pg_try_advisory_lock($1::bigint) AS locked',
    [JOB_LOCK_KEY],
  )
  assert.equal(firstLock.rows[0].locked, true)
  const competingLock = await competingClient.query(
    'SELECT pg_try_advisory_lock($1::bigint) AS locked',
    [JOB_LOCK_KEY],
  )
  assert.equal(competingLock.rows[0].locked, false)
  await client.query('SELECT pg_advisory_unlock($1::bigint)', [JOB_LOCK_KEY])
  const lockAfterRelease = await competingClient.query(
    'SELECT pg_try_advisory_lock($1::bigint) AS locked',
    [JOB_LOCK_KEY],
  )
  assert.equal(lockAfterRelease.rows[0].locked, true)
  await competingClient.query('SELECT pg_advisory_unlock($1::bigint)', [JOB_LOCK_KEY])
  checks.push('cron_advisory_lock')

  const scriptDirectory = dirname(fileURLToPath(import.meta.url))
  const jobsSource = await readFile(
    resolve(scriptDirectory, '../../../apps/web/lib/opportunities/jobs.ts'),
    'utf8',
  )
  const buildQueryMatch = jobsSource.match(
    /const OPPORTUNITY_BUILD_QUERY = `([\s\S]*?)`\r?\n/,
  )
  assert.ok(buildQueryMatch, 'the opportunity build query must be discoverable')
  assert.doesNotMatch(buildQueryMatch[1], /\bCROSS\s+JOIN\b/i)
  assert.match(buildQueryMatch[1], /FROM latest_candidates dc/)
  assert.match(buildQueryMatch[1], /JOIN client_profiles cp ON cp\.id = dc\.client_profile_id/)
  const explain = await client.query(
    `EXPLAIN (FORMAT JSON)
     ${buildQueryMatch[1]}
     WHERE he.status = 'active'
       AND cp.is_active = TRUE
       AND cp.owner_id IS NOT NULL
       AND ($1::bigint IS NULL OR he.organization_id = $1)
       AND dc.created_at >= he.started_at
       AND dc.created_at >= he.last_seen_at
       AND dc.created_at >= cp.updated_at
     ORDER BY he.last_seen_at DESC, he.id DESC, cp.id DESC
     LIMIT $2`,
    [organizationId, 50, 'opportunity-v2', false, null],
  )
  assert.ok(explain.rows[0]['QUERY PLAN'][0].Plan)
  checks.push('build_query_explain_without_cross_join')

  console.log(JSON.stringify({ ok: true, checks }, null, 2))
} finally {
  try {
    await client.query('ROLLBACK')
  } catch {
    // The connection may have failed before the transaction began.
  }
  await competingClient.end().catch(() => undefined)
  await client.end().catch(() => undefined)
}
