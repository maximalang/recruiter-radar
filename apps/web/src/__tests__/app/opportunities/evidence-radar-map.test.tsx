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
