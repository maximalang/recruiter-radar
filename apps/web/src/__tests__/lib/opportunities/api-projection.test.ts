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
  })
})
