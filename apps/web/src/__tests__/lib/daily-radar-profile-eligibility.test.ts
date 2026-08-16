const query = jest.fn()
const getEffectiveEntitlements = jest.fn()

jest.mock('@/lib/db-pool', () => ({ getPool: () => ({ query }) }))
jest.mock('@/lib/entitlements', () => ({
  getEffectiveEntitlements: (...args: unknown[]) => getEffectiveEntitlements(...args),
}))

import {
  classifyDailyRadarProfileEligibility,
  loadDailyRadarProfileEligibility,
} from '@/lib/daily-radar-profile-eligibility'

const profile = (overrides: Partial<Parameters<typeof classifyDailyRadarProfileEligibility>[0][number]> = {}) => ({
  id: '1',
  ownerId: '10',
  workspaceId: '20',
  isActive: true,
  deliveryEnabled: true,
  deliveryFrequency: 'daily',
  hasConfiguredChannel: true,
  ...overrides,
})

describe('Daily Radar profile eligibility', () => {
  const sunday = new Date('2026-08-16T06:15:00.000Z')

  it('returns a healthy zero-eligible summary with mutually exclusive safe reasons', () => {
    const result = classifyDailyRadarProfileEligibility([
      profile({ id: 'paused', isActive: false }),
      profile({ id: 'inactive-entitlement', ownerId: '11' }),
      profile({ id: 'disabled', ownerId: '12', deliveryEnabled: false }),
      profile({ id: 'no-channel', ownerId: '13', hasConfiguredChannel: false }),
      profile({ id: 'weekly', ownerId: '14', deliveryFrequency: 'weekly' }),
      profile({ id: 'incomplete', ownerId: null }),
      profile({ id: 'excluded', ownerId: '15', workspaceId: '99' }),
    ], {
      now: sunday,
      excludedWorkspaceId: '99',
      entitledProfileIds: new Set(['disabled', 'no-channel', 'weekly']),
    })

    expect(result.eligible).toEqual([])
    expect(result.summary).toEqual({
      total: 7,
      active: 6,
      eligible: 0,
      excluded: {
        profile_paused: 1,
        entitlement_inactive: 1,
        delivery_disabled: 1,
        frequency_mismatch: 1,
        delivery_window_mismatch: 0,
        configuration_incomplete: 1,
        no_configured_channel: 1,
        explicit_exclusion: 1,
      },
    })
  })

  it('returns only entitled profiles that are due and have a configured channel', () => {
    const eligible = profile({ id: 'eligible' })
    const result = classifyDailyRadarProfileEligibility([eligible], {
      now: sunday,
      excludedWorkspaceId: null,
      entitledProfileIds: new Set(['eligible']),
    })

    expect(result.eligible).toEqual([eligible])
    expect(result.summary.eligible).toBe(1)
  })

  it('loads only non-PII profile fields and requires digest plus delivery entitlement', async () => {
    query.mockResolvedValueOnce({ rows: [profile({ id: 'eligible' }), profile({ id: 'digest-only', ownerId: '11' })] })
    getEffectiveEntitlements.mockResolvedValueOnce(new Map([
      ['10', { status: 'active', features: ['digest', 'delivery'] }],
      ['11', { status: 'active', features: ['digest'] }],
    ]))

    const result = await loadDailyRadarProfileEligibility({ now: sunday, excludedWorkspaceId: null })

    expect(result.eligible.map((candidate) => candidate.id)).toEqual(['eligible'])
    expect(result.summary.excluded.entitlement_inactive).toBe(1)
    expect(String(query.mock.calls[0][0])).not.toMatch(/agency_name|digest_email\s+AS|destination_id\s+AS/i)
  })
})
