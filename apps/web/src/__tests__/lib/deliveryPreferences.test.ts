import {
  isValidDigestEmail,
  isValidDeliveryTimeLocal,
  normalizeDeliveryFrequency,
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

/** Full prefs row as the DB now returns it (incl. Block 3 fields). */
function fullRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    web_push_enabled: false,
    email_digest_enabled: false,
    digest_email: null,
    delivery_enabled: true,
    delivery_time_local: null,
    delivery_timezone: 'Europe/Moscow',
    delivery_frequency: 'daily',
    ...overrides,
  }
}

/** Full prefs object as the repository maps it. */
function fullPrefs(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    webPushEnabled: false,
    emailDigestEnabled: false,
    digestEmail: null,
    deliveryEnabled: true,
    deliveryTimeLocal: null,
    deliveryTimezone: 'Europe/Moscow',
    deliveryFrequency: 'daily' as const,
    ...overrides,
  }
}

/** A save input with all required Block 3 fields filled. */
function fullSaveInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ownerId: '1',
    webPushEnabled: false,
    emailDigestEnabled: false,
    digestEmail: null,
    deliveryEnabled: true,
    deliveryTimeLocal: null,
    deliveryTimezone: 'Europe/Moscow',
    deliveryFrequency: 'daily' as const,
    ...overrides,
  }
}

describe('isValidDigestEmail', () => {
  it.each(['a@b.co', 'agency@example.com', 'x.y+z@sub.domain.ru'])('accepts %s', (v) => {
    expect(isValidDigestEmail(v)).toBe(true)
  })

  it.each(['', 'no-at', 'a@b', 'a b@c.com', 'a@@b.com'])('rejects %s', (v) => {
    expect(isValidDigestEmail(v)).toBe(false)
  })
})

describe('isValidDeliveryTimeLocal', () => {
  it.each(['00:00', '09:30', '23:59', '18:00'])('accepts %s', (v) => {
    expect(isValidDeliveryTimeLocal(v)).toBe(true)
  })
  it.each(['', '9:30', '24:00', '23:60', 'ab:cd', '18-00'])('rejects %s', (v) => {
    expect(isValidDeliveryTimeLocal(v)).toBe(false)
  })
})

describe('normalizeDeliveryFrequency', () => {
  it.each([
    ['daily', 'daily'],
    ['WEEKLY', 'weekly'],
    ['  weekly  ', 'weekly'],
  ])('maps %s -> %s', (input, expected) => {
    expect(normalizeDeliveryFrequency(input)).toBe(expected)
  })
  it.each(['', 'hourly', 'monthly', null, undefined, 5])('rejects %p', (v) => {
    expect(normalizeDeliveryFrequency(v)).toBeNull()
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
      rows: [fullRow({
        web_push_enabled: true,
        email_digest_enabled: false,
        digest_email: 'a@b.co',
        delivery_time_local: '09:30',
        delivery_frequency: 'weekly',
      })],
      rowCount: 1,
    })
    mockGetPool.mockReturnValue(pool)

    const prefs = await getDeliveryPreferencesByOwnerId('42')

    expect(prefs).toEqual(fullPrefs({
      webPushEnabled: true,
      emailDigestEnabled: false,
      digestEmail: 'a@b.co',
      deliveryTimeLocal: '09:30',
      deliveryFrequency: 'weekly',
    }))
    const sql = String(query.mock.calls[0][0])
    expect(sql).toContain('delivery_enabled')
    expect(sql).toContain('delivery_time_local')
    expect(sql).toContain('delivery_timezone')
    expect(sql).toContain('delivery_frequency')
    expect(sql).toContain('WHERE owner_id = $1')
    expect((query.mock.calls[0][1] as unknown[])[0]).toBe('42')
  })

  it('falls back to daily when the stored frequency is corrupt', async () => {
    const { pool } = makeMockPool({
      rows: [fullRow({ delivery_frequency: 'hourly' })],
      rowCount: 1,
    })
    mockGetPool.mockReturnValue(pool)
    const prefs = await getDeliveryPreferencesByOwnerId('1')
    expect(prefs?.deliveryFrequency).toBe('daily')
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

    const res = await saveDeliveryPreferencesByOwnerId(fullSaveInput({ digestEmail: 'not-an-email' }))

    expect(res).toEqual({ ok: false, reason: 'invalid_email' })
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects enabling email without an address', async () => {
    const { pool, query } = makeMockPool()
    mockGetPool.mockReturnValue(pool)

    const res = await saveDeliveryPreferencesByOwnerId(fullSaveInput({
      emailDigestEnabled: true,
      digestEmail: '   ',
    }))

    expect(res).toEqual({ ok: false, reason: 'email_required' })
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects a malformed delivery time without touching the DB', async () => {
    const { pool, query } = makeMockPool()
    mockGetPool.mockReturnValue(pool)

    const res = await saveDeliveryPreferencesByOwnerId(fullSaveInput({ deliveryTimeLocal: '9:30' }))

    expect(res).toEqual({ ok: false, reason: 'invalid_time' })
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects a blank timezone without touching the DB', async () => {
    const { pool, query } = makeMockPool()
    mockGetPool.mockReturnValue(pool)

    const res = await saveDeliveryPreferencesByOwnerId(fullSaveInput({ deliveryTimezone: '   ' }))

    expect(res).toEqual({ ok: false, reason: 'invalid_timezone' })
    expect(query).not.toHaveBeenCalled()
  })

  it('persists valid preferences scoped to owner_id and returns the saved row', async () => {
    const { pool, query } = makeMockPool({
      rows: [fullRow({
        web_push_enabled: false,
        email_digest_enabled: true,
        digest_email: 'a@b.co',
        delivery_enabled: true,
        delivery_time_local: '09:30',
        delivery_timezone: 'Asia/Yekaterinburg',
        delivery_frequency: 'weekly',
      })],
      rowCount: 1,
    })
    mockGetPool.mockReturnValue(pool)

    const res = await saveDeliveryPreferencesByOwnerId(fullSaveInput({
      ownerId: '7',
      emailDigestEnabled: true,
      digestEmail: '  a@b.co  ',
      deliveryTimeLocal: '09:30',
      deliveryTimezone: 'Asia/Yekaterinburg',
      deliveryFrequency: 'weekly',
    }))

    expect(res).toEqual({
      ok: true,
      preferences: fullPrefs({
        webPushEnabled: false,
        emailDigestEnabled: true,
        digestEmail: 'a@b.co',
        deliveryTimeLocal: '09:30',
        deliveryTimezone: 'Asia/Yekaterinburg',
        deliveryFrequency: 'weekly',
      }),
    })
    const sql = String(query.mock.calls[0][0])
    expect(sql).toContain('UPDATE client_profiles')
    expect(sql).toContain('delivery_enabled = $5')
    expect(sql).toContain('WHERE owner_id = $1')
    const params = query.mock.calls[0][1] as unknown[]
    expect(params[0]).toBe('7')
    expect(params[3]).toBe('a@b.co') // trimmed
    expect(params[4]).toBe(true) // deliveryEnabled
    expect(params[5]).toBe('09:30') // deliveryTimeLocal
    expect(params[6]).toBe('Asia/Yekaterinburg')
    expect(params[7]).toBe('weekly')
  })

  it('clears the address when email is empty and digest is off', async () => {
    const { pool, query } = makeMockPool({
      rows: [fullRow({ web_push_enabled: true, email_digest_enabled: false, digest_email: null })],
      rowCount: 1,
    })
    mockGetPool.mockReturnValue(pool)

    const res = await saveDeliveryPreferencesByOwnerId(fullSaveInput({
      webPushEnabled: true,
      emailDigestEnabled: false,
      digestEmail: '',
    }))

    expect(res.ok).toBe(true)
    expect((query.mock.calls[0][1] as unknown[])[3]).toBeNull()
  })

  it('clears delivery_time_local when blank is sent', async () => {
    const { pool, query } = makeMockPool({
      rows: [fullRow({ delivery_time_local: null })],
      rowCount: 1,
    })
    mockGetPool.mockReturnValue(pool)

    const res = await saveDeliveryPreferencesByOwnerId(fullSaveInput({ deliveryTimeLocal: '   ' }))

    expect(res.ok).toBe(true)
    expect((query.mock.calls[0][1] as unknown[])[5]).toBeNull()
  })

  it('returns not_found when the owner has no profile to update', async () => {
    const { pool } = makeMockPool({ rows: [], rowCount: 0 })
    mockGetPool.mockReturnValue(pool)

    const res = await saveDeliveryPreferencesByOwnerId(fullSaveInput({ ownerId: '999' }))

    expect(res).toEqual({ ok: false, reason: 'not_found' })
  })
})
