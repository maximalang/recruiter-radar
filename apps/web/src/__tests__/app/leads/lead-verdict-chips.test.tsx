/**
 * @jest-environment jsdom
 *
 * Phase 4 (T4.2) — the lead-detail verdict chips are grouped into "decision"
 * (band + gate + urgency) and "meta" (foreign + review + freshness) clusters,
 * instead of one flat row, so the verdict reads separate from metadata.
 */
import { render } from '@testing-library/react';
import { LeadVerdictChips } from '@/app/ui/internal-page';

describe('LeadVerdictChips (T4.2 — decision / meta grouping)', () => {
  const base = {
    score: 320,
    confidenceGate: 'A',
    isForeignEmployer: false,
    reviewStatus: 'auto_approved',
    urgencyLevel: 'burst',
    urgencyLabel: 'Сильный всплеск найма',
    latestPublishedAt: '2026-07-01T00:00:00Z',
  };

  it('renders a decision chip group (band + gate + urgency)', () => {
    const { container } = render(<LeadVerdictChips {...base} />);
    const decision = container.querySelector('[data-chip-group="decision"]');
    expect(decision).not.toBeNull();
    expect(decision?.textContent).toContain('Горячий'); // scoreBand
    expect(decision?.textContent).toContain('A'); // gate
    expect(decision?.textContent).toContain('Сильный всплеск найма'); // urgency
  });

  it('renders a meta chip group (foreign + review + freshness), separate from decision', () => {
    const { container } = render(
      <LeadVerdictChips {...base} isForeignEmployer reviewStatus="pending_review" />,
    );
    const decision = container.querySelector('[data-chip-group="decision"]');
    const meta = container.querySelector('[data-chip-group="meta"]');
    expect(meta).not.toBeNull();
    expect(decision).not.toBe(meta);
    // Foreign + review live in meta, not decision.
    expect(meta?.textContent).toContain('Иностранный работодатель');
    expect(meta?.textContent).toContain('На проверке');
    expect(decision?.textContent).not.toContain('Иностранный работодатель');
  });

  it('renders nothing for the meta group when all meta signals are absent', () => {
    // No foreign, auto_approved (no review badge), no freshness date.
    const { container } = render(
      <LeadVerdictChips
        score={320}
        confidenceGate="A"
        isForeignEmployer={false}
        reviewStatus="auto_approved"
        urgencyLevel="burst"
        urgencyLabel="Сильный всплеск найма"
        latestPublishedAt={null}
      />,
    );
    const meta = container.querySelector('[data-chip-group="meta"]');
    // No meta chips would render → the meta group is omitted entirely.
    expect(meta).toBeNull();
  });
});
