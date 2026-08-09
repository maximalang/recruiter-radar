import {
  COMPANY_EVENT_TYPES,
  normalizeJobPostingCompanyEvents,
  type CompanyEventSourceRecord,
} from '@/lib/opportunities/company-event-normalization'

const NOW = new Date('2026-08-03T12:00:00.000Z')

function sourceRecord(
  id: string,
  overrides: Partial<CompanyEventSourceRecord> = {},
): CompanyEventSourceRecord {
  return {
    id,
    organizationId: '10',
    signalType: 'job_posting',
    title: 'Senior Java developer',
    region: 'Москва',
    source: 'hh',
    sourceUrl: `https://example.test/vacancies/${id}`,
    externalVacancyId: id,
    occurredAt: '2026-08-02T09:00:00.000Z',
    firstSeenAt: '2026-08-02T09:05:00.000Z',
    lastSeenAt: '2026-08-02T10:00:00.000Z',
    evidenceIds: [`evidence-${id}`],
    payload: { vacancy_name: 'Senior Java developer' },
    ...overrides,
  }
}

describe('Company Events v1 normalization', () => {
  it('declares the complete event type contract without manufacturing unsupported events', () => {
    expect(COMPANY_EVENT_TYPES).toEqual([
      'job_posting',
      'vacancy_repost',
      'vacancy_salary_change',
      'vacancy_cluster',
      'recruiter_vacancy',
      'leadership_change',
      'new_business_unit',
      'new_region',
      'office_opening',
      'product_launch',
      'funding_or_investment',
      'major_contract',
      'career_page_change',
      'hiring_restart',
      'hiring_slowdown',
    ])
  })

  it('rejects a source record without real evidence instead of inventing an event', () => {
    const result = normalizeJobPostingCompanyEvents([
      sourceRecord('no-evidence', { evidenceIds: [] }),
    ], NOW)

    expect(result.events).toEqual([])
    expect(result.rejections).toEqual([{
      sourceRecordIds: ['no-evidence'],
      reasonCode: 'COMPANY_EVENT_EVIDENCE_MISSING',
    }])
  })

  it('deduplicates one vacancy across sources and preserves every publication', () => {
    const records = [
      sourceRecord('hh-101', {
        source: 'hh',
        externalVacancyId: '101',
        sourceUrl: 'https://hh.test/vacancy/101',
        title: ' Senior Java Developer ',
        evidenceIds: ['evidence-hh'],
      }),
      sourceRecord('career-77', {
        source: 'career-pages',
        externalVacancyId: 'career-77',
        sourceUrl: 'https://company.test/career/java?ref=jobs',
        title: 'senior java developer',
        evidenceIds: ['evidence-career'],
        firstSeenAt: '2026-08-02T09:10:00.000Z',
        lastSeenAt: '2026-08-02T11:00:00.000Z',
      }),
    ]

    const result = normalizeJobPostingCompanyEvents(records, NOW)
    const reversed = normalizeJobPostingCompanyEvents([...records].reverse(), NOW)
    const jobPosting = result.events.find((event) => event.eventType === 'job_posting')
    const reversedJobPosting = reversed.events.find(
      (event) => event.eventType === 'job_posting',
    )

    expect(result.rejections).toEqual([])
    expect(result.events.filter((event) => event.eventType === 'job_posting')).toHaveLength(1)
    expect(jobPosting).toMatchObject({
      organizationId: '10',
      eventType: 'job_posting',
      sourceRecordId: 'hh-101',
      evidenceIds: ['evidence-career', 'evidence-hh'],
      firstSeenAt: '2026-08-02T09:05:00.000Z',
      lastSeenAt: '2026-08-02T11:00:00.000Z',
      payload: {
        title: 'Senior Java Developer',
        region: 'Москва',
        matchKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    })
    expect(jobPosting?.publications.map((item) => item.sourceRecordId))
      .toEqual(['career-77', 'hh-101'])
    expect(jobPosting?.eventFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(reversedJobPosting?.eventFingerprint)
      .toBe(jobPosting?.eventFingerprint)
    expect(result.events.some((event) => event.eventType === 'new_region')).toBe(false)
  })

  it('keeps same-source vacancies with conflicting external ids separate', () => {
    const result = normalizeJobPostingCompanyEvents([
      sourceRecord('first', {
        sourceUrl: null,
        externalVacancyId: 'first',
      }),
      sourceRecord('second', {
        sourceUrl: null,
        externalVacancyId: 'second',
      }),
    ], NOW)
    const jobPostingEvents = result.events.filter(
      (event) => event.eventType === 'job_posting',
    )

    expect(result.rejections).toEqual([])
    expect(jobPostingEvents).toHaveLength(2)
    expect(new Set(jobPostingEvents.map((event) => event.eventFingerprint)).size)
      .toBe(2)
  })

  it('creates a new immutable publication observation only when source state changes', () => {
    const original = sourceRecord('hh-101')
    const replay = sourceRecord('hh-101', {
      payload: { vacancy_name: 'Senior Java developer' },
    })
    const updated = sourceRecord('hh-101', {
      lastSeenAt: '2026-08-03T10:00:00.000Z',
      payload: { vacancy_name: 'Senior Java developer', salary: '300000' },
    })

    const originalFingerprint = normalizeJobPostingCompanyEvents([original], NOW)
      .events[0].publications[0].publicationFingerprint
    const replayFingerprint = normalizeJobPostingCompanyEvents([replay], NOW)
      .events[0].publications[0].publicationFingerprint
    const updatedFingerprint = normalizeJobPostingCompanyEvents([updated], NOW)
      .events[0].publications[0].publicationFingerprint

    expect(replayFingerprint).toBe(originalFingerprint)
    expect(updatedFingerprint).not.toBe(originalFingerprint)
  })

  it('emits the versioned vacancy repost contract without inventing observations', () => {
    const result = normalizeJobPostingCompanyEvents([
      sourceRecord('hh-old', {
        externalVacancyId: 'old-101',
        occurredAt: '2026-07-10T09:00:00.000Z',
        firstSeenAt: '2026-07-10T09:05:00.000Z',
        lastSeenAt: '2026-07-10T10:00:00.000Z',
        evidenceIds: ['evidence-old'],
      }),
      sourceRecord('hh-new', {
        externalVacancyId: 'new-101',
        occurredAt: '2026-08-02T09:00:00.000Z',
        evidenceIds: ['evidence-new'],
      }),
    ], NOW)

    const repost = result.events.find((event) => event.eventType === 'vacancy_repost')
    expect(repost?.payload).toMatchObject({
      payloadVersion: 'vacancy-repost-v2',
      intervalDays: 23,
      lifecycleClassification: 'meaningful',
      salaryChanged: null,
      requirementsChanged: null,
      sourcePublicationChanged: true,
      reasonCodes: ['SAME_ROLE_REAPPEARED_WITH_NEW_SOURCE_ID'],
    })
    expect(repost?.payload).not.toHaveProperty('automated')
  })

  it('classifies a standard 30-day repost as routine republication', () => {
    const result = normalizeJobPostingCompanyEvents([
      sourceRecord('hh-old', {
        externalVacancyId: 'old-101',
        occurredAt: '2026-07-03T09:00:00.000Z',
        firstSeenAt: '2026-07-03T09:05:00.000Z',
        lastSeenAt: '2026-07-03T10:00:00.000Z',
      }),
      sourceRecord('hh-new', { externalVacancyId: 'new-101' }),
    ], NOW)

    const repost = result.events.find((event) => event.eventType === 'vacancy_repost')
    expect(repost?.payload).toMatchObject({
      intervalDays: 30,
      lifecycleClassification: 'routine_republication',
    })
  })

  it('preserves headline-derived title and region in immutable provenance', () => {
    const event = normalizeJobPostingCompanyEvents([
      sourceRecord('headline-source', {
        title: 'Lead Go developer',
        region: 'Казань',
        payload: {},
      }),
    ], NOW).events[0]

    expect(event.publications[0].sourceSnapshot).toMatchObject({
      companyEventObservation: {
        title: 'Lead Go developer',
        region: 'Казань',
        signalType: 'job_posting',
      },
    })
  })

  it('never attaches an evidence-free record to an evidenced publication group', () => {
    const result = normalizeJobPostingCompanyEvents([
      sourceRecord('proven', { evidenceIds: ['evidence-proven'] }),
      sourceRecord('unsupported', {
        source: 'career-pages',
        externalVacancyId: 'career-unsupported',
        evidenceIds: [],
      }),
    ], NOW)

    expect(result.events).toHaveLength(1)
    expect(result.events[0].publications.map((publication) =>
      publication.sourceRecordId)).toEqual(['proven'])
    expect(result.rejections).toEqual([{
      sourceRecordIds: ['unsupported'],
      reasonCode: 'COMPANY_EVENT_EVIDENCE_MISSING',
    }])
  })
})
