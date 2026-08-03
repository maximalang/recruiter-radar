import { randomUUID } from 'node:crypto'

import { Pool } from 'pg'

import {
  buildCompanyStateJob,
} from '@/lib/opportunities/company-state-job'

const databaseUrl = process.env.DATABASE_URL
const isolatedDatabaseAcknowledged =
  process.env.COMPANY_STATE_V1_DB_TEST_ACK === 'isolated'
const describeIfDatabase = databaseUrl && isolatedDatabaseAcknowledged
  ? describe
  : describe.skip

describeIfDatabase('Company State v1 PostgreSQL runtime', () => {
  const database = new Pool({ connectionString: databaseUrl })
  const token = randomUUID()
  const now = new Date('2026-08-04T12:00:00.000Z')
  let organizationId = ''
  let nextEventNumber = 1

  beforeAll(async () => {
    const organization = await database.query<{ id: string }>(
      `INSERT INTO orgs (name, domain)
       VALUES ('Company State runtime', $1)
       RETURNING id::TEXT AS id`,
      [`company-state-runtime-${token}.example.invalid`],
    )
    organizationId = organization.rows[0].id
    for (const ageDays of [16, 30, 44, 58, 72, 86, 1, 3, 5, 7]) {
      await insertEvent(ageDays)
    }
  })

  afterAll(async () => {
    await database.query('TRUNCATE TABLE company_state_snapshots CASCADE')
    await database.query('TRUNCATE TABLE company_events CASCADE')
    await database.query('DELETE FROM orgs WHERE id = $1', [organizationId])
    await database.end()
  })

  it('stays dark, previews, applies, and replays without duplicates', async () => {
    const disabled = await buildCompanyStateJob({
      env: {},
      organizationId,
      dryRun: false,
      now,
    }, database)
    expect(disabled).toMatchObject({ enabled: false, scanned: 0 })

    await expect(buildCompanyStateJob({
      env: { COMPANY_STATE_V1_ENABLED: 'true' },
      dryRun: false,
      now,
    }, database)).rejects.toThrow(
      'Company State apply requires one explicit organization.',
    )

    const preview = await buildCompanyStateJob({
      env: { COMPANY_STATE_V1_ENABLED: 'true' },
      organizationId,
      now,
    }, database)
    expect(preview).toMatchObject({
      dryRun: true,
      scanned: 1,
      built: 1,
      lowHistory: 0,
      changesDetected: 1,
      snapshotsPersisted: 0,
    })

    const first = await buildCompanyStateJob({
      env: { COMPANY_STATE_V1_ENABLED: 'true' },
      organizationId,
      dryRun: false,
      now,
    }, database)
    const replay = await buildCompanyStateJob({
      env: { COMPANY_STATE_V1_ENABLED: 'true' },
      organizationId,
      dryRun: false,
      now,
    }, database)
    expect(first).toMatchObject({
      scanned: 1,
      built: 1,
      snapshotsPersisted: 1,
      changesPersisted: 1,
      failed: 0,
    })
    expect(replay).toMatchObject({
      scanned: 0,
      built: 0,
      snapshotsPersisted: 0,
      changesPersisted: 0,
    })

    const counts = await database.query(
      `SELECT
         (SELECT COUNT(*)::INTEGER FROM company_state_snapshots
          WHERE organization_id = $1) AS snapshots,
         (SELECT COUNT(*)::INTEGER FROM company_state_changes
          WHERE organization_id = $1) AS changes,
         (SELECT COUNT(*)::INTEGER FROM company_state_snapshot_events
          WHERE organization_id = $1) AS events,
         (SELECT COUNT(*)::INTEGER FROM company_state_snapshot_evidence
          WHERE organization_id = $1) AS evidence`,
      [organizationId],
    )
    expect(counts.rows[0]).toEqual({
      snapshots: 1,
      changes: 1,
      events: 10,
      evidence: 10,
    })
  })

  it('creates a new same-day input version when a Company Event arrives', async () => {
    await insertEvent(0.5)
    const refreshed = await buildCompanyStateJob({
      env: { COMPANY_STATE_V1_ENABLED: 'true' },
      organizationId,
      dryRun: false,
      now,
    }, database)
    expect(refreshed).toMatchObject({
      scanned: 1,
      built: 1,
      snapshotsPersisted: 1,
      changesPersisted: 1,
      failed: 0,
    })

    const snapshots = await database.query<{
      count: number
      inputHashes: number
    }>(
      `SELECT COUNT(*)::INTEGER AS count,
              COUNT(DISTINCT input_hash)::INTEGER AS "inputHashes"
       FROM company_state_snapshots
       WHERE organization_id = $1`,
      [organizationId],
    )
    expect(snapshots.rows[0]).toEqual({ count: 2, inputHashes: 2 })
    const statementTimeout = await database.query('SHOW statement_timeout')
    expect(statementTimeout.rows[0].statement_timeout).toBe('0')
  })

  async function insertEvent(ageDays: number): Promise<void> {
    const eventNumber = nextEventNumber
    nextEventNumber += 1
    const occurredAt = new Date(
      now.getTime() - ageDays * 86_400_000,
    ).toISOString()
    const evidence = await database.query<{ id: string }>(
      `INSERT INTO evidence_items (
         org_id, source, url, fetched_at, content_hash, tier
       ) VALUES ($1, 'career-pages', $2, $3, $4, 'direct')
       RETURNING id::TEXT AS id`,
      [
        organizationId,
        `https://company-state-runtime.example.invalid/${token}/${eventNumber}`,
        occurredAt,
        eventNumber.toString(16).padStart(64, '0'),
      ],
    )
    const event = await database.query<{ id: string }>(
      `INSERT INTO company_events (
         organization_id, event_type, occurred_at, first_seen_at, last_seen_at,
         source_family, source_record_id, evidence_ids, event_fingerprint,
         confidence, payload, normalizer_version
       ) VALUES (
         $1, 'job_posting', $2, $2, $2, 'career-pages', $3,
         ARRAY[$4]::BIGINT[], $5, 0.9,
         $6::JSONB, 'company-event-normalizer-v1'
       ) RETURNING id::TEXT AS id`,
      [
        organizationId,
        occurredAt,
        `runtime-event-${eventNumber}`,
        evidence.rows[0].id,
        (eventNumber + 100).toString(16).padStart(64, '0'),
        JSON.stringify({
          title: `Backend engineer ${eventNumber}`,
          region: 'Moscow',
          matchKey: `runtime-${eventNumber}`,
        }),
      ],
    )
    await database.query(
      `INSERT INTO company_event_evidence (
         company_event_id, organization_id, evidence_id
       ) VALUES ($1, $2, $3)`,
      [event.rows[0].id, organizationId, evidence.rows[0].id],
    )
  }
})
