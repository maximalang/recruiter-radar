import { COMPANY_EVENT_TYPES } from '@/lib/opportunities/company-event-normalization'
import {
  COMPANY_EVENT_SUPPORT_REGISTRY,
  getCompanyEventSupport,
  isProductionCompanyEvent,
} from '@/lib/opportunities/company-event-support-registry'

describe('Company Event support registry', () => {
  it('classifies every schema event type explicitly', () => {
    expect(Object.keys(COMPANY_EVENT_SUPPORT_REGISTRY).sort()).toEqual(
      [...COMPANY_EVENT_TYPES].sort(),
    )
  })

  it('keeps current vacancy-derived events production supported', () => {
    for (const eventType of [
      'job_posting',
      'vacancy_repost',
      'vacancy_salary_change',
      'vacancy_cluster',
      'recruiter_vacancy',
      'new_region',
      'hiring_restart',
    ] as const) {
      expect(isProductionCompanyEvent(eventType)).toBe(true)
      expect(getCompanyEventSupport(eventType).realSource).not.toBeNull()
    }
  })

  it('does not claim unsupported/context business events as production sources', () => {
    for (const eventType of [
      'leadership_change',
      'new_business_unit',
      'office_opening',
      'product_launch',
      'funding_or_investment',
      'major_contract',
      'career_page_change',
      'hiring_slowdown',
    ] as const) {
      expect(isProductionCompanyEvent(eventType)).toBe(false)
      expect(getCompanyEventSupport(eventType).canTriggerCommercialEpisode).toBe(false)
    }
  })
})
