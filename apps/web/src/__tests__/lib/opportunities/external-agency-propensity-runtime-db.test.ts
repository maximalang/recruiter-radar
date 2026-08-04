import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Pool } from 'pg'

import {
  buildExternalAgencyPropensity,
  type ExternalAgencyPropensityDraft,
} from '@/lib/opportunities/external-agency-propensity'
import {
  buildExternalAgencyPropensityJob,
  type ExternalAgencyPropensityJobDb,
} from '@/lib/opportunities/external-agency-propensity-job'
import {
  persistExternalAgencyPropensity,
  type ExternalAgencyPropensityDb,
} from '@/lib/opportunities/external-agency-propensity-repository'

const databaseUrl = process.env.DATABASE_URL
const isolatedDatabaseAcknowledged =
  process.env.EXTERNAL_AGENCY_PROPENSITY_V1_DB_TEST_ACK === 'isolated'
const describeIfDatabase = databaseUrl && isolatedDatabaseAcknowledged
  ? describe
  : describe.skip

describeIfDatabase('External Agency Propensity v1 PostgreSQL runtime', () => {
  const database = new Pool({ connectionString: databaseUrl })
  const repositoryDb = database as unknown as ExternalAgencyPropensityDb
  const jobDb = database as unknown as ExternalAgencyPropensityJobDb
  const token = randomUUID()
  const now = new Date('2026-08-04T12:00:00.000Z')
  const ownerIds: string[] = []
  let organizationId = ''
  let evidenceIds: string[] = []
  let unlinkedEvidenceId = ''
  let profileId = ''
  let workspaceId = ''
  let otherProfileId = ''
  let commercialThesisId = ''
  let persistedSnapshotId = ''
  const thesisIdentity = 'b'.repeat(64)
  const thesisInputHash = 'c'.repeat(64)
  const thesisEvidenceHash = 'd'.repeat(64)

  beforeAll(async () => {
    const owners = await database.query<{ id: string }>(
      `INSERT INTO users (email, full_name)
       VALUES ($1, 'Propensity runtime'), ($2, 'Propensity other tenant')
       RETURNING id::TEXT AS id`,
      [
        `external-propensity-${token}@example.invalid`,
        `external-propensity-other-${token}@example.invalid`,
      ],
    )
    ownerIds.push(...owners.rows.map((row) => row.id))
    const profiles = await database.query<{
      id: string
      ownerId: string
      workspaceId: string
    }>(
      `INSERT INTO client_profiles (
         agency_name, owner_id, service_types, target_seniorities
       ) VALUES
         ('Propensity runtime', $1, ARRAY['permanent'], ARRAY['senior']),
         ('Propensity other', $2, ARRAY['executive'], ARRAY['executive'])
       RETURNING id::TEXT AS id, owner_id::TEXT AS "ownerId",
         workspace_id::TEXT AS "workspaceId"`,
      ownerIds,
    )
    const profile = profiles.rows.find((row) => row.ownerId === ownerIds[0])
    const otherProfile = profiles.rows.find((row) => row.ownerId === ownerIds[1])
    if (!profile || !otherProfile) throw new Error('Profile fixtures were not created.')
    profileId = profile.id
    workspaceId = profile.workspaceId
    otherProfileId = otherProfile.id

    const organization = await database.query<{ id: string }>(
      `INSERT INTO orgs (name, domain)
       VALUES ('External propensity runtime', $1)
       RETURNING id::TEXT AS id`,
      [`external-propensity-${token}.example.invalid`],
    )
    organizationId = organization.rows[0].id
    const evidence = await database.query<{ id: string; source: string }>(
      `INSERT INTO evidence_items (
         org_id, source, url, fetched_at, content_hash, tier
       ) VALUES
         ($1, 'career-pages', $2, '2026-08-04T09:00:00Z', $5, 'direct'),
         ($1, 'hh', $3, '2026-08-04T09:30:00Z', $6, 'direct'),
         ($1, 'company-site', $4, '2026-08-04T09:45:00Z', $7, 'direct')
       RETURNING id::TEXT AS id, source`,
      [
        organizationId,
        `https://external-propensity.example.invalid/${token}/career`,
        `https://external-propensity.example.invalid/${token}/hh`,
        `https://external-propensity.example.invalid/${token}/unlinked`,
        '1'.repeat(64),
        '2'.repeat(64),
        '3'.repeat(64),
      ],
    )
    evidenceIds = evidence.rows.slice(0, 2).map((row) => row.id)
    unlinkedEvidenceId = evidence.rows[2].id

    const event = await database.query<{ id: string }>(
      `INSERT INTO company_events (
         organization_id, event_type, occurred_at, first_seen_at, last_seen_at,
         source_family, source_record_id, evidence_ids, event_fingerprint,
         confidence, payload, normalizer_version
       ) VALUES (
         $1, 'job_posting', '2026-08-04T08:00:00Z',
         '2026-08-04T09:00:00Z', '2026-08-04T10:00:00Z',
         'career-pages', $2, $3::BIGINT[], $4, 0.9,
         '{"title":"Senior Backend Engineer","region":"Moscow"}',
         'company-event-normalizer-v1'
       ) RETURNING id::TEXT AS id`,
      [organizationId, `external-propensity-${token}`, evidenceIds, '4'.repeat(64)],
    )
    const eventId = event.rows[0].id
    await database.query(
      `INSERT INTO company_event_evidence (
         company_event_id, organization_id, evidence_id
       ) SELECT $1, $2, evidence_id
         FROM UNNEST($3::BIGINT[]) AS evidence_id`,
      [eventId, organizationId, evidenceIds],
    )
    const snapshot = await database.query<{ id: string }>(
      `INSERT INTO company_state_snapshots (
         organization_id, snapshot_at, observation_started_at,
         observation_ended_at, hiring_baseline, current_hiring_velocity,
         role_distribution, seniority_distribution, region_distribution,
         vacancy_lifetime, repost_rate, recruiting_capacity_signals,
         business_change_signals, state_classification, state_confidence,
         feature_version, evidence_hash, input_hash
       ) VALUES (
         $1, '2026-08-04T10:00:00Z', '2026-06-01T00:00:00Z',
         '2026-08-04T10:00:00Z',
         '{"vacancies14d":1,"sufficientHistory":true}',
         '{"vacancies14d":4,"baselineDeviation14d":3,"direction":"up"}',
         '{"current":{"backend":4},"baseline":{"backend":1}}',
         '{"current":{"senior":3},"baseline":{"senior":1}}',
         '{"current":{"Moscow":4},"baseline":{"Moscow":1},"newRegions":[]}',
         '{"observedCount":4,"medianDays":2}',
         '{"supported":false,"observedCount":4,"repostCount":0,"rate":null}',
         '{"currentRecruiterVacancies":0,"baselineRecruiterVacancies":0}',
         '{"current30d":{}}', 'accelerating', 0.9, 'company-state-v1',
         $2, $3
       ) RETURNING id::TEXT AS id`,
      [organizationId, '5'.repeat(64), '6'.repeat(64)],
    )
    const companySnapshotId = snapshot.rows[0].id
    await database.query(
      `INSERT INTO company_state_snapshot_events (
         snapshot_id, organization_id, company_event_id
       ) VALUES ($1, $2, $3)`,
      [companySnapshotId, organizationId, eventId],
    )
    await database.query(
      `INSERT INTO company_state_snapshot_evidence (
         snapshot_id, organization_id, evidence_id
       ) SELECT $1, $2, evidence_id
         FROM UNNEST($3::BIGINT[]) AS evidence_id`,
      [companySnapshotId, organizationId, evidenceIds],
    )
    const change = await database.query<{ id: string }>(
      `INSERT INTO company_state_changes (
         snapshot_id, organization_id, change_type, direction, dimension,
         magnitude, baseline_deviation, confidence, evidence_hash,
         change_fingerprint, feature_version, payload
       ) VALUES (
         $1, $2, 'hiring_acceleration', 'up', 'all', 3, 1.5, 0.9,
         $3, $4, 'company-state-v1', '{"currentVacancies14d":4}'
       ) RETURNING id::TEXT AS id`,
      [companySnapshotId, organizationId, '7'.repeat(64), '8'.repeat(64)],
    )
    const changeId = change.rows[0].id
    await database.query(
      `INSERT INTO company_state_change_events (
         change_id, organization_id, company_event_id
       ) VALUES ($1, $2, $3)`,
      [changeId, organizationId, eventId],
    )
    await database.query(
      `INSERT INTO company_state_change_evidence (
         change_id, organization_id, evidence_id
       ) SELECT $1, $2, evidence_id
         FROM UNNEST($3::BIGINT[]) AS evidence_id`,
      [changeId, organizationId, evidenceIds],
    )
    const episode = await database.query<{ id: string }>(
      `INSERT INTO signal_episodes (
         organization_id, episode_identity, episode_generation, episode_type,
         stage, started_at, last_seen_at, valid_until, intensity, direction,
         baseline_deviation, role_families, regions, seniority_distribution,
         problem_hypotheses, evidence_hash, input_hash, engine_version
       ) VALUES (
         $1, $2, 1, 'vacancy_acceleration', 'active',
         '2026-08-01T09:00:00Z', '2026-08-04T10:00:00Z',
         '2026-08-25T10:00:00Z', 0.82, 'up', 1.5,
         ARRAY['backend', 'platform'], ARRAY['Moscow'], '{"senior":3}',
         ARRAY['delivery_capacity_pressure'], $3, $4, 'signal-episode-v2'
       ) RETURNING id::TEXT AS id`,
      [organizationId, '9'.repeat(64), thesisEvidenceHash, 'a'.repeat(64)],
    )
    const episodeId = episode.rows[0].id
    await database.query(
      `INSERT INTO signal_episode_state_changes (
         signal_episode_id, organization_id, company_state_change_id
       ) VALUES ($1, $2, $3)`,
      [episodeId, organizationId, changeId],
    )
    await database.query(
      `INSERT INTO signal_episode_events (
         signal_episode_id, organization_id, company_event_id
       ) VALUES ($1, $2, $3)`,
      [episodeId, organizationId, eventId],
    )
    await database.query(
      `INSERT INTO signal_episode_evidence (
         signal_episode_id, organization_id, evidence_id
       ) SELECT $1, $2, evidence_id
         FROM UNNEST($3::BIGINT[]) AS evidence_id`,
      [episodeId, organizationId, evidenceIds],
    )
    const section = JSON.stringify([{
      classification: 'confirmed_fact',
      code: 'vacancy_acceleration_observed',
      text: 'Hiring activity accelerated relative to baseline.',
      evidenceRefs: evidenceIds,
    }])
    const thesisClient = await database.connect()
    try {
      await thesisClient.query('BEGIN')
      const thesis = await thesisClient.query<{ id: string }>(
        `INSERT INTO commercial_theses (
         organization_id, signal_episode_id, signal_episode_generation,
         thesis_identity, thesis_generation, what_changed, why_it_matters,
         probable_hiring_problem, why_external_agency_may_be_needed,
         why_this_agency_fits, why_now, recommended_service,
         recommended_persona, recommended_angle, risks, limitations,
         evidence_hash, input_hash, engine_version
       ) VALUES (
         $1, $2, 1, $3, 1, $4::JSONB, $4::JSONB, $4::JSONB,
         $4::JSONB, $4::JSONB, $4::JSONB, $4::JSONB, $4::JSONB,
         $4::JSONB, $4::JSONB, $4::JSONB, $5, $6, 'commercial-thesis-v1'
       ) RETURNING id::TEXT AS id`,
        [
          organizationId,
          episodeId,
          thesisIdentity,
          section,
          thesisEvidenceHash,
          thesisInputHash,
        ],
      )
      commercialThesisId = thesis.rows[0].id
      await thesisClient.query(
        `INSERT INTO commercial_thesis_evidence (
         commercial_thesis_id, organization_id, evidence_id
       ) SELECT $1, $2, evidence_id
         FROM UNNEST($3::BIGINT[]) AS evidence_id`,
        [commercialThesisId, organizationId, evidenceIds],
      )
      await thesisClient.query('COMMIT')
    } catch (error) {
      await thesisClient.query('ROLLBACK')
      throw error
    } finally {
      thesisClient.release()
    }
  })

  afterAll(async () => {
    await database.query('TRUNCATE TABLE external_agency_propensity_snapshots CASCADE')
    await database.query('TRUNCATE TABLE commercial_theses CASCADE')
    await database.query('TRUNCATE TABLE signal_episodes CASCADE')
    await database.query('TRUNCATE TABLE company_state_snapshots CASCADE')
    await database.query('TRUNCATE TABLE company_events CASCADE')
    await database.query('DELETE FROM evidence_items WHERE org_id = $1', [organizationId])
    await database.query('DELETE FROM orgs WHERE id = $1', [organizationId])
    await database.query(
      'DELETE FROM client_profiles WHERE owner_id = ANY($1::BIGINT[])',
      [ownerIds],
    )
    await database.query(
      'DELETE FROM workspaces WHERE bootstrap_user_id = ANY($1::BIGINT[])',
      [ownerIds],
    )
    await database.query('DELETE FROM users WHERE id = ANY($1::BIGINT[])', [ownerIds])
    await database.end()
  })

  it('previews, applies, no-ops, and advances when Agency DNA changes', async () => {
    const options = {
      env: { EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED: 'true' },
      workspaceId,
      organizationId,
      now,
    }
    await expect(buildExternalAgencyPropensityJob(options, jobDb)).resolves
      .toMatchObject({
        dryRun: true,
        scanned: 1,
        built: 1,
        high: 1,
        persisted: 0,
        failed: 0,
      })
    await expect(buildExternalAgencyPropensityJob({
      ...options,
      dryRun: false,
    }, jobDb)).resolves.toMatchObject({
      dryRun: false,
      scanned: 1,
      built: 1,
      high: 1,
      persisted: 1,
      failed: 0,
    })
    await expect(buildExternalAgencyPropensityJob({
      ...options,
      dryRun: false,
    }, jobDb)).resolves.toMatchObject({
      scanned: 0,
      built: 0,
      persisted: 0,
      replayed: 0,
    })

    await database.query(
      `UPDATE client_profiles SET current_capacity = 'high' WHERE id = $1`,
      [profileId],
    )
    await expect(buildExternalAgencyPropensityJob({
      ...options,
      dryRun: false,
    }, jobDb)).resolves.toMatchObject({
      scanned: 1,
      built: 1,
      persisted: 1,
      failed: 0,
    })
    const stored = await database.query<{
      id: string
      generation: number
      agencyDnaVersion: number
    }>(
      `SELECT id::TEXT AS id, propensity_generation AS generation,
         agency_dna_version::INTEGER AS "agencyDnaVersion"
       FROM external_agency_propensity_snapshots
       WHERE workspace_id = $1 AND client_profile_id = $2
       ORDER BY propensity_generation`,
      [workspaceId, profileId],
    )
    expect(stored.rows.map(({ generation, agencyDnaVersion }) => ({
      generation,
      agencyDnaVersion,
    }))).toEqual([
      { generation: 1, agencyDnaVersion: 1 },
      { generation: 2, agencyDnaVersion: 2 },
    ])
    persistedSnapshotId = stored.rows[0].id
  })

  it('rejects cross-tenant profile scope and evidence outside the thesis', async () => {
    const valid = await currentDraft()
    await expect(persistExternalAgencyPropensity({
      ...valid,
      clientProfileId: otherProfileId,
      inputHash: 'e'.repeat(64),
    }, repositoryDb)).rejects.toMatchObject({ code: expect.stringMatching(/23503|23514/) })

    const unsupported = buildDraft({
      profile: await currentProfile(),
      evidence: [unlinkedEvidenceId],
      sourceFamilies: ['company-site'],
    })
    await expect(persistExternalAgencyPropensity(unsupported, repositoryDb))
      .rejects.toMatchObject({ code: '23514' })
  })

  it('keeps rows append-only and refuses a data-loss rollback', async () => {
    await expect(database.query(
      `UPDATE external_agency_propensity_snapshots SET score = 0 WHERE id = $1`,
      [persistedSnapshotId],
    )).rejects.toMatchObject({ code: '55000' })
    const rollback = readFileSync(resolve(
      process.cwd(),
      '..',
      '..',
      'packages',
      'db',
      'migrations',
      '20260804130000_add_external_agency_propensity_v1.down.sql',
    ), 'utf8')
    await expect(database.query(rollback)).rejects.toMatchObject({ code: 'P0001' })
    await database.query('ROLLBACK')
  })

  async function currentDraft(): Promise<ExternalAgencyPropensityDraft> {
    return buildDraft({
      profile: await currentProfile(),
      evidence: evidenceIds,
      sourceFamilies: ['career-pages', 'hh'],
    })
  }

  async function currentProfile(): Promise<{
    version: number
    hash: string
  }> {
    const profile = await database.query<{ version: number; hash: string }>(
      `SELECT agency_dna_version::INTEGER AS version,
         agency_dna_snapshot_hash AS hash
       FROM client_profiles WHERE id = $1`,
      [profileId],
    )
    return profile.rows[0]
  }

  function buildDraft(input: {
    profile: { version: number; hash: string }
    evidence: string[]
    sourceFamilies: string[]
  }): ExternalAgencyPropensityDraft {
    return buildExternalAgencyPropensity({
      organizationId,
      workspaceId,
      ownerId: ownerIds[0],
      clientProfileId: profileId,
      commercialThesisId,
      commercialThesisGeneration: 1,
      thesisIdentity,
      thesisInputHash,
      thesisEvidenceHash,
      agencyDnaVersion: input.profile.version,
      agencyDnaSnapshotHash: input.profile.hash,
      episodeType: 'vacancy_acceleration',
      episodeIntensity: 0.82,
      episodeLastSeenAt: '2026-08-04T10:00:00.000Z',
      episodeValidUntil: '2026-08-25T10:00:00.000Z',
      roleFamilies: ['backend', 'platform'],
      seniorityDistribution: { senior: 3 },
      evidenceIds: input.evidence,
      evidenceSourceFamilies: input.sourceFamilies,
      accountRestriction: null,
    }, { now })
  }
})
