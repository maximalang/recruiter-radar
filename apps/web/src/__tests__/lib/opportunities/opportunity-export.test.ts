import { strFromU8, unzipSync } from 'fflate'

import {
  opportunitiesToCsv,
  opportunitiesToXlsx,
  toOpportunityExportRecord,
  type OpportunityExportRecord,
} from '@/lib/opportunities/opportunity-export'

const RECORD: OpportunityExportRecord = {
  opportunityReference: '2bc92f8e-8930-4af1-b743-14c0c0df2650',
  organizationName: '=HYPERLINK("https://attacker.invalid")',
  organizationDomain: 'example.ru',
  title: 'Найм backend-команды',
  commercialStage: 'accepted',
  workflowState: 'active',
  whyNow: 'Появились новые вакансии',
  problemHypothesis: 'Команда перегружена наймом',
  recommendedAngle: 'Предложить точечный поиск',
  recommendedPersona: 'HRD',
  recommendedAction: 'Написать через форму компании',
  opportunityScore: 0.82,
  confidenceGate: 'A',
  validUntil: '2026-08-20T00:00:00.000Z',
  nextActionType: 'follow_up',
  nextActionDueAt: '2026-08-02T08:00:00.000Z',
  workflowPriority: 'high',
  evidenceUrls: ['https://example.ru/careers'],
}

describe('opportunity export', () => {
  it('creates an allowlisted CSV and neutralizes spreadsheet formulas', () => {
    const csv = opportunitiesToCsv([RECORD])

    expect(csv).toContain('opportunityReference,organizationName')
    expect(csv).toContain("'=HYPERLINK")
    expect(csv).toContain(RECORD.opportunityReference)
    expect(csv).not.toMatch(/ownerId|workspaceId|evidenceHash|internalNote/)
  })

  it('creates a valid XLSX archive with the same allowlisted fields', () => {
    const archive = unzipSync(opportunitiesToXlsx([RECORD]))
    const workbook = strFromU8(archive['xl/workbook.xml'])
    const worksheet = strFromU8(archive['xl/worksheets/sheet1.xml'])

    expect(workbook).toContain('Opportunity export')
    expect(worksheet).toContain('opportunityReference')
    expect(worksheet).toContain(RECORD.opportunityReference)
    expect(worksheet).toContain('&apos;=HYPERLINK')
    expect(worksheet).not.toMatch(/ownerId|workspaceId|evidenceHash|internalNote/)
  })

  it('projects only public CRM fields from an opportunity', () => {
    const record = toOpportunityExportRecord({
      publicReference: RECORD.opportunityReference,
      organizationName: 'Пример',
      organizationDomain: 'example.ru',
      title: 'Возможность',
      commercialStage: 'new',
      workflowState: 'active',
      whyNow: 'Почему сейчас',
      problemHypothesis: 'Гипотеза',
      recommendedAngle: 'Заход',
      recommendedPersona: 'HRD',
      recommendedAction: 'Подготовить черновик',
      opportunityScore: 0.71,
      confidenceGate: 'B',
      validUntil: null,
      workflow: {
        assignedToUserId: '42',
        nextActionType: 'follow_up',
        nextActionDueAt: null,
        workflowPriority: 'normal',
        internalNote: 'Не экспортировать',
        lastEventId: '81',
        updatedAt: '2026-08-01T12:00:00.000Z',
      },
      evidenceTimeline: [{ url: 'https://example.ru/careers' }],
      ownerId: '7',
      workspaceId: '9',
      evidenceHash: 'private',
    })

    expect(record).toEqual(expect.objectContaining({
      opportunityReference: RECORD.opportunityReference,
      evidenceUrls: ['https://example.ru/careers'],
      nextActionType: 'follow_up',
    }))
    expect(JSON.stringify(record)).not.toMatch(
      /ownerId|workspaceId|evidenceHash|internalNote|lastEventId/,
    )
  })
})
