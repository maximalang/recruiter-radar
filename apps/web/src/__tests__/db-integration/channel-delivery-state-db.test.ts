jest.mock('web-push', () => ({
  __esModule: true,
  default: {
    sendNotification: jest.fn(),
    setVapidDetails: jest.fn(),
  },
}))

import { Pool } from 'pg'
import webpush from 'web-push'

import { getPool } from '@/lib/db-pool'
import { notifyNewLeadsForRun } from '@/lib/webPush'

const mockSendNotification = jest.mocked(webpush.sendNotification)

const databaseUrl = process.env.DATABASE_URL?.trim()
const isolated = process.env.DAILY_RADAR_DB_TEST_ACK === 'isolated'
const describeIfDatabase = databaseUrl && isolated ? describe : describe.skip

describeIfDatabase('aggregate channel delivery state on real PostgreSQL', () => {
  const client = new Pool({ connectionString: databaseUrl })
  let profileId = ''
  let digestRunId = ''

  beforeAll(async () => {
    process.env.WEB_PUSH_PUBLIC_KEY = 'test-public'
    process.env.WEB_PUSH_PRIVATE_KEY = 'test-private'
    process.env.WEB_PUSH_SUBJECT = 'mailto:test@example.invalid'
    const suffix = `${process.pid}-${Date.now()}`
    const user = await client.query<{ id: string }>(
      `INSERT INTO users (email, full_name)
       VALUES ($1, 'Channel Delivery DB')
       RETURNING id::TEXT AS id`,
      [`channel-delivery-${suffix}@example.invalid`],
    )
    const workspace = await client.query<{ id: string }>(
      `INSERT INTO workspaces (name, slug, bootstrap_user_id)
       VALUES ('Channel Delivery DB', $1, $2::BIGINT)
       RETURNING id::TEXT AS id`,
      [`channel-delivery-${suffix}`, user.rows[0].id],
    )
    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status)
       VALUES ($1::BIGINT, $2::BIGINT, 'owner', 'active')`,
      [workspace.rows[0].id, user.rows[0].id],
    )
    await client.query('ALTER TABLE client_profiles DISABLE TRIGGER USER')
    try {
      const profile = await client.query<{ id: string }>(
        `INSERT INTO client_profiles (agency_name, owner_id, workspace_id, web_push_enabled)
         VALUES ('Channel Delivery DB', $1::BIGINT, $2::BIGINT, TRUE)
         RETURNING id::TEXT AS id`,
        [user.rows[0].id, workspace.rows[0].id],
      )
      profileId = profile.rows[0].id
    } finally {
      await client.query('ALTER TABLE client_profiles ENABLE TRIGGER USER')
    }
    const digest = await client.query<{ id: string }>(
      `INSERT INTO digest_runs (client_profile_id, requested_limit)
       VALUES ($1::BIGINT, 5)
       RETURNING id::TEXT AS id`,
      [profileId],
    )
    digestRunId = digest.rows[0].id
    await client.query(
      `INSERT INTO web_push_subscriptions (client_profile_id, endpoint, p256dh, auth)
       VALUES ($1::BIGINT, $2, 'p256dh', 'auth')`,
      [profileId, `https://push.example/${suffix}`],
    )
  })

  afterAll(async () => {
    delete process.env.WEB_PUSH_PUBLIC_KEY
    delete process.env.WEB_PUSH_PRIVATE_KEY
    delete process.env.WEB_PUSH_SUBJECT
    const pool = getPool()
    await pool?.end()
    delete (globalThis as typeof globalThis & { recruiterRadarSharedPool?: unknown }).recruiterRadarSharedPool
    await client.end()
  })

  beforeEach(async () => {
    mockSendNotification.mockReset()
    await client.query('DELETE FROM lead_channel_deliveries WHERE client_profile_id = $1::BIGINT', [profileId])
  })

  it('obeys DB retry eligibility and admits only one concurrent reclaim', async () => {
    mockSendNotification
      .mockRejectedValueOnce(Object.assign(new Error('temporary failure'), { statusCode: 429 }))
      .mockResolvedValue(undefined as never)

    const first = await notifyNewLeadsForRun({ clientProfileId: profileId, digestRunId, count: 2 })
    expect(first).toMatchObject({ delivered: false, state: 'failed_retryable', attempt: 1 })

    const tooEarly = await notifyNewLeadsForRun({ clientProfileId: profileId, digestRunId, count: 2 })
    expect(tooEarly).toMatchObject({ delivered: false, state: 'failed_retryable', attempt: 1 })
    expect(mockSendNotification).toHaveBeenCalledTimes(1)

    await client.query(
      `UPDATE lead_channel_deliveries SET next_retry_at = NOW() - INTERVAL '1 second'
       WHERE channel = 'web_push' AND client_profile_id = $1::BIGINT`,
      [profileId],
    )
    const concurrent = await Promise.all([
      notifyNewLeadsForRun({ clientProfileId: profileId, digestRunId, count: 2 }),
      notifyNewLeadsForRun({ clientProfileId: profileId, digestRunId, count: 2 }),
    ])
    expect(concurrent.filter((result) => result.delivered)).toHaveLength(1)
    expect(mockSendNotification).toHaveBeenCalledTimes(2)

    const afterSuccess = await notifyNewLeadsForRun({ clientProfileId: profileId, digestRunId, count: 2 })
    expect(afterSuccess).toMatchObject({ delivered: false, state: 'already_successfully_delivered', attempt: 2 })
    expect(mockSendNotification).toHaveBeenCalledTimes(2)
  })

  it('fences stale processing as terminal and keeps it non-replayable', async () => {
    await client.query(
      `INSERT INTO lead_channel_deliveries (
         channel, client_profile_id, digest_run_id, dedupe_key, lead_count,
         delivery_status, delivered_at, attempted_at, attempt_count
       ) VALUES ('web_push', $1::BIGINT, $2::BIGINT, $3, 2,
                 'processing', NULL, NOW() - INTERVAL '3 hours', 1)`,
      [profileId, digestRunId, `run:${digestRunId}`],
    )

    const result = await notifyNewLeadsForRun({ clientProfileId: profileId, digestRunId, count: 2 })
    expect(result).toMatchObject({ delivered: false, state: 'failed_terminal', attempt: 1 })
    expect(mockSendNotification).not.toHaveBeenCalled()
    const persisted = await client.query<{ deliveryStatus: string; reason: string }>(
      `SELECT delivery_status AS "deliveryStatus", last_error_reason AS reason
       FROM lead_channel_deliveries
       WHERE channel = 'web_push' AND client_profile_id = $1::BIGINT`,
      [profileId],
    )
    expect(persisted.rows[0]).toEqual({
      deliveryStatus: 'failed_terminal',
      reason: 'ambiguous_stale_processing',
    })
  })

  it('terminalizes the channel attempt limit without another provider call', async () => {
    await client.query(
      `INSERT INTO lead_channel_deliveries (
         channel, client_profile_id, digest_run_id, dedupe_key, lead_count,
         delivery_status, delivered_at, attempted_at, attempt_count, next_retry_at
       ) VALUES ('web_push', $1::BIGINT, $2::BIGINT, $3, 2,
                 'failed_retryable', NULL, NOW(), 5, NOW() - INTERVAL '1 second')`,
      [profileId, digestRunId, `run:${digestRunId}`],
    )

    const result = await notifyNewLeadsForRun({ clientProfileId: profileId, digestRunId, count: 2 })
    expect(result).toMatchObject({ delivered: false, state: 'failed_terminal', attempt: 5 })
    expect(mockSendNotification).not.toHaveBeenCalled()
    const persisted = await client.query<{ deliveryStatus: string; reason: string }>(
      `SELECT delivery_status AS "deliveryStatus", last_error_reason AS reason
       FROM lead_channel_deliveries
       WHERE channel = 'web_push' AND client_profile_id = $1::BIGINT`,
      [profileId],
    )
    expect(persisted.rows[0]).toEqual({
      deliveryStatus: 'failed_terminal',
      reason: 'channel_attempt_limit_reached',
    })
  })
})
