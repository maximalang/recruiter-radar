/** @jest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'

import { EvidenceRadarMap } from '@/app/opportunities/evidence-radar-map'
import type { EvidenceRadarLead } from '@/lib/intelligence/evidence-radar-repository'

function lead(cardId: string, organizationName: string, city: string): EvidenceRadarLead {
  return {
    cardId,
    organizationId: `org-${cardId}`,
    organizationName,
    legalName: null,
    domain: null,
    title: 'Подтверждённый спрос',
    whyNow: 'Два независимых источника подтверждают активный найм.',
    recommendedAction: 'Проверить company-level контакт.',
    recommendedContactAt: null,
    validUntil: '2026-09-01T00:00:00.000Z',
    location: {
      city,
      federalSubjectCode: cardId,
      federalSubjectName: `Регион ${cardId}`,
      address: null,
      latitude: 55.75,
      longitude: 37.61,
      confidence: 0.9,
      locationType: 'office',
    },
    score: {
      leadScore: 82,
      opportunityScore: 80,
      confidenceScore: 90,
      urgencyScore: 72,
      contactabilityScore: 68,
      riskScore: 10,
      components: { freshness: 0.8, hiringIntent: 0.82 },
      contributions: [],
    },
    staffingNeed: null,
    specialization: 'Разработка',
    independentSourceCount: 2,
    evidence: [],
    contactPaths: [],
    riskReasons: [],
  }
}

describe('EvidenceRadarMap selection', () => {
  it('presents the selected lead in recruiter decision order without internal English labels', () => {
    const radarLead = lead('77', 'Альфа', 'Москва')
    radarLead.evidence = [
      {
        id: 'evidence-1',
        eventType: 'hiring_growth',
        sourceRegistryId: 'source-registry-1',
        occurredAt: '2026-08-11T00:00:00.000Z',
        detectedAt: '2026-08-11T01:00:00.000Z',
        sourceFamily: 'career-pages',
        confidence: 0.9,
        canonicalUrl: 'https://example.test/careers',
        primarySource: true,
      },
    ]
    radarLead.score.contributions = [
      {
        eventId: 'evidence-1',
        component: 'hiring_intent',
        delta: 0.2,
        reason: 'verified company hiring growth',
      },
    ]

    const { container } = render(<EvidenceRadarMap leads={[radarLead]} />)
    const card = container.querySelector('[data-evidence-lead-card]')
    expect(card).not.toBeNull()
    const text = card?.textContent ?? ''

    expect(text).toContain('Подтверждённая возможность')
    expect(text).toContain('Сила возможности')
    expect(text).toContain('Достоверность')
    expect(text).toContain('Срочность')
    expect(text).toContain('Доступность контакта')
    expect(text).toContain('Рост найма')
    expect(text).toContain('достоверность 90%')
    expect(text).toContain('Интенсивность найма')
    expect(text).not.toMatch(/Evidence lead|Opportunity|Confidence|Urgency|Contactability|Hiring Growth|confidence 90%|hiring_intent/)

    const positions = [
      'Альфа',
      'Почему сейчас',
      'Сила возможности',
      'Доказательства',
      'Безопасный путь контакта',
      'Следующий шаг',
      'Диагностика оценки',
    ].map((label) => text.indexOf(label))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
  })

  it('keeps a 44px semantic marker and updates the live detail without losing focus', () => {
    const { container } = render(
      <EvidenceRadarMap
        leads={[
          lead('77', 'Альфа', 'Москва'),
          lead('78', 'Бета', 'Казань'),
        ]}
      />,
    )

    const alpha = screen.getByRole('button', { name: 'Альфа, Москва' })
    const beta = screen.getByRole('button', { name: 'Бета, Казань' })
    expect(alpha).toHaveAttribute('aria-pressed', 'true')
    expect(alpha).toHaveAttribute('data-motion-interactive')

    beta.focus()
    fireEvent.click(beta)

    expect(beta).toHaveFocus()
    expect(beta).toHaveAttribute('aria-pressed', 'true')
    expect(alpha).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('status')).toHaveTextContent('Выбрано: Бета, Казань')
    expect(screen.getByRole('heading', { name: 'Бета' })).toBeInTheDocument()
    expect(container.querySelector('[data-evidence-lead-card]')).toHaveAttribute(
      'data-motion-disclosure',
    )
  })

  it('marks deterministic evidence dots for short selected-state reveal', () => {
    const { container } = render(
      <EvidenceRadarMap leads={[lead('77', 'Альфа', 'Москва')]} />,
    )

    const dots = container.querySelectorAll('[data-evidence-source]')
    expect(dots).toHaveLength(2)
    expect(dots[0]).toHaveStyle('--source-index: 0')
    expect(dots[1]).toHaveStyle('--source-index: 1')
  })
})
