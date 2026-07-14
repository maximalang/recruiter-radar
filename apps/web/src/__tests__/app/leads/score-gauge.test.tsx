/**
 * @jest-environment jsdom
 *
 * Phase 4 (T4.3) — ScoreGauge on mobile keeps the band label visible and moves
 * the level label (Высокий/Средний/Низкий) into a sr-only-on-mobile wrapper so
 * the two readouts don't duplicate on a narrow screen. The level label stays
 * visible on desktop and is always announced to AT.
 */
import { render, screen } from '@testing-library/react';
import { ScoreGauge } from '@/app/ui/internal-page';

describe('ScoreGauge (T4.3 — level sr-only on mobile)', () => {
  it('renders the level label with the sr-only-on-mobile class', () => {
    const { container } = render(<ScoreGauge score={320} />);
    // The level label node carries the mobile-sr-only class so CSS hides it on
    // narrow viewports while keeping it in the a11y tree.
    const levelNode = container.querySelector('[data-score-level]');
    expect(levelNode).not.toBeNull();
    expect(levelNode?.classList.toString()).toMatch(/srOnlyMobile|sr-only-mobile/);
  });

  it('keeps the band/points visible (the one-glance read)', () => {
    const { container } = render(<ScoreGauge score={320} />);
    // The gauge circle shows the numeric 0–100 score points; the band chip is
    // elsewhere on the page. The gauge itself must still render the points
    // number (320 → 80).
    expect(container.textContent).toMatch(/80/);
  });
});
