import { randomUUID } from 'node:crypto'

import { Pool } from 'pg'

import {
  normalizeCompanyEventsJob,
} from '@/lib/opportunities/company-event-job'

const databaseUrl = process.env.DATABASE_URL
const isolatedDatabaseAcknowledged =
  process.env.COMPANY_EVENTS_V1_DB_TEST_ACK === 'isolated'
const describeIfDatabase = databaseUrl && isolatedDatabaseAcknowledged
  ? describe
  : describe.skip

describeIfDatabase('Company Events v1 PostgreSQL runtime', () => {
  const database = new Pool({ connectionString: databaseUrl })
  const token = randomUUID()
  let organizationId = ''
  let secondOrganizationId = ''
  let hhSignalId = ''
  let careerSignalId = ''

  beforeAll(async () => {
    const organization = await database.query<{ id: string }>(
      `INSERT INTO orgs (name, domain)
       VALUES ('Company Events runtime', $1)
       RETURNING id::TEXT AS id`,
      [`company-events-runtime-${token}.example.invalid`],
    )
    organizationId = organization.rows[0].id

    const signals = await database.query<{
      id: string
      source: string
      sourceUrl: string
      externalId: string
      payload: Record<string, unknown>
    }>(
      `INSERT INTO signals (
         org_id, signal_type, source, external_id, headline, source_url,
         occurred_at, payload
       )
       VALUES
         ($1, 'job_posting', 'hh', '101', 'Senior Java developer', $2,
          '2026-08-02T09:00:00.000Z', '{"vacancy_name":"Senior Java developer"}'),
         ($1, 'job_posting', 'career-pages', 'career-77',
          'Senior Java developer', $3, '2026-08-02T09:00:00.000Z',
          '{"vacancy_name":"Senior Java developer"}')
       RETURNING id::TEXT AS id, source, source_url AS "sourceUrl",
         external_id AS "externalId", payload`,
      [
        organizationId,
        `https://hh.example.invalid/${token}/101`,
        `https://company.example.invalid/${token}/career/java`,
      ],
    )
    const evidence = await database.query<{ id: string; source: string }>(
      `INSERT INTO evidence_items (
         org_id, source, url, fetched_at, content_hash, tier
       )
       VALUES
         ($1, 'hh', $2, NOW(), $4, 'direct'),
         ($1, 'career-pages', $3, NOW(), $5, 'direct')
       RETURNING id::TEXT AS id, source`,
      [
        organizationId,
        `https://hh.example.invalid/${token}/101`,
        `https://company.example.invalid/${token}/career/java`,
        'a'.repeat(63) + '1',
        'b'.repeat(63) + '2',
      ],
    )
    const evidenceBySource = Object.fromEntries(
      evidence.rows.map((row) => [row.source, row.id]),
    )

    expect(signals.rowCount).toBe(2)
    const hhSignal = signals.rows.find((row) => row.source === 'hh')
    const careerSignal = signals.rows.find(
      (row) => row.source === 'career-pages',
    )
    if (!hhSignal || !careerSignal) {
      throw new Error('Expected both Company Events runtime source records.')
    }
    hhSignalId = hhSignal.id
    careerSignalId = careerSignal.id
    expect(Object.keys(evidenceBySource)).toHaveLength(2)
  })

  afterAll(async () => {
    await database.query('TRUNCATE TABLE company_events CASCADE')
    await database.query(
      'DELETE FROM orgs WHERE id = ANY($1::BIGINT[])',
      [[organizationId, secondOrganizationId].filter(Boolean)],
    )
    await database.end()
  })

  it('stays dark unless the flag is exactly true and replays idempotently', async () => {
    const disabled = await normalizeCompanyEventsJob({
      env: {},
      organizationId,
      dryRun: false,
      now: new Date('2026-08-03T12:00:00.000Z'),
    }, database)
    expect(disabled).toMatchObject({ enabled: false, normalized: 0, persisted: 0 })

    await expect(normalizeCompanyEventsJob({
      env: { COMPANY_EVENTS_V1_ENABLED: 'true' },
      dryRun: false,
    }, database)).rejects.toThrow(
      'Company Events apply requires one explicit organization.',
    )

    const preview = await normalizeCompanyEventsJob({
      env: { COMPANY_EVENTS_V1_ENABLED: 'true' },
      organizationId,
      now: new Date('2026-08-03T12:00:00.000Z'),
    }, database)
    expect(preview).toMatchObject({
      enabled: true,
      dryRun: true,
      normalized: 1,
      persisted: 0,
    })

    const first = await normalizeCompanyEventsJob({
      env: { COMPANY_EVENTS_V1_ENABLED: 'true' },
      organizationId,
      dryRun: false,
      now: new Date('2026-08-03T12:00:00.000Z'),
    }, database)
    const replay = await normalizeCompanyEventsJob({
      env: { COMPANY_EVENTS_V1_ENABLED: 'true' },
      organizationId,
      dryRun: false,
      now: new Date('2026-08-03T12:00:00.000Z'),
    }, database)

    expect(first).toMatchObject({
      normalized: 1,
      persisted: 1,
      publicationsAttached: 2,
      evidenceAttached: 2,
    })
    expect(replay).toMatchObject({
      scanned: 0,
      normalized: 0,
      persisted: 0,
      publicationsAttached: 0,
      evidenceAttached: 0,
    })

    await database.query(
      `UPDATE signals
       SET updated_at = '2026-08-03T13:00:00.000Z',
           payload = payload || '{"salary":"300000"}'::JSONB
       WHERE id = $1`,
      [hhSignalId],
    )
    const changedObservation = await normalizeCompanyEventsJob({
      env: { COMPANY_EVENTS_V1_ENABLED: 'true' },
      organizationId,
      dryRun: false,
      now: new Date('2026-08-03T14:00:00.000Z'),
    }, database)
    expect(changedObservation).toMatchObject({
      normalized: 1,
      persisted: 0,
      publicationsAttached: 1,
      evidenceAttached: 0,
    })

    const counts = await database.query(
      `SELECT
         (SELECT COUNT(*)::INTEGER FROM company_events) AS events,
         (SELECT COUNT(*)::INTEGER FROM company_event_publications) AS publications,
         (SELECT COUNT(*)::INTEGER FROM company_event_evidence) AS evidence`,
    )
    expect(counts.rows[0]).toEqual({ events: 1, publications: 3, evidence: 2 })

    const secondOrganization = await database.query<{ id: string }>(
      `INSERT INTO orgs (name, domain)
       VALUES ('Company Events queue successor', $1)
       RETURNING id::TEXT AS id`,
      [`company-events-queue-${token}.example.invalid`],
    )
    secondOrganizationId = secondOrganization.rows[0].id
    const secondUrl = `https://queue.example.invalid/${token}/vacancy`
    await database.query(
      `INSERT INTO signals (
         org_id, signal_type, source, external_id, headline, source_url,
         occurred_at, payload
       )
       VALUES (
         $1, 'job_posting', 'career-pages', 'queue-1',
         'Queue successor developer', $2,
         '2026-08-03T15:00:00.000Z',
         '{"vacancy_name":"Queue successor developer"}'::JSONB
       )`,
      [secondOrganizationId, secondUrl],
    )
    await database.query(
      `INSERT INTO evidence_items (
         org_id, source, url, fetched_at, content_hash, tier
       )
       VALUES ($1, 'career-pages', $2, NOW(), $3, 'direct')`,
      [secondOrganizationId, secondUrl, 'c'.repeat(63) + '3'],
    )

    const nextOrganization = await normalizeCompanyEventsJob({
      env: { COMPANY_EVENTS_V1_ENABLED: 'true' },
      batchSize: 1,
    }, database)
    expect(nextOrganization).toMatchObject({
      dryRun: true,
      scanned: 1,
      normalized: 1,
      failed: 0,
    })

    const secondFirstApply = await normalizeCompanyEventsJob({
      env: { COMPANY_EVENTS_V1_ENABLED: 'true' },
      organizationId: secondOrganizationId,
      dryRun: false,
    }, database)
    expect(secondFirstApply).toMatchObject({
      persisted: 1,
      publicationsAttached: 1,
      failed: 0,
    })

    const secondCrossSourceUrl =
      `https://hh.example.invalid/${token}/queue-successor`
    await database.query(
      `INSERT INTO signals (
         org_id, signal_type, source, external_id, headline, source_url,
         occurred_at, payload
       )
       VALUES (
         $1, 'job_posting', 'hh', 'queue-hh-1',
         'Queue successor developer', $2,
         '2026-08-03T15:00:00.000Z',
         '{"vacancy_name":"Queue successor developer"}'::JSONB
       )`,
      [secondOrganizationId, secondCrossSourceUrl],
    )
    await database.query(
      `INSERT INTO evidence_items (
         org_id, source, url, fetched_at, content_hash, tier
       )
       VALUES ($1, 'hh', $2, NOW(), $3, 'direct')`,
      [secondOrganizationId, secondCrossSourceUrl, 'd'.repeat(63) + '4'],
    )
    const secondCrossSourceApply = await normalizeCompanyEventsJob({
      env: { COMPANY_EVENTS_V1_ENABLED: 'true' },
      organizationId: secondOrganizationId,
      dryRun: false,
    }, database)
    expect(secondCrossSourceApply).toMatchObject({
      persisted: 0,
      publicationsAttached: 1,
      failed: 0,
    })

    const secondCounts = await database.query(
      `SELECT
         (SELECT COUNT(*)::INTEGER
          FROM company_events WHERE organization_id = $1) AS events,
         (SELECT COUNT(*)::INTEGER
          FROM company_event_publications WHERE organization_id = $1)
           AS publications`,
      [secondOrganizationId],
    )
    expect(secondCounts.rows[0]).toEqual({ events: 1, publications: 2 })

    const statementTimeout = await database.query('SHOW statement_timeout')
    expect(statementTimeout.rows[0].statement_timeout).toBe('0')

    await database.query(
      `UPDATE signals
       SET source = 'hh', external_id = '202',
           updated_at = '2026-08-03T16:00:00.000Z'
       WHERE id = $1`,
      [careerSignalId],
    )
    const splitConflict = await normalizeCompanyEventsJob({
      env: { COMPANY_EVENTS_V1_ENABLED: 'true' },
      organizationId,
      dryRun: false,
    }, database)
    expect(splitConflict).toMatchObject({
      persisted: 0,
      publicationsAttached: 0,
      failed: 1,
    })

    const publicationsAfterConflict = await database.query(
      `SELECT COUNT(*)::INTEGER AS count
       FROM company_event_publications
       WHERE organization_id = $1`,
      [organizationId],
    )
    expect(publicationsAfterConflict.rows[0].count).toBe(3)
  })
})
