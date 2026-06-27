import { buildNewLeadsPushPayload } from '@/lib/webPushPayload'

describe('buildNewLeadsPushPayload', () => {
  it('defaults the URL to /leads and uses the fixed title', () => {
    const payload = buildNewLeadsPushPayload({ count: 3 })
    expect(payload.title).toBe('Recruiter Radar')
    expect(payload.url).toBe('/leads')
  })

  it('passes a custom URL through unchanged', () => {
    const payload = buildNewLeadsPushPayload({ count: 1, url: '/leads?gate=A' })
    expect(payload.url).toBe('/leads?gate=A')
  })

  it('uses the empty-state body when count is zero or negative', () => {
    expect(buildNewLeadsPushPayload({ count: 0 }).body).toBe(
      'Появились новые лиды в радаре.',
    )
    // Negative is clamped to 0 → same empty-state copy.
    expect(buildNewLeadsPushPayload({ count: -5 }).body).toBe(
      'Появились новые лиды в радаре.',
    )
  })

  it('truncates fractional counts toward zero', () => {
    expect(buildNewLeadsPushPayload({ count: 2.9 }).body).toContain('2 ')
  })

  // Russian plural is the part most likely to regress — pin every branch,
  // including the 11–14 special case that overrides the mod-10 rule.
  it.each<[number, string]>([
    [1, '1 новый сильный лид в радаре — стоит написать сегодня.'],
    [2, '2 новых сильных лида в радаре — стоит написать сегодня.'],
    [3, '3 новых сильных лида в радаре — стоит написать сегодня.'],
    [4, '4 новых сильных лида в радаре — стоит написать сегодня.'],
    [5, '5 новых сильных лидов в радаре — стоит написать сегодня.'],
    [11, '11 новых сильных лидов в радаре — стоит написать сегодня.'],
    [12, '12 новых сильных лидов в радаре — стоит написать сегодня.'],
    [13, '13 новых сильных лидов в радаре — стоит написать сегодня.'],
    [14, '14 новых сильных лидов в радаре — стоит написать сегодня.'],
    [21, '21 новый сильный лид в радаре — стоит написать сегодня.'],
    [22, '22 новых сильных лида в радаре — стоит написать сегодня.'],
    [25, '25 новых сильных лидов в радаре — стоит написать сегодня.'],
    [111, '111 новых сильных лидов в радаре — стоит написать сегодня.'],
    [121, '121 новый сильный лид в радаре — стоит написать сегодня.'],
  ])('pluralizes %i correctly', (count, expected) => {
    expect(buildNewLeadsPushPayload({ count }).body).toBe(expected)
  })
})
