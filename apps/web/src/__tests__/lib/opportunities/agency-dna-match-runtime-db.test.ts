import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Pool } from 'pg'

import {
  buildAgencyDnaMatch,
  type AgencyDnaMatchDraft,
  type AgencyDnaMatchInput,
} from '@/lib/opportunities/agency-dna-match'
import {
  buildAgencyDnaMatchJob,
  type AgencyDnaMatchJobDb,
} from '@/lib/opportunities/agency-dna-match-job'
import {
  persistAgencyDnaMatch,
  type AgencyDnaMatchDb,
} from '@/lib/opportunities/agency-dna-match-repository'
import {
  buildExternalAgencyPropensityJob,
  type ExternalAgencyPropensityJobDb,
} from '@/lib/opportunities/external-agency-propensity-job'

const databaseUrl = process.env.DATABASE_URL
const isolated = process.env.AGENCY_DNA_MATCH_V2_DB_TEST_ACK === 'isolated'
const describeIfDatabase = databaseUrl && isolated ? describe : describe.skip

describeIfDatabase('Agency DNA Match v2 PostgreSQL runtime', () => {
  const database = new Pool({ connectionString: databaseUrl })
  const matchDb = database as unknown as AgencyDnaMatchDb
  const matchJobDb = database as unknown as AgencyDnaMatchJobDb
  const propensityJobDb = database as unknown as ExternalAgencyPropensityJobDb
  const token = randomUUID()
  const now = new Date('2026-08-04T12:00:00.000Z')
  const ownerIds: string[] = []
  let organizationId = ''
  let evidenceIds: string[] = []
  let unlinkedEvidenceId = ''
  let profileId = ''
  let otherProfileId = ''
  let workspaceId = ''
  let commercialThesisId = ''
  let persistedMatchId = ''

  beforeAll(async () => {
    const owners = await database.query<{ id: string }>(
      `INSERT INTO users (email, full_name)
       VALUES ($1, 'Agency match runtime'), ($2, 'Agency match other tenant')
       RETURNING id::TEXT AS id`,
      [
        `agency-match-${token}@example.invalid`,
        `agency-match-other-${token}@example.invalid`,
      ],
    )
    ownerIds.push(...owners.rows.map((row) => row.id))
    const profiles = await database.query<{
      id: string
      ownerId: string
      workspaceId: string
    }>(
      `INSERT INTO client_profiles (
         agency_name, owner_id, specialization, roles, industries, target_city,
         preferred_regions, service_types, target_seniorities,
         technology_qualification_tags, current_capacity
       ) VALUES
         ('Agency match runtime', $1, 'backend', ARRAY['it-engineering'],
          '["technology"]', 'Moscow', ARRAY['Moscow'], ARRAY['permanent'],
          ARRAY['senior'], ARRAY['python'], 'normal'),
         ('Agency match other', $2, 'executive', ARRAY['management'],
          '["finance"]', 'Kazan', ARRAY['Kazan'], ARRAY['executive'],
          ARRAY['executive'], ARRAY[]::TEXT[], 'normal')
       RETURNING id::TEXT AS id, owner_id::TEXT AS "ownerId",
         workspace_id::TEXT AS "workspaceId"`,
      ownerIds,
    )
    const profile = profiles.rows.find((row) => row.ownerId === ownerIds[0])
    const other = profiles.rows.find((row) => row.ownerId === ownerIds[1])
    if (!profile || !other) throw new Error('Agency DNA fixtures were not created.')
    profileId = profile.id
    workspaceId = profile.workspaceId
    otherProfileId = other.id

    const organization = await database.query<{ id: string }>(
      `INSERT INTO orgs (name, domain, industry, city, country)
       VALUES ('Agency match runtime', $1, 'technology', 'Moscow', 'RU')
       RETURNING id::TEXT AS id`,
      [`agency-match-${token}.example.invalid`],
    )
    organizationId = organization.rows[0].id
    const evidence = await database.query<{ id: string }>(
      `INSERT INTO evidence_items (
         org_id, source, url, fetched_at, content_hash, tier
       ) VALUES
         ($1, 'career-pages', $2, '2026-08-04T09:00:00Z', $5, 'direct'),
         ($1, 'hh', $3, '2026-08-04T09:30:00Z', $6, 'direct'),
         ($1, 'company-site', $4, '2026-08-04T09:45:00Z', $7, 'direct')
       RETURNING id::TEXT AS id`,
      [
        organizationId,
        `https://agency-match.example.invalid/${token}/career`,
        `https://agency-match.example.invalid/${token}/hh`,
        `https://agency-match.example.invalid/${token}/unlinked`,
        '1'.repeat(64),
        '2'.repeat(64),
        '3'.repeat(64),
      ],
    )
    evidenceIds = evidence.rows.slice(0, 2).map((row) => row.id)
    unlinkedEvidenceId = evidence.rows[2].id
    commercialThesisId = await seedCommercialThesis()
  })

  afterAll(async () => {
    await database.query('TRUNCATE TABLE agency_dna_match_snapshots CASCADE')
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

  it('previews, applies, no-ops, and advances only after upstream Agency DNA refresh', async () => {
    await buildPropensity()
    const options = {
      env: { AGENCY_DNA_MATCH_V2_ENABLED: 'true' },
      workspaceId,
      organizationId,
    }
    await expect(buildAgencyDnaMatchJob(options, matchJobDb)).resolves
      .toMatchObject({
        dryRun: true,
        scanned: 1,
        built: 1,
        strong: 1,
        persisted: 0,
        failed: 0,
      })
    await expect(buildAgencyDnaMatchJob({
      ...options,
      dryRun: false,
    }, matchJobDb)).resolves.toMatchObject({
      scanned: 1,
      built: 1,
      strong: 1,
      persisted: 1,
      failed: 0,
    })
    await expect(buildAgencyDnaMatchJob({
      ...options,
      dryRun: false,
    }, matchJobDb)).resolves.toMatchObject({ scanned: 0, persisted: 0 })

    const first = await storedMatches()
    persistedMatchId = first[0].id
    expect(first.map((row) => ({
      generation: row.generation,
      capacity: row.capacity,
      quota: row.quota,
    }))).toEqual([{ generation: 1, capacity: 'normal', quota: 1 }])

    await database.query(
      `UPDATE client_profiles SET current_capacity = 'high' WHERE id = $1`,
      [profileId],
    )
    await expect(buildAgencyDnaMatchJob({
      ...options,
      dryRun: false,
    }, matchJobDb)).resolves.toMatchObject({ scanned: 0, persisted: 0 })
    await buildPropensity()
    await expect(buildAgencyDnaMatchJob({
      ...options,
      dryRun: false,
    }, matchJobDb)).resolves.toMatchObject({
      scanned: 1,
      built: 1,
      persisted: 1,
      failed: 0,
    })
    const stored = await storedMatches()
    expect(stored.map((row) => ({
      generation: row.generation,
      agencyVersion: row.agencyVersion,
      capacity: row.capacity,
      quota: row.quota,
      minimumPropensity: row.minimumPropensity,
    }))).toEqual([
      {
        generation: 1,
        agencyVersion: 1,
        capacity: 'normal',
        quota: 1,
        minimumPropensity: 'medium',
      },
      {
        generation: 2,
        agencyVersion: 2,
        capacity: 'high',
        quota: 1.5,
        minimumPropensity: 'medium',
      },
    ])
  })

  it('rejects cross-tenant, altered source facts, and non-propensity evidence', async () => {
    const valid = await currentDraft()
    await expect(persistAgencyDnaMatch({
      ...valid,
      clientProfileId: otherProfileId,
      inputHash: '4'.repeat(64),
    }, matchDb)).rejects.toMatchObject({ code: expect.stringMatching(/23503|23514/) })

    await expect(persistAgencyDnaMatch({
      ...valid,
      agencyDnaSourceSnapshot: { altered: true },
      inputHash: '5'.repeat(64),
    }, matchDb)).rejects.toMatchObject({ code: '23514' })

    await expect(persistAgencyDnaMatch({
      ...valid,
      featureSnapshot: {
        ...valid.featureSnapshot,
        propensity: {
          ...valid.featureSnapshot.propensity,
          episodeStage: 'cooling',
        },
      },
      inputHash: '0'.repeat(64),
    }, matchDb)).rejects.toMatchObject({ code: '23514' })

    await expect(persistAgencyDnaMatch({
      ...valid,
      featureSnapshot: {
        ...valid.featureSnapshot,
        company: {
          ...valid.featureSnapshot.company,
          roleFamilies: ['tampered-role'],
        },
      },
      inputHash: 'a'.repeat(64),
    }, matchDb)).rejects.toMatchObject({ code: '23514' })

    await expect(persistAgencyDnaMatch({
      ...valid,
      featureSnapshot: {
        ...valid.featureSnapshot,
        agency: {
          ...valid.featureSnapshot.agency,
          roles: ['tampered-agency-role'],
        },
      },
      inputHash: 'b'.repeat(64),
    }, matchDb)).rejects.toMatchObject({ code: '23514' })

    await expect(persistAgencyDnaMatch({
      ...valid,
      evidenceIds: [...valid.evidenceIds, unlinkedEvidenceId],
      inputHash: '6'.repeat(64),
    }, matchDb)).rejects.toMatchObject({ code: '23514' })
  })

  it('fails closed for incomplete mode, dimension, and reason JSON', async () => {
    for (const [projection, inputHash] of [
      ["modes - 'grow'", '7'.repeat(64)],
      ["dimensions - 'role_family'", '8'.repeat(64)],
      ["reasons #- '{0,basis}'", '9'.repeat(64)],
    ]) {
      await expect(database.query(
        `INSERT INTO agency_dna_match_snapshots (
           organization_id, workspace_id, owner_id, client_profile_id,
           propensity_snapshot_id, propensity_generation, agency_dna_version,
           agency_dna_snapshot_hash, agency_dna_snapshot, match_identity,
           match_generation, fit_score, coverage, level, dimensions, reasons,
           unknown_dimensions, selection_policy, modes, feature_snapshot,
           evidence_hash, input_hash, feature_version
         )
         SELECT organization_id, workspace_id, owner_id, client_profile_id,
           propensity_snapshot_id, propensity_generation, agency_dna_version,
           agency_dna_snapshot_hash, agency_dna_snapshot, match_identity,
           match_generation + 10, fit_score, coverage, level,
           ${projection.startsWith('dimensions') ? projection : 'dimensions'},
           ${projection.startsWith('reasons') ? projection : 'reasons'},
           unknown_dimensions, selection_policy,
           ${projection.startsWith('modes') ? projection : 'modes'},
           feature_snapshot, evidence_hash, $2, feature_version
         FROM agency_dna_match_snapshots WHERE id = $1`,
        [persistedMatchId, inputHash],
      )).rejects.toMatchObject({ code: '23514' })
    }
  })

  it('keeps records append-only and refuses a lossy rollback', async () => {
    await expect(database.query(
      `UPDATE agency_dna_match_snapshots SET fit_score = 0 WHERE id = $1`,
      [persistedMatchId],
    )).rejects.toMatchObject({ code: '55000' })
    const rollback = readFileSync(resolve(
      process.cwd(),
      '..',
      '..',
      'packages',
      'db',
      'migrations',
      '20260804140000_add_agency_dna_match_v2.down.sql',
    ), 'utf8')
    await expect(database.query(rollback)).rejects.toMatchObject({ code: 'P0001' })
    await database.query('ROLLBACK')
  })

  async function buildPropensity(): Promise<void> {
    await expect(buildExternalAgencyPropensityJob({
      env: { EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED: 'true' },
      workspaceId,
      organizationId,
      now,
      dryRun: false,
    }, propensityJobDb)).resolves.toMatchObject({ persisted: 1, failed: 0 })
  }

  async function currentDraft(): Promise<AgencyDnaMatchDraft> {
    const row = await currentInput()
    return buildAgencyDnaMatch(row)
  }

  async function currentInput(): Promise<AgencyDnaMatchInput> {
    const result = await database.query<Record<string, unknown>>(
      `SELECT
         propensity.organization_id::TEXT AS "organizationId",
         propensity.workspace_id::TEXT AS "workspaceId",
         propensity.owner_id::TEXT AS "ownerId",
         propensity.client_profile_id::TEXT AS "clientProfileId",
         propensity.id::TEXT AS "propensitySnapshotId",
         propensity.propensity_generation AS "propensityGeneration",
         propensity.propensity_identity AS "propensityIdentity",
         propensity.input_hash AS "propensityInputHash",
         propensity.evidence_hash AS "propensityEvidenceHash",
         propensity.feature_version AS "propensityFeatureVersion",
         propensity.score AS "propensityScore",
         propensity.level AS "propensityLevel",
         propensity.feature_snapshot->>'episodeStage' AS "episodeStage",
         propensity.feature_snapshot->>'evidenceSourceFamilyCount'
           AS "evidenceSourceFamilyCount",
         propensity.feature_snapshot->'roleFamilies' AS "roleFamilies",
         propensity.feature_snapshot->'seniorityDistribution'
           AS "seniorityDistribution",
         episode.regions AS "episodeRegions",
         org.industry AS "organizationIndustry",
         org.city AS "organizationCity",
         org.country AS "organizationCountry",
         profile.agency_dna_version AS "agencyDnaVersion",
         profile.agency_dna_snapshot_hash AS "agencyDnaSnapshotHash",
         agency_dna_full_snapshot(profile) AS "agencyDnaSourceSnapshot",
         profile.specialization, profile.roles,
         profile.technology_qualification_tags AS "technologyQualificationTags",
         profile.industries, profile.target_city AS "targetCity",
         profile.preferred_regions AS "preferredRegions",
         profile.excluded_industries AS "excludedIndustries",
         profile.excluded_locations AS "excludedLocations",
         profile.remote_friendly AS "remoteFriendly",
         profile.service_types AS "serviceTypes",
         profile.target_seniorities AS "targetSeniorities",
         profile.minimum_fee_minor AS "minimumFeeMinor",
         profile.average_fee_minor AS "averageFeeMinor",
         profile.minimum_opportunity_value_minor AS "minimumOpportunityValueMinor",
         profile.preferred_engagement_types AS "preferredEngagementTypes",
         profile.company_sizes AS "companySizes", profile.hiring_mode AS "hiringMode",
         profile.undesirable_hiring_types AS "undesirableHiringTypes",
         profile.current_capacity AS "currentCapacity",
         profile.case_studies AS "caseStudies",
         restriction.restriction_type AS "accountRestriction",
         ARRAY(SELECT evidence_id::TEXT
           FROM external_agency_propensity_evidence
           WHERE propensity_snapshot_id = propensity.id ORDER BY evidence_id)
           AS "evidenceIds"
       FROM external_agency_propensity_snapshots propensity
       JOIN commercial_theses thesis ON thesis.id = propensity.commercial_thesis_id
       JOIN signal_episodes episode ON episode.id = thesis.signal_episode_id
       JOIN client_profiles profile ON profile.id = propensity.client_profile_id
       JOIN orgs org ON org.id = propensity.organization_id
       LEFT JOIN agency_account_restrictions restriction
         ON restriction.workspace_id = profile.workspace_id
        AND restriction.client_profile_id = profile.id
        AND restriction.organization_id = propensity.organization_id
       WHERE propensity.workspace_id = $1 AND propensity.client_profile_id = $2
         AND propensity.agency_dna_version = profile.agency_dna_version
       ORDER BY propensity.propensity_generation DESC LIMIT 1`,
      [workspaceId, profileId],
    )
    const row = result.rows[0]
    return {
      organizationId: String(row.organizationId),
      workspaceId: String(row.workspaceId),
      ownerId: String(row.ownerId),
      clientProfileId: String(row.clientProfileId),
      propensitySnapshotId: String(row.propensitySnapshotId),
      propensityGeneration: Number(row.propensityGeneration),
      propensityIdentity: String(row.propensityIdentity),
      propensityInputHash: String(row.propensityInputHash),
      propensityEvidenceHash: String(row.propensityEvidenceHash),
      propensityFeatureVersion: String(row.propensityFeatureVersion),
      propensityScore: Number(row.propensityScore),
      propensityLevel: String(row.propensityLevel) as AgencyDnaMatchInput['propensityLevel'],
      episodeStage: String(row.episodeStage) as AgencyDnaMatchInput['episodeStage'],
      evidenceSourceFamilyCount: Number(row.evidenceSourceFamilyCount),
      evidenceIds: stringArray(row.evidenceIds),
      roleFamilies: stringArray(row.roleFamilies),
      seniorityDistribution: numberRecord(row.seniorityDistribution),
      episodeRegions: stringArray(row.episodeRegions),
      organizationIndustry: nullableText(row.organizationIndustry),
      organizationCity: nullableText(row.organizationCity),
      organizationCountry: nullableText(row.organizationCountry),
      evidencedTechnologyQualificationTags: [],
      evidencedServiceTypes: [],
      evidencedEngagementTypes: [],
      remoteStatus: null,
      companySizeBucket: null,
      estimatedFeeMinor: null,
      estimatedOpportunityValueMinor: null,
      agencyDnaVersion: Number(row.agencyDnaVersion),
      agencyDnaSnapshotHash: String(row.agencyDnaSnapshotHash),
      agencyDnaSourceSnapshot: row.agencyDnaSourceSnapshot as Record<string, unknown>,
      specialization: nullableText(row.specialization),
      roles: stringArray(row.roles),
      technologyQualificationTags: stringArray(row.technologyQualificationTags),
      industries: stringArray(row.industries),
      targetCity: nullableText(row.targetCity),
      preferredRegions: stringArray(row.preferredRegions),
      excludedIndustries: stringArray(row.excludedIndustries),
      excludedLocations: stringArray(row.excludedLocations),
      remoteFriendly: row.remoteFriendly === true,
      serviceTypes: stringArray(row.serviceTypes) as AgencyDnaMatchInput['serviceTypes'],
      targetSeniorities: stringArray(row.targetSeniorities),
      minimumFeeMinor: nullableNumber(row.minimumFeeMinor),
      averageFeeMinor: nullableNumber(row.averageFeeMinor),
      minimumOpportunityValueMinor: nullableNumber(row.minimumOpportunityValueMinor),
      preferredEngagementTypes: stringArray(row.preferredEngagementTypes),
      companySizes: stringArray(row.companySizes),
      hiringMode: String(row.hiringMode) as AgencyDnaMatchInput['hiringMode'],
      undesirableHiringTypes: stringArray(
        row.undesirableHiringTypes,
      ) as AgencyDnaMatchInput['undesirableHiringTypes'],
      currentCapacity: String(row.currentCapacity) as AgencyDnaMatchInput['currentCapacity'],
      caseStudies: Array.isArray(row.caseStudies) ? row.caseStudies : [],
      accountRestriction: row.accountRestriction == null
        ? null
        : String(row.accountRestriction) as AgencyDnaMatchInput['accountRestriction'],
    }
  }

  async function storedMatches(): Promise<Array<{
    id: string
    generation: number
    agencyVersion: number
    capacity: string
    quota: number
    minimumPropensity: string
  }>> {
    const result = await database.query<{
      id: string
      generation: number
      agencyVersion: number
      capacity: string
      quota: string
      minimumPropensity: string
    }>(
      `SELECT id::TEXT AS id, match_generation AS generation,
         agency_dna_version::INTEGER AS "agencyVersion",
         selection_policy->>'capacity' AS capacity,
         selection_policy->>'quotaMultiplier' AS quota,
         selection_policy->>'minimumPropensityLevel' AS "minimumPropensity"
       FROM agency_dna_match_snapshots
       WHERE workspace_id = $1 AND client_profile_id = $2
       ORDER BY match_generation`,
      [workspaceId, profileId],
    )
    return result.rows.map((row) => ({ ...row, quota: Number(row.quota) }))
  }

  async function seedCommercialThesis(): Promise<string> {
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
      [organizationId, `agency-match-${token}`, evidenceIds, 'a'.repeat(64)],
    )
    const eventId = event.rows[0].id
    await database.query(
      `INSERT INTO company_event_evidence (company_event_id, organization_id, evidence_id)
       SELECT $1, $2, evidence_id FROM UNNEST($3::BIGINT[]) AS evidence_id`,
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
         '2026-08-04T10:00:00Z', '{"vacancies14d":1,"sufficientHistory":true}',
         '{"vacancies14d":4,"baselineDeviation14d":3,"direction":"up"}',
         '{"current":{"it-engineering":4},"baseline":{"it-engineering":1}}',
         '{"current":{"senior":3},"baseline":{"senior":1}}',
         '{"current":{"Moscow":4},"baseline":{"Moscow":1},"newRegions":[]}',
         '{"observedCount":4,"medianDays":2}',
         '{"supported":false,"observedCount":4,"repostCount":0,"rate":null}',
         '{"currentRecruiterVacancies":0,"baselineRecruiterVacancies":0}',
         '{"current30d":{}}', 'accelerating', 0.9, 'company-state-v1',
         $2, $3
       ) RETURNING id::TEXT AS id`,
      [organizationId, 'b'.repeat(64), 'c'.repeat(64)],
    )
    const snapshotId = snapshot.rows[0].id
    await database.query(
      `INSERT INTO company_state_snapshot_events
         (snapshot_id, organization_id, company_event_id) VALUES ($1, $2, $3)`,
      [snapshotId, organizationId, eventId],
    )
    await database.query(
      `INSERT INTO company_state_snapshot_evidence
         (snapshot_id, organization_id, evidence_id)
       SELECT $1, $2, evidence_id FROM UNNEST($3::BIGINT[]) AS evidence_id`,
      [snapshotId, organizationId, evidenceIds],
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
      [snapshotId, organizationId, 'd'.repeat(64), 'e'.repeat(64)],
    )
    const changeId = change.rows[0].id
    await database.query(
      `INSERT INTO company_state_change_events
         (change_id, organization_id, company_event_id) VALUES ($1, $2, $3)`,
      [changeId, organizationId, eventId],
    )
    await database.query(
      `INSERT INTO company_state_change_evidence
         (change_id, organization_id, evidence_id)
       SELECT $1, $2, evidence_id FROM UNNEST($3::BIGINT[]) AS evidence_id`,
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
         ARRAY['it-engineering'], ARRAY['Moscow'], '{"senior":3}',
         ARRAY['delivery_capacity_pressure'], $3, $4, 'signal-episode-v2'
       ) RETURNING id::TEXT AS id`,
      [organizationId, 'f'.repeat(64), '1'.repeat(64), '2'.repeat(64)],
    )
    const episodeId = episode.rows[0].id
    await database.query(
      `INSERT INTO signal_episode_state_changes
         (signal_episode_id, organization_id, company_state_change_id)
       VALUES ($1, $2, $3)`,
      [episodeId, organizationId, changeId],
    )
    await database.query(
      `INSERT INTO signal_episode_events
         (signal_episode_id, organization_id, company_event_id)
       VALUES ($1, $2, $3)`,
      [episodeId, organizationId, eventId],
    )
    await database.query(
      `INSERT INTO signal_episode_evidence
         (signal_episode_id, organization_id, evidence_id)
       SELECT $1, $2, evidence_id FROM UNNEST($3::BIGINT[]) AS evidence_id`,
      [episodeId, organizationId, evidenceIds],
    )
    const section = JSON.stringify([{
      classification: 'confirmed_fact',
      code: 'vacancy_acceleration_observed',
      text: 'Hiring activity accelerated relative to baseline.',
      evidenceRefs: evidenceIds,
    }])
    const client = await database.connect()
    try {
      await client.query('BEGIN')
      const thesis = await client.query<{ id: string }>(
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
          '3'.repeat(64),
          section,
          '1'.repeat(64),
          '4'.repeat(64),
        ],
      )
      const thesisId = thesis.rows[0].id
      await client.query(
        `INSERT INTO commercial_thesis_evidence
           (commercial_thesis_id, organization_id, evidence_id)
         SELECT $1, $2, evidence_id FROM UNNEST($3::BIGINT[]) AS evidence_id`,
        [thesisId, organizationId, evidenceIds],
      )
      await client.query('COMMIT')
      return thesisId
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
})

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function numberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).map(([key, count]) => [key, Number(count)]),
  )
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : Number(value)
}
