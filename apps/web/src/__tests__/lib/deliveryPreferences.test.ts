import {
  isValidDigestEmail,
  getDeliveryPreferencesByOwnerId,
  saveDeliveryPreferencesByOwnerId,
} from '@/lib/deliveryPreferences'
import { getPool } from '@/lib/db-pool'

jest.mock('@/lib/db-pool', () => ({ getPool: jest.fn() }))

const mockGetPool = jest.mocked(getPool)

function makeMockPool(result?: { rows: unknown[]; rowCount: number }) {
  const query = jest.fn()
  if (result) query.mockResolvedValueOnce(result as never)
  return { pool: { query } as unknown as import('pg').Pool, query }
}

describe('isValidDigestEmail', () => {
  it.each(['a@b.co', 'agency@example.com', 'x.y+z@sub.domain.ru'])('accepts %s', (v) => {
    expect(isValidDigestEmail(v)).toBe(true)
  })

  it.each(['', 'no-at', 'a@b', 'a b@c.com', 'a@@b.com'])('rejects %s', (v) => {
    expect(isValidDigestEmail(v)).toBe(false)
  })
})

describe('getDeliveryPreferencesByOwnerId', () => {
  beforeEach(() => mockGetPool.mockReset())

  it('returns null when no pool', async () => {
    mockGetPool.mockReturnValue(null)
    expect(await getDeliveryPreferencesByOwnerId('1')).toBeNull()
  })

  it('maps the row and scopes the query to owner_id', async () => {
    const { pool, query } = makeMockPool({
      rows: [{ web_push_enabled: true, email_digest_enabled: false, digest_email: 'a@b.co' }],
      rowCount: 1,
    })
    mockGetPool.mockReturnValue(pool)

    const prefs = await getDeliveryPreferencesByOwnerId('42')

    expect(prefs).toEqual({ webPushEnabled: true, emailDigestEnabled: false, digestEmail: 'a@b.co' })
    expect(String(query.mock.calls[0][0])).toContain('WHERE owner_id = $1')
    expect((query.mock.calls[0][1] as unknown[])[0]).toBe('42')
  })

  it('returns null when the owner has no profile', async () => {
    const { pool } = makeMockPool({ rows: [], rowCount: 0 })
    mockGetPool.mockReturnValue(pool)
    expect(await getDeliveryPreferencesByOwnerId('1')).toBeNull()
  })
})

describe('saveDeliveryPreferencesByOwnerId', () => {
  beforeEach(() => mockGetPool.mockReset())

  it('rejects a malformed email without touching the DB', async () => {
    const { pool, query } = makeMockPool()
    mockGetPool.mockReturnValue(pool)

    const res = await saveDeliveryPreferencesByOwnerId({
      ownerId: '1',
      webPushEnabled: true,
      emailDigestEnabled: false,
      digestEmail: 'not-an-email',
    })

    expect(res).toEqual({ ok: false, reason: 'invalid_email' })
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects enabling email without an address', async () => {
    const { pool, query } = makeMockPool()
    mockGetPool.mockReturnValue(pool)

    const res = await saveDeliveryPreferencesByOwnerId({
      ownerId: '1',
      webPushEnabled: false,
      emailDigestEnabled: true,
      digestEmail: '   ',
    })

    expect(res).toEqual({ ok: false, reason: 'email_required' })
    expect(query).not.toHaveBeenCalled()
  })

  it('persists valid preferences scoped to owner_id and returns the saved row', async () => {
    const { pool, query } = makeMockPool({
      rows: [{ web_push_enabled: false, email_digest_enabled: true, digest_email: 'a@b.co' }],
      rowCount: 1,
    })
    mockGetPool.mockReturnValue(pool)

    const res = await saveDeliveryPreferencesByOwnerId({
      ownerId: '7',
      webPushEnabled: false,
      emailDigestEnabled: true,
      digestEmail: '  a@b.co  ',
    })

    expect(res).toEqual({
      ok: true,
      preferences: { webPushEnabled: false, emailDigestEnabled: true, digestEmail: 'a@b.co' },
    })
    const sql = String(query.mock.calls[0][0])
    expect(sql).toContain('UPDATE client_profiles')
    expect(sql).toContain('WHERE owner_id = $1')
    const params = query.mock.calls[0][1] as unknown[]
    expect(params[0]).toBe('7')
    expect(params[3]).toBe('a@b.co') // trimmed
  })

  it('clears the address when email is empty and digest is off', async () => {
    const { pool, query } = makeMockPool({
      rows: [{ web_push_enabled: true, email_digest_enabled: false, digest_email: null }],
      rowCount: 1,
    })
    mockGetPool.mockReturnValue(pool)

    const res = await saveDeliveryPreferencesByOwnerId({
      ownerId: '1',
      webPushEnabled: true,
      emailDigestEnabled: false,
      digestEmail: '',
    })

    expect(res.ok).toBe(true)
    expect((query.mock.calls[0][1] as unknown[])[3]).toBeNull()
  })

  it('returns not_found when the owner has no profile to update', async () => {
    const { pool } = makeMockPool({ rows: [], rowCount: 0 })
    mockGetPool.mockReturnValue(pool)

    const res = await saveDeliveryPreferencesByOwnerId({
      ownerId: '999',
      webPushEnabled: false,
      emailDigestEnabled: false,
      digestEmail: null,
    })

    expect(res).toEqual({ ok: false, reason: 'not_found' })
  })
})
