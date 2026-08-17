/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { LeadRow } from '@/app/leads/leads-page-content';
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

describe('LeadRow V1-V6 decision-row contract', () => {
  it('renders rank → company → why now → proof → score → confidence without the retired score legend', () => {
    const { container } = render(
      <LeadRow lead={baseLead} fitPreview={null} hiringMode="specialist" rank={1} />,
    );

    const row = container.querySelector('[data-lead-row="true"]');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('01');
    expect(screen.getByRole('link', { name: 'Ромашка' })).toHaveAttribute('href', '/leads/lead-1');
    expect(screen.getByText('Hiring burst across 3 roles')).toBeInTheDocument();
    expect(row?.textContent).toContain('4 вакансии');
    expect(row?.textContent).toContain('1 источник');
    expect(container.querySelector('[aria-label="Сила сигнала 80"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Уверенность: высокая"]')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Открыть анализ компании Ромашка' })).toHaveAttribute('href', '/leads/lead-1');

    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.queryByText('Компания и контакты')).toBeNull();
    expect(screen.queryByText('Релевантные вакансии')).toBeNull();
    expect(screen.queryByText('Сигналы')).toBeNull();
    expect(container.querySelector('[data-legend]')).toBeNull();
  });

  it('keeps primary proof scan-friendly without a per-row evidence accordion', () => {
    const { container } = render(
      <LeadRow
        lead={{ ...baseLead, reasons: ['Карьерная страница обновлена'] } as unknown as LeadItem}
        fitPreview={{ icon: 'industry', text: 'Совпадает отрасль' }}
        hiringMode="specialist"
        rank={2}
      />,
    );

    expect(screen.getByText('Hiring burst across 3 roles')).toBeInTheDocument();
    expect(container.textContent).toContain('4 вакансии · 2 подтвержд.');
    expect(container.textContent).toContain('1 источник');
    expect(container.textContent).toContain('Совпадает отрасль');
    expect(container.querySelector('details')).toBeNull();
    expect(container.querySelector('[data-legend]')).toBeNull();
  });

  it('keeps workflow status subordinate to the decision hierarchy', () => {
    const { container } = render(
      <LeadRow lead={baseLead} fitPreview={null} hiringMode="specialist" rank={3} />,
    );
    expect(container.textContent).toMatch(/В работе/i);
    expect(container.querySelector('[aria-label="Сила сигнала 80"]')).not.toBeNull();
  });

  it('renders foreign-employer and AI context as quiet metadata rather than score semantics', () => {
    const foreignLead = { ...baseLead, isForeignEmployer: true } as unknown as LeadItem;
    const { container } = render(
      <LeadRow lead={foreignLead} fitPreview={null} hiringMode="specialist" rank={4} />,
    );
    expect(container.textContent).toContain('иностранный работодатель');
    expect(container.textContent).toContain('ИИ-подсказка доступна');
    expect(container.querySelector('[aria-label="Сила сигнала 80"]')).not.toBeNull();
  });
});
