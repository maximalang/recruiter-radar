import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import pg from 'pg'

import {
  COMMERCIAL_SIGNAL_ISOLATED_TEST_CLEANUP_SQL,
} from './lib/commercial-signal-isolated-test-cleanup.mjs'

const { Client } = pg
const execFileAsync = promisify(execFile)

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required.')

const root = resolve(import.meta.dirname, '..', '..', '..')
const migrationsDir = resolve(root, 'packages', 'db', 'migrations')
const migrateScript = resolve(root, 'packages', 'db', 'scripts', 'migrate.mjs')
const downMigrations = [
  '20260814030000_add_source_temporal_health.down.sql',
  '20260812150000_add_source_signal_evidence_lineage.down.sql',
  '20260809140000_add_query_plan_quality_feedback_v2.down.sql',
  '20260809130000_add_commercial_signal_quality_v2.down.sql',
  '20260807180500_complete_query_plan_supply_metrics.down.sql',
  '20260807175500_extend_commercial_signal_annotation_taxonomy.down.sql',
  '20260807174500_extend_query_plan_yield_metrics.down.sql',
  '20260807173600_enforce_company_event_publication_append_only.down.sql',
  '20260807173500_restore_immutable_company_event_publications.down.sql',
  '20260807173000_harden_company_event_and_enrichment_lineage.down.sql',
  '20260807170000_add_commercial_signal_canary_runtime.down.sql',
  '20260804160000_add_query_planner_v2.down.sql',
  '20260804150000_add_opportunity_candidates_v3.down.sql',
  '20260804140000_add_agency_dna_match_v2.down.sql',
  '20260804130000_add_external_agency_propensity_v1.down.sql',
  '20260804120000_add_commercial_theses_v1.down.sql',
  '20260804110000_add_signal_episodes_v2.down.sql',
  '20260804100000_add_company_state_v1.down.sql',
  '20260803120000_add_company_events_v1.down.sql',
  '20260802100000_add_opportunity_crm_delivery_claims.down.sql',
  '20260801151000_enforce_opportunity_analytics_assignee_scope.down.sql',
  '20260801150000_add_opportunity_analytics_v2.down.sql',
  '20260801140000_add_opportunity_crm_bridge.down.sql',
  '20260801130000_add_opportunity_workflow_v1.down.sql',
  '20260801120000_add_opportunity_scoring_v2.down.sql',
  '20260801100000_add_agency_dna_v1.down.sql',
  '20260731100000_add_opportunity_workspace_actor_context.down.sql',
  '20260728112000_enforce_outcome_correction_capability.down.sql',
  '20260728111000_enforce_opportunity_outcome_write_boundary.down.sql',
  '20260728110000_complete_opportunity_meeting_lifecycle.down.sql',
  '20260728100000_harden_opportunity_outcome_ledger.down.sql',
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
const PRE_FIXTURE_DOWN_MIGRATIONS = 28

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
  return {
    ownerId,
    clientProfileId: profile.rows[0].id,
    organizationId: organization.rows[0].id,
    hiringEpisodeId: episode.rows[0].id,
    historicalOpportunityId,
    newerOpportunityId,
  }
}

async function verifyHardenedOutcomeRollbackGuards(database, fixture) {
  const downSql = await readFile(
    resolve(
      migrationsDir,
      '20260728100000_harden_opportunity_outcome_ledger.down.sql',
    ),
    'utf8',
  )

  const insertEvent = async ({
    eventType,
    previousStage,
    newStage,
    key,
    contact = false,
    snoozed = false,
  }) => {
    const result = await database.query(
      `INSERT INTO opportunity_outcome_events (
         owner_id, client_profile_id, opportunity_id, hiring_episode_id,
         organization_id, event_type, previous_stage, new_stage, channel,
         contact_reference_hash, contact_reference_label, snoozed_until,
         occurred_at, actor_type, metadata, analytics_snapshot,
         idempotency_key, payload_hash
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9,
         $10, $11, $12::timestamptz, NOW(), 'system',
         '{}'::jsonb, '{}'::jsonb, $13, repeat('a', 64)
       )
       RETURNING id::TEXT AS id, occurred_at::TEXT AS "occurredAt"`,
      [
        fixture.ownerId,
        fixture.clientProfileId,
        fixture.historicalOpportunityId,
        fixture.hiringEpisodeId,
        fixture.organizationId,
        eventType,
        previousStage,
        newStage,
        contact ? 'email' : null,
        contact ? 'b'.repeat(64) : null,
        contact ? 's***@example.invalid' : null,
        snoozed ? new Date(Date.now() + 7 * 86_400_000).toISOString() : null,
        key,
      ],
    )
    return result.rows[0]
  }

  const rejectDown = async (message) => {
    let rejected = false
    try {
      await database.query(downSql)
    } catch (error) {
      rejected = error instanceof Error && error.message.includes(message)
      await database.query('ROLLBACK').catch(() => undefined)
    }
    if (!rejected) {
      throw new Error(`Hardened outcome rollback did not reject: ${message}`)
    }
  }

  const cleanup = async () => {
    await database.query(
      `DELETE FROM opportunity_outcome_state
       WHERE owner_id = $1 AND opportunity_id = $2`,
      [fixture.ownerId, fixture.historicalOpportunityId],
    )
    await database.query(
      'ALTER TABLE opportunity_outcome_events DISABLE TRIGGER opportunity_outcome_events_append_only',
    )
    try {
      await database.query(
        `DELETE FROM opportunity_outcome_events
         WHERE owner_id = $1 AND opportunity_id = $2`,
        [fixture.ownerId, fixture.historicalOpportunityId],
      )
    } finally {
      await database.query(
        'ALTER TABLE opportunity_outcome_events ENABLE TRIGGER opportunity_outcome_events_append_only',
      )
    }
  }

  const contacted = await insertEvent({
    eventType: 'contacted',
    previousStage: 'accepted',
    newStage: 'contacted',
    key: `rollback-contact:${process.pid}`,
    contact: true,
  })
  await database.query(
    `INSERT INTO opportunity_outcome_state (
       owner_id, client_profile_id, opportunity_id, hiring_episode_id,
       organization_id, current_stage, commercial_stage, workflow_state,
       last_event_id, last_event_at, last_stage_event_id, last_stage_event_at,
       contacted_at
     )
     VALUES (
       $1, $2, $3, $4, $5, 'contacted', 'contacted', 'active',
       $6, $7::timestamptz, $6, $7::timestamptz, $7::timestamptz
     )`,
    [
      fixture.ownerId,
      fixture.clientProfileId,
      fixture.historicalOpportunityId,
      fixture.hiringEpisodeId,
      fixture.organizationId,
      contacted.id,
      contacted.occurredAt,
    ],
  )
  await rejectDown('protected contact references exist')
  await cleanup()

  const snoozed = await insertEvent({
    eventType: 'snoozed',
    previousStage: 'accepted',
    newStage: 'accepted',
    key: `rollback-snooze:${process.pid}`,
    snoozed: true,
  })
  await database.query(
    `INSERT INTO opportunity_outcome_state (
       owner_id, client_profile_id, opportunity_id, hiring_episode_id,
       organization_id, current_stage, commercial_stage, workflow_state,
       snoozed_until, last_event_id, last_event_at
     )
     VALUES (
       $1, $2, $3, $4, $5, 'accepted', 'accepted', 'snoozed',
       NOW() + INTERVAL '7 days', $6, $7::timestamptz
     )`,
    [
      fixture.ownerId,
      fixture.clientProfileId,
      fixture.historicalOpportunityId,
      fixture.hiringEpisodeId,
      fixture.organizationId,
      snoozed.id,
      snoozed.occurredAt,
    ],
  )
  await rejectDown('snoozed workflow state exists')
  await cleanup()
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
    for (const migration of downMigrations.slice(0, PRE_FIXTURE_DOWN_MIGRATIONS)) {
      await database.query(await readFile(resolve(migrationsDir, migration), 'utf8'))
      if (migration ===
          '20260807170000_add_commercial_signal_canary_runtime.down.sql') {
        await database.query(COMMERCIAL_SIGNAL_ISOLATED_TEST_CLEANUP_SQL)
      }
    }
    const fixture = await seedSupersessionRollbackFixture(database)
    await verifyHardenedOutcomeRollbackGuards(database, fixture)
    for (const migration of downMigrations.slice(PRE_FIXTURE_DOWN_MIGRATIONS)) {
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
