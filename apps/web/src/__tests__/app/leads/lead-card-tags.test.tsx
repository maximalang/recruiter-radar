/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { LeadCard, LeadsListLegend } from '@/app/leads/leads-list-components';
import type { LeadItem } from '@/lib/leads-data';

const baseLead = {
  id: 'lead-1',
  orgId: 'org-1',
  clientProfileId: 'profile-1',
  orgName: 'Ромашка',
  sourceExternalId: null,
  score: 320,
  confidenceGate: 'A',
  vacanciesCount: 4,
  distinctVacancyNamesCount: 3,
  latestPublishedAt: '2026-07-01T00:00:00Z',
  reasons: [],
  structuredReasons: [],
  whyNow: 'Hiring burst across 3 roles',
  lawfulContactPath: 'Карьерная страница',
  negativeSignals: [],
  opener: '',
  feedbackStatus: 'contacted',
  suppressedUntil: null,
  createdAt: '2026-06-01T00:00:00Z',
  sourceFamilies: ['career-pages'],
  evidenceTitles: ['Backend', 'DevOps'],
  locationNames: ['Москва'],
  hasAiHint: true,
  isForeignEmployer: false,
  foreignMatchedDomain: null,
  reviewStatus: 'auto_approved',
} as unknown as LeadItem;

describe('LeadCard signal-card template', () => {
  it('uses the landing signal-card hierarchy without a duplicate score band', () => {
    const { container } = render(
      <LeadCard
        lead={baseLead}
        fitPreview={null}
        hiringMode="specialist"
      />,
    );
    const card = container.querySelector('[data-signal-card="true"]');
    expect(card).not.toBeNull();
    expect(screen.queryByText('Сигнал радара')).toBeNull();
    expect(screen.getByRole('meter', { name: 'Сила сигнала: 80 из 100' })).toBeTruthy();
    expect(screen.getByText('Компания и контакты')).toBeTruthy();
    expect(screen.getByText('Релевантные вакансии')).toBeTruthy();
    expect(screen.getByText('Сигналы')).toBeTruthy();
    expect(screen.queryByText('Почему сейчас')).toBeNull();
    expect(card?.textContent).not.toContain('01');
    expect(card?.textContent).not.toContain('02');
    expect(card?.textContent).not.toContain('03');
    expect(screen.getByRole('link', { name: /Открыть полную карточку компании/ })).toHaveAttribute('href', '/leads/lead-1');
    expect(card?.textContent).not.toContain('Горячий');
    expect(card?.textContent).toContain('A');
  });

  it('keeps workflow status separate from the score block', () => {
    const { container } = render(
      <LeadCard
        lead={baseLead}
        fitPreview={null}
        hiringMode="specialist"
      />,
    );
    const status = container.querySelector('[data-chip-group="status"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toMatch(/В работе/i);
  });

  it('keeps foreign and AI hints outside the workflow status group', () => {
    const foreignLead = { ...baseLead, isForeignEmployer: true } as unknown as LeadItem;
    const { container } = render(
      <LeadCard lead={foreignLead} fitPreview={null} hiringMode="specialist" />,
    );
    const status = container.querySelector('[data-chip-group="status"]');
    const foreignText = 'Иностранный работодатель';
    expect(status?.textContent ?? '').not.toContain(foreignText);
    expect(container.textContent).toContain(foreignText);
  });
});

describe('LeadsListLegend (T3.3 — a11y)', () => {
  it('is not aria-hidden blind — carries a visible + a11y label', () => {
    const { container } = render(<LeadsListLegend />);
    // The legend wrapper must not be aria-hidden (the old code marked it blind).
    const legendRoot = container.querySelector('[data-legend]');
    expect(legendRoot).not.toBeNull();
    expect(legendRoot?.getAttribute('aria-hidden')).not.toBe('true');
    // The three tone dots are labelled for AT.
    expect(screen.getByText(/высокий/i)).toBeTruthy();
    expect(screen.getByText(/средний/i)).toBeTruthy();
    expect(screen.getByText(/низкий/i)).toBeTruthy();
  });
});
