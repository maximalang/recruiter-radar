import { sendDigestEmailForProfile } from '@/lib/email/sendDigestEmail'
import { getPool } from '@/lib/db-pool'
import { getLeadsForAllProfiles, type LeadItem } from '@/lib/leads-data'
import { isEmailConfigured, sendEmail } from '@/lib/email/transport'

jest.mock('@/lib/db-pool', () => ({ getPool: jest.fn() }))
jest.mock('@/lib/leads-data', () => ({ getLeadsForAllProfiles: jest.fn() }))
jest.mock('@/lib/email/transport', () => ({
  isEmailConfigured: jest.fn(),
  sendEmail: jest.fn(),
}))

const mockGetPool = jest.mocked(getPool)
const mockGetLeads = jest.mocked(getLeadsForAllProfiles)
const mockIsConfigured = jest.mocked(isEmailConfigured)
const mockSendEmail = jest.mocked(sendEmail)

function makeLead(overrides: Partial<LeadItem> = {}): LeadItem {
  return {
    id: 'lead-1',
    orgId: 'org-1',
    orgName: 'Ромашка',
    sourceExternalId: null,
    score: 3.2,
    confidenceGate: 'A',
    vacanciesCount: 1,
    distinctVacancyNamesCount: 1,
    latestPublishedAt: null,
    reasons: [],
    whyNow: 'Сигнал найма',
    bestAngle: '',
    lawfulContactPath: null,
    negativeSignals: [],
    opener: '',
    feedbackStatus: null,
    suppressedUntil: null,
    createdAt: '2026-06-27T00:00:00.000Z',
    sourceFamilies: ['career-pages'],
    evidenceTitles: ['Backend'],
    locationNames: ['Москва'],
    ...overrides,
  }
}

/**
 * Pool whose `query` is driven by a queue of results, in call order.
 * Returns a jest.fn so individual call args can be asserted.
 */
function makeMockPool(results: Array<{ rows: unknown[]; rowCount: number }>) {
  const query = jest.fn()
  for (const r of results) query.mockResolvedValueOnce(r as never)
  return { pool: { query } as unknown as import('pg').Pool, query }
}

const PREFS_ROW = {
  email_digest_enabled: true,
  digest_email: 'agency@example.com',
  agency_name: 'Агентство Альфа',
  owner_id: 'owner-1',
}

describe('sendDigestEmailForProfile', () => {
  beforeEach(() => {
    mockGetPool.mockReset()
    mockGetLeads.mockReset()
    mockIsConfigured.mockReset()
    mockSendEmail.mockReset()
    mockIsConfigured.mockReturnValue(true)
    mockSendEmail.mockResolvedValue({ ok: true })
  })

  it('returns not_configured when SMTP is absent (no DB/leads touched)', async () => {
    mockIsConfigured.mockReturnValue(false)

    const res = await sendDigestEmailForProfile({ clientProfileId: '1', digestRunId: '99' })

    expect(res).toEqual({ delivered: false, reason: 'not_configured' })
    expect(mockGetPool).not.toHaveBeenCalled()
    expect(mockGetLeads).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('returns disabled when the profile opted out', async () => {
    const { pool } = makeMockPool([
      { rows: [{ ...PREFS_ROW, email_digest_enabled: false }], rowCount: 1 },
    ])
    mockGetPool.mockReturnValue(pool)

    const res = await sendDigestEmailForProfile({ clientProfileId: '1', digestRunId: '99' })

    expect(res).toEqual({ delivered: false, reason: 'disabled' })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('returns no_email when enabled but destination is missing', async () => {
    const { pool } = makeMockPool([
      { rows: [{ ...PREFS_ROW, digest_email: null }], rowCount: 1 },
    ])
    mockGetPool.mockReturnValue(pool)

    const res = await sendDigestEmailForProfile({ clientProfileId: '1', digestRunId: '99' })

    expect(res).toEqual({ delivered: false, reason: 'no_email' })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('returns no_leads when there are no A/B candidates', async () => {
    const { pool } = makeMockPool([{ rows: [PREFS_ROW], rowCount: 1 }])
    mockGetPool.mockReturnValue(pool)
    // Only a C-gate lead — filtered out as not auto-deliverable.
    mockGetLeads.mockResolvedValue({ leads: [makeLead({ confidenceGate: 'C' })], total: 1 })

    const res = await sendDigestEmailForProfile({ clientProfileId: '1', digestRunId: '99' })

    expect(res).toEqual({ delivered: false, reason: 'no_leads' })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('claims dedupe BEFORE sending, then sends, on the happy path', async () => {
    const { pool, query } = makeMockPool([
      { rows: [PREFS_ROW], rowCount: 1 }, // prefs
      { rows: [{ id: 1 }], rowCount: 1 }, // dedupe claim wins
    ])
    mockGetPool.mockReturnValue(pool)
    mockGetLeads.mockResolvedValue({ leads: [makeLead(), makeLead({ id: 'l2' })], total: 2 })

    const res = await sendDigestEmailForProfile({
      clientProfileId: '7',
      digestRunId: '42',
      now: new Date('2026-06-27T09:00:00.000Z'),
    })

    expect(res).toEqual({ delivered: true, leadCount: 2 })

    // Claim is the 2nd query; it must run before sendEmail.
    const claimCall = query.mock.calls[1]
    const claimSql = String(claimCall[0])
    expect(claimSql).toContain('lead_channel_deliveries')
    expect(claimSql).toContain('ON CONFLICT')
    const claimParams = claimCall[1] as unknown[]
    expect(claimParams[0]).toBe('7')
    expect(claimParams[1]).toBe('day:2026-06-27') // Moscow day key
    expect(claimParams[2]).toBe(2) // lead_count

    expect(query.mock.invocationCallOrder[1]).toBeLessThan(
      mockSendEmail.mock.invocationCallOrder[0],
    )
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockSendEmail.mock.calls[0][0].to).toBe('agency@example.com')
  })

  it('scopes leads to THIS run, not the profile history', async () => {
    // Regression guard: the email must reflect this run's fresh batch
    // ("companies worth contacting today"), mirroring Telegram/web-push — never
    // every candidate ever scored for the profile.
    const { pool } = makeMockPool([
      { rows: [PREFS_ROW], rowCount: 1 }, // prefs
      { rows: [{ id: 1 }], rowCount: 1 }, // dedupe claim wins
    ])
    mockGetPool.mockReturnValue(pool)
    mockGetLeads.mockResolvedValue({ leads: [makeLead()], total: 1 })

    await sendDigestEmailForProfile({ clientProfileId: '7', digestRunId: '42' })

    expect(mockGetLeads).toHaveBeenCalledTimes(1)
    expect(mockGetLeads).toHaveBeenCalledWith({
      profileIds: ['7'],
      ownerId: 'owner-1',
      digestRunId: '42',
    })
  })

  it('bails (disabled) when the profile has no owner, never reading leads', async () => {
    // Legacy profile without owner attribution: passing ownerId=null would
    // over-broaden the lead scope, so we refuse rather than leak across tenants.
    const { pool } = makeMockPool([
      { rows: [{ ...PREFS_ROW, owner_id: null }], rowCount: 1 },
    ])
    mockGetPool.mockReturnValue(pool)

    const res = await sendDigestEmailForProfile({ clientProfileId: '7', digestRunId: '42' })

    expect(res).toEqual({ delivered: false, reason: 'disabled' })
    expect(mockGetLeads).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('returns already_sent and does NOT send when the dedupe row exists', async () => {
    const { pool } = makeMockPool([
      { rows: [PREFS_ROW], rowCount: 1 }, // prefs
      { rows: [], rowCount: 0 }, // claim loses — ON CONFLICT DO NOTHING
    ])
    mockGetPool.mockReturnValue(pool)
    mockGetLeads.mockResolvedValue({ leads: [makeLead()], total: 1 })

    const res = await sendDigestEmailForProfile({ clientProfileId: '1', digestRunId: '99' })

    expect(res).toEqual({ delivered: false, reason: 'already_sent' })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('returns send_failed when the transport fails after claiming', async () => {
    const { pool } = makeMockPool([
      { rows: [PREFS_ROW], rowCount: 1 },
      { rows: [{ id: 1 }], rowCount: 1 },
    ])
    mockGetPool.mockReturnValue(pool)
    mockGetLeads.mockResolvedValue({ leads: [makeLead()], total: 1 })
    mockSendEmail.mockResolvedValue({ ok: false, reason: 'send_failed' })

    const res = await sendDigestEmailForProfile({ clientProfileId: '1', digestRunId: '99' })

    expect(res).toEqual({ delivered: false, reason: 'send_failed' })
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })
})
