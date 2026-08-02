import {
  AgencyDnaValidationError,
  normalizeAgencyDnaCaseStudies,
  resolveAgencyDnaOpportunityContext,
} from '@/lib/opportunities/agency-dna'

describe('Agency DNA v1 opportunity context', () => {
  it('derives evidence-bound capability matches without changing a score', () => {
    const context = resolveAgencyDnaOpportunityContext({
      serviceTypes: ['permanent', 'executive', 'volume', 'project'],
      targetSeniorities: ['senior', 'executive'],
      preferredEngagementTypes: ['retainer'],
      currentCapacity: 'normal',
      matchedRoleFamilies: ['executive'],
      matchedIndustries: ['finance'],
      matchedRegions: ['Москва'],
      episodeTitle: 'Поиск директора по финансам',
      vacancyCount: 2,
      restrictionType: null,
    })

    expect(context.capabilityMatches).toEqual({
      roleFamilies: ['executive'],
      industries: ['finance'],
      regions: ['Москва'],
      seniorities: ['executive'],
      serviceTypes: ['permanent', 'executive', 'project'],
      engagementTypes: [],
      companySizeBucket: null,
    })
    expect(context.restrictionSnapshot).toEqual({
      type: null,
      opportunityMode: 'new',
      blocksOpportunity: false,
    })
    expect(context.blocksOpportunity).toBe(false)
  })

  it('does not mark a low-capacity agency as ready for volume work', () => {
    const context = resolveAgencyDnaOpportunityContext({
      serviceTypes: ['permanent', 'volume', 'project'],
      targetSeniorities: [],
      preferredEngagementTypes: [],
      currentCapacity: 'low',
      matchedRoleFamilies: [],
      matchedIndustries: [],
      matchedRegions: [],
      episodeTitle: 'Компания ускорила найм',
      vacancyCount: 12,
      restrictionType: null,
    })

    expect(context.capabilityMatches.serviceTypes).toEqual([
      'permanent',
      'project',
    ])
  })

  it.each([
    ['existing_client', 'grow', false],
    ['former_client', 'reactivate', false],
    ['do_not_contact', 'blocked', true],
    ['conflict', 'blocked', true],
  ] as const)(
    'applies %s as %s without treating existing accounts as cold-new',
    (restrictionType, opportunityMode, blocksOpportunity) => {
      const context = resolveAgencyDnaOpportunityContext({
        serviceTypes: ['permanent'],
        targetSeniorities: [],
        preferredEngagementTypes: [],
        currentCapacity: 'normal',
        matchedRoleFamilies: [],
        matchedIndustries: [],
        matchedRegions: [],
        episodeTitle: 'Новая волна найма',
        vacancyCount: 3,
        restrictionType,
      })

      expect(context.restrictionSnapshot).toEqual({
        type: restrictionType,
        opportunityMode,
        blocksOpportunity,
      })
      expect(context.blocksOpportunity).toBe(blocksOpportunity)
    },
  )

  it('normalizes public-safe case studies and rejects personal contacts', () => {
    expect(normalizeAgencyDnaCaseStudies([{
      roleFamilies: ['backend', 'backend'],
      industries: ['it'],
      companySizeBucket: 'medium',
      region: 'Москва',
      hiringModes: ['specialist'],
      measurableResult: 'Закрыли 8 позиций за 45 дней',
      publicSafeDescription: 'Подбор инженерной команды для продуктовой компании.',
    }])).toEqual([{
      roleFamilies: ['backend'],
      industries: ['it'],
      companySizeBucket: 'medium',
      region: 'Москва',
      hiringModes: ['specialist'],
      measurableResult: 'Закрыли 8 позиций за 45 дней',
      publicSafeDescription: 'Подбор инженерной команды для продуктовой компании.',
    }])

    expect(() => normalizeAgencyDnaCaseStudies([{
      measurableResult: 'Позвоните +7 999 123-45-67',
      publicSafeDescription: 'Контакт recruiter@example.test',
    }])).toThrow(AgencyDnaValidationError)

    const forgedCaseStudies = [{
      hiringModes: ['unsupported-mode'],
      publicSafeDescription: 'Безопасное описание.',
    }] as unknown as Parameters<typeof normalizeAgencyDnaCaseStudies>[0]
    expect(() => normalizeAgencyDnaCaseStudies(forgedCaseStudies))
      .toThrow(AgencyDnaValidationError)
  })
})
