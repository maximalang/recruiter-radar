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

function evidence(id: string, occurredAt: string) {
  return {
    id,
    eventType: 'hiring_growth',
    sourceRegistryId: `source-${id}`,
    occurredAt,
    detectedAt: occurredAt,
    sourceFamily: 'career-pages',
    confidence: 0.9,
    canonicalUrl: 'https://example.test/careers',
    primarySource: true,
  }
}

const REFERENCE_TIMESTAMP = Date.parse('2026-08-17T10:00:00.000Z')

describe('EvidenceRadarMap V1-V6 contract', () => {
  it('presents selected company in Why Now → Evidence → Action order', () => {
    const radarLead = lead('77', 'Альфа', 'Москва')
    radarLead.evidence = [evidence('evidence-1', '2026-08-11T00:00:00.000Z')]
    radarLead.score.contributions = [
      {
        eventId: 'evidence-1',
        component: 'hiring_intent',
        delta: 0.2,
        reason: 'verified company hiring growth',
      },
    ]

    const { container } = render(<EvidenceRadarMap leads={[radarLead]} referenceTimestamp={REFERENCE_TIMESTAMP} />)
    const card = container.querySelector('[data-evidence-lead-detail]')
    expect(card).not.toBeNull()
    const text = card?.textContent ?? ''

    expect(text).toContain('Компания с подтверждённым сигналом')
    expect(container.querySelector('[aria-label="Сила сигнала 82 из 100"]')).not.toBeNull()
    expect(text).toContain('Почему сейчас')
    expect(text).toContain('Подтверждения')
    expect(text).toContain('Рост найма')
    expect(text).toContain('достоверность 90%')
    expect(text).toContain('Контакт')
    expect(text).toContain('Следующий ход')
    expect(text).toContain('Диагностика оценки')
    expect(text).toContain('Интенсивность найма')
    expect(text).not.toMatch(/Evidence lead|Opportunity|Confidence|Urgency|Contactability|Hiring Growth|confidence 90%|hiring_intent/)

    const positions = [
      'Альфа',
      'Почему сейчас',
      'Подтверждения',
      'Контакт',
      'Следующий ход',
      'Диагностика оценки',
    ].map((label) => text.indexOf(label))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
  })

  it('uses recency × evidence confidence while keeping geographic data as metadata only', () => {
    const alphaLead = lead('77', 'Альфа', 'Москва')
    alphaLead.evidence = [evidence('alpha-evidence', '2026-08-15T00:00:00.000Z')]
    const betaLead = lead('78', 'Бета', 'Казань')
    betaLead.evidence = [evidence('beta-evidence', '2026-08-10T00:00:00.000Z')]

    const { container } = render(<EvidenceRadarMap leads={[alphaLead, betaLead]} referenceTimestamp={REFERENCE_TIMESTAMP} />)

    expect(screen.getByText('Свежесть × уровень подтверждения')).toBeInTheDocument()
    expect(screen.getByText('по горизонтали — свежесть')).toBeInTheDocument()
    expect(screen.getByText('по вертикали — подтверждение')).toBeInTheDocument()
    expect(container.querySelector('[data-evidence-radar-map]')).not.toBeNull()
    expect(container.querySelector('[data-recency]')).not.toBeNull()
    expect(container.querySelector('[data-confidence]')).not.toBeNull()
    expect(container.querySelector('[data-region-code]')).toBeNull()
  })

  it('keeps 44px semantic markers and updates live detail without losing focus', () => {
    const { container } = render(
      <EvidenceRadarMap
        referenceTimestamp={REFERENCE_TIMESTAMP}
        leads={[
          lead('77', 'Альфа', 'Москва'),
          lead('78', 'Бета', 'Казань'),
        ]}
      />,
    )

    const alpha = screen.getByRole('button', { name: 'Альфа, Москва' })
    const beta = screen.getByRole('button', { name: 'Бета, Казань' })
    expect(alpha).toHaveAttribute('aria-pressed', 'true')

    beta.focus()
    fireEvent.click(beta)

    expect(beta).toHaveFocus()
    expect(beta).toHaveAttribute('aria-pressed', 'true')
    expect(alpha).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('status')).toHaveTextContent('Выбрано: Бета, Казань')
    expect(screen.getByRole('heading', { name: 'Бета' })).toBeInTheDocument()
    expect(container.querySelector('[data-evidence-lead-detail]')).not.toBeNull()
  })

  it('renders evidence points only for real evidence rows, never from source-count decoration', () => {
    const radarLead = lead('77', 'Альфа', 'Москва')
    radarLead.independentSourceCount = 7
    radarLead.evidence = [
      evidence('evidence-1', '2026-08-15T00:00:00.000Z'),
      evidence('evidence-2', '2026-08-14T00:00:00.000Z'),
    ]

    const { container } = render(<EvidenceRadarMap leads={[radarLead]} referenceTimestamp={REFERENCE_TIMESTAMP} />)
    expect(container.querySelectorAll('[data-evidence-source]')).toHaveLength(2)
  })
})
