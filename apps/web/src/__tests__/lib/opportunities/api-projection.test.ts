import { toPublicOpportunity } from '@/lib/opportunities/api-projection'
import type { OpportunityItem } from '@/lib/opportunities/repository'

describe('opportunity API projection', () => {
  it('omits ownership, hashes, internal candidate IDs, and raw contact paths', () => {
    const publicItem = toPublicOpportunity({
      id: '10',
      ownerId: '7',
      clientProfileId: '8',
      organizationId: '9',
      hiringEpisodeId: '11',
      organizationName: 'Пример',
      organizationDomain: 'example.test',
      episodeType: 'vacancy_spike',
      episodeStatus: 'active',
      episodeStartedAt: '2026-07-20T00:00:00.000Z',
      episodeLastSeenAt: '2026-07-26T00:00:00.000Z',
      status: 'new',
      commercialStage: 'new',
      workflowState: 'active',
      workflow: {
        assignedToUserId: '42',
        nextActionType: 'follow_up',
        nextActionDueAt: '2026-08-02T06:30:00.000Z',
        workflowPriority: 'high',
        internalNote: 'Не публиковать в аналитическом snapshot.',
        lastEventId: '81',
        updatedAt: '2026-08-01T12:00:00.000Z',
      },
      title: 'Возможность',
      whyNow: 'Почему',
      problemHypothesis: 'Гипотеза',
      recommendedAngle: 'Заход',
      recommendedPersona: 'HRD',
      recommendedAction: 'Подготовить черновик',
      opportunityScore: 0.8,
      confidenceGate: 'A',
      scores: {},
      evidenceHash: 'a'.repeat(64),
      validFrom: '2026-07-26T00:00:00.000Z',
      validUntil: null,
      snoozedUntil: null,
      metadata: {
        morningBriefEligible: true,
        sourceFamilies: ['career-pages'],
        components: {
          agencyFit: {
            score: 0.8,
            contactPaths: [{ value: 'nested-private@example.test' }],
          },
        },
        fiur: { total: 3.2, digestCandidateId: 'nested-private-id' },
        digestCandidateId: 'private-internal-id',
        contactPaths: [{ category: 'email', value: 'personal@example.test' }],
      },
      strategistBrief: {
        version: 'opportunity-strategist-v1',
        whatChanged: evidenceConclusion('Открыто 8 вакансий.', ['11']),
        whyNow: evidenceConclusion('Сигналы свежие.', ['11']),
        problemHypothesis: heuristicConclusion('Может понадобиться поддержка.'),
        agencyFitExplanation: heuristicConclusion('Есть профильное совпадение.'),
        externalSupportNeedExplanation: evidenceConclusion(
          'Темп найма вырос.',
          ['11'],
        ),
        recommendedPersona: heuristicConclusion('Проверить функцию HRD.'),
        recommendedAngle: heuristicConclusion('Обсудить сложные роли.'),
        recommendedCaseStudy: heuristicConclusion('Точного кейса нет.'),
        recommendedNextAction: heuristicConclusion('Проверить доказательства.'),
        riskSignals: [heuristicConclusion('Бюджет не подтверждён.')],
        limitations: [heuristicConclusion('Нужна ручная проверка.')],
      },
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z',
      evidenceCount: 0,
      factCount: 0,
      publicationCount: 0,
      sourceFamilyCount: 0,
      directEvidenceCount: 0,
      agencyFitExplanation: 'Роли совпадают со специализацией.',
      evidenceTimeline: [],
    })
    const serialized = JSON.stringify(publicItem)

    expect(serialized).not.toContain('"ownerId"')
    expect(serialized).not.toContain('"evidenceHash"')
    expect(serialized).not.toContain('private-internal-id')
    expect(serialized).not.toContain('personal@example.test')
    expect(serialized).not.toContain('nested-private@example.test')
    expect(serialized).not.toContain('nested-private-id')
    expect(serialized).not.toContain('Не публиковать')
    expect(serialized).not.toContain('lastEventId')
    expect(publicItem.workflow).toEqual({
      assignedToUserId: '42',
      nextActionType: 'follow_up',
      nextActionDueAt: '2026-08-02T06:30:00.000Z',
      workflowPriority: 'high',
      updatedAt: '2026-08-01T12:00:00.000Z',
    })
    expect(serialized).not.toContain('"evidenceCount"')
    expect(publicItem).not.toHaveProperty('factCount')
    expect(publicItem.evidenceMetrics).toEqual({
      factCount: 0,
      publicationCount: 0,
      sourceFamilyCount: 0,
      directEvidenceCount: 0,
    })
    expect(publicItem.morningBriefEligible).toBe(true)
    expect(publicItem.sourceFamilies).toEqual(['career-pages'])
    expect(publicItem.strategistBrief).toEqual(expect.objectContaining({
      version: 'opportunity-strategist-v1',
      evidenceTimeline: [],
    }))
  })
})

function evidenceConclusion(text: string, supportingEvidenceIds: string[]) {
  return { text, basis: 'evidence' as const, supportingEvidenceIds }
}

function heuristicConclusion(text: string) {
  return { text, basis: 'heuristic' as const, supportingEvidenceIds: [] }
}
