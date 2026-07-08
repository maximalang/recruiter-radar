/**
 * @jest-environment jsdom
 *
 * Phase 3 (T3.2 + T3.3) — the lead-card head chips are grouped into two
 * visual clusters — "decision" (band + gate) and "status" (review + feedback)
 * — instead of one flat row, so a recruiter's eye separates the verdict from
 * the workflow state. Foreign + AI-hint chips stay as muted separate chips.
 *
 * Also covers T3.3's legend a11y contract: the leads-list legend must not be
 * a blind aria-hidden decoration — it carries an a11y label tying the dots to
 * the rail tones.
 */
import { render, screen } from '@testing-library/react';
import { LeadCard, LeadsListLegend } from '@/app/leads/page';
import type { LeadItem } from '@/lib/leads-data';
import type { ClientProfile } from '@/lib/clientProfiles';

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

describe('LeadCard (T3.2 — chip grouping)', () => {
  it('renders a decision chip group (band + gate)', () => {
    const { container } = render(
      <LeadCard
        lead={baseLead}
        fitPreview={null}
        hiringMode="specialist"
      />,
    );
    const decision = container.querySelector('[data-chip-group="decision"]');
    expect(decision).not.toBeNull();
    // The decision group contains the score band + gate badge.
    expect(decision?.textContent).toContain('Горячий'); // scoreBand label
    expect(decision?.textContent).toContain('A'); // gate
  });

  it('renders a status chip group (review + feedback) separate from decision', () => {
    const { container } = render(
      <LeadCard
        lead={baseLead}
        fitPreview={null}
        hiringMode="specialist"
      />,
    );
    const decision = container.querySelector('[data-chip-group="decision"]');
    const status = container.querySelector('[data-chip-group="status"]');
    expect(status).not.toBeNull();
    expect(decision).not.toBeNull();
    // The two groups are distinct elements.
    expect(decision).not.toBe(status);
  });

  it('keeps foreign + AI-hint chips outside the decision/status groups (muted)', () => {
    const foreignLead = { ...baseLead, isForeignEmployer: true } as unknown as LeadItem;
    const { container } = render(
      <LeadCard lead={foreignLead} fitPreview={null} hiringMode="specialist" />,
    );
    const decision = container.querySelector('[data-chip-group="decision"]');
    const status = container.querySelector('[data-chip-group="status"]');
    // Foreign badge text is NOT inside the decision or status groups.
    const foreignText = 'Иностранный работодатель';
    expect(decision?.textContent ?? '').not.toContain(foreignText);
    expect(status?.textContent ?? '').not.toContain(foreignText);
    // But it is present somewhere in the card.
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
