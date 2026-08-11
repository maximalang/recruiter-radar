import { COMPANY_EVENT_TYPES } from '@/lib/opportunities/company-event-normalization'
import {
  COMPANY_EVENT_SUPPORT_REGISTRY,
  getCompanyEventSupport,
  isProductionCompanyEvent,
  renderCompanyEventSupportMatrixMarkdown,
} from '@/lib/opportunities/company-event-support-registry'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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
      expect(getCompanyEventSupport(eventType).producer).not.toBeNull()
      expect(getCompanyEventSupport(eventType).payloadVersion).not.toBeNull()
      expect(getCompanyEventSupport(eventType).productionTested).toBe(true)
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

  it('keeps the documentation matrix checked against the registry', () => {
    const docs = readFileSync(
      resolve(process.cwd(), '..', '..', 'docs', 'company-events-v1.md'),
      'utf8',
    ).replace(/\r\n/g, '\n')
    expect(docs).toContain([
      '<!-- COMPANY_EVENT_SUPPORT_MATRIX:START -->',
      renderCompanyEventSupportMatrixMarkdown(),
      '<!-- COMPANY_EVENT_SUPPORT_MATRIX:END -->',
    ].join('\n'))
  })
})
