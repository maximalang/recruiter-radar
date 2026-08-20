/**
 * @jest-environment jsdom
 *
 * UI test for the AI-enrichment block on the lead detail page (Block 1 §5).
 *
 * Contract:
 *   - ai_enrichment null  → block hidden (renders nothing).
 *   - ai_enrichment non-null → block rendered, labelled as an AI hint, showing
 *     roles / urgency / departments / geo / summary / confidence.
 *   - empty-but-non-null payload → still hidden (no empty labelled card).
 *
 * The block is a server component but pure (props in, JSX out) — it renders fine
 * under testing-library with no async/server data.
 */

import { render, screen } from '@testing-library/react';
import AiEnrichmentBlock from '@/app/leads/[id]/ai-enrichment-block';
import type { StoredAiEnrichment } from '@/lib/ai/enrichment/enrichmentStore';

function enrichment(overrides: Partial<StoredAiEnrichment> = {}): StoredAiEnrichment {
  return {
    detectedRoles: [
      { title: 'Backend-разработчик', department: 'Инженерия', confidence: 'medium' },
      { title: 'QA-инженер', department: null, confidence: 'low' },
    ],
    hiringUrgency: 'high',
    departments: ['Инженерия', 'Продукт'],
    locations: ['Москва', 'Удалённо'],
    hiringPatternSummary: 'Активный найм в инженерную команду.',
    confidence: 'medium',
    sourceUrl: 'https://acme.test/careers',
    provider: 'scrapegraph',
    schemaVersion: 1,
    enrichedAt: '2026-06-29T12:00:00.000Z',
    ...overrides,
  };
}

describe('AiEnrichmentBlock', () => {
  it('renders nothing when ai_enrichment is null', () => {
    const { container } = render(<AiEnrichmentBlock enrichment={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the payload has no usable signal', () => {
    const { container } = render(
      <AiEnrichmentBlock
        enrichment={enrichment({
          detectedRoles: [],
          departments: [],
          locations: [],
          hiringPatternSummary: '',
        })}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the AI hint block when enrichment is present', () => {
    render(<AiEnrichmentBlock enrichment={enrichment()} />);

    // Labelled explicitly as an AI hint, not source-of-truth.
    expect(screen.getByText(/ИИ-подсказка по найму/i)).toBeInTheDocument();
    expect(screen.getByText(/не влияет на/i)).toBeInTheDocument();

    // Signals are shown.
    expect(screen.getByText('Backend-разработчик')).toBeInTheDocument();
    expect(screen.getByText('QA-инженер')).toBeInTheDocument();
    expect(screen.getByText('Активный найм в инженерную команду.')).toBeInTheDocument();
    expect(screen.getByText('Высокая')).toBeInTheDocument(); // urgency
    expect(screen.getByText(/Москва, Удалённо/)).toBeInTheDocument(); // geo
    expect(screen.getByText('Уверенность ИИ')).toBeInTheDocument();
    expect(screen.getByText(/средняя · scrapegraph/)).toBeInTheDocument();
  });

  it('omits a role department when it is null', () => {
    render(
      <AiEnrichmentBlock
        enrichment={enrichment({
          detectedRoles: [{ title: 'Sales', department: null, confidence: 'medium' }],
          departments: [],
          locations: [],
          hiringPatternSummary: '',
        })}
      />,
    );
    expect(screen.getByText('Sales')).toBeInTheDocument();
  });
});
