/**
 * @jest-environment jsdom
 *
 * Phase 1 (T1.2 + T1.3) — verifies the onboarding-component contract changes
 * that the wizard page consumes.
 *
 * T1.2: InstructionCard gains an optional `step` prop and renders a circle-
 * numbered SVG/CSS badge instead of the inline "1. / 2. / 3." text prefixes
 * the page used to compose. Backward-compatible: without `step` it still
 * renders plain children (used by the unpaid-state path and any non-step
 * caller).
 *
 * T1.3: the onboarding preview card stops printing the raw "score 247.0" pill
 * (a second score vocabulary that drifts from /leads) and adopts the shared
 * score-display module: band label (Горячий/Тёплый/Холодный) + signal
 * strength. formatPreviewScore() turns a raw total_score into the shared
 * read so the preview and /leads speak one language.
 */
import { render, screen } from '@testing-library/react';
import {
  InstructionCard,
  formatPreviewScore,
} from '@/app/onboarding/pilot/[orderId]/pilot-onboarding-components';

describe('InstructionCard (T1.2 — step number badge)', () => {
  it('renders a numbered badge when `step` is provided', () => {
    render(<InstructionCard step={1}>Откройте бота</InstructionCard>);
    // The step number is visible as the badge text.
    expect(screen.getByText('1')).toBeTruthy();
    // The instruction body is still rendered.
    expect(screen.getByText('Откройте бота')).toBeTruthy();
  });

  it('renders plain children (no badge) when `step` is omitted — backward compat', () => {
    const { container } = render(
      <InstructionCard>Простая инструкция без номера</InstructionCard>,
    );
    expect(screen.getByText('Простая инструкция без номера')).toBeTruthy();
    // No numbered badge wrapper is added when step is absent.
    expect(container.querySelector('[data-step]')).toBeNull();
  });

  it('renders each step number 1..3 distinctly', () => {
    const { rerender } = render(<InstructionCard step={1}>a</InstructionCard>);
    expect(screen.getByText('1')).toBeTruthy();
    rerender(<InstructionCard step={2}>b</InstructionCard>);
    expect(screen.getByText('2')).toBeTruthy();
    rerender(<InstructionCard step={3}>c</InstructionCard>);
    expect(screen.getByText('3')).toBeTruthy();
  });
});

describe('formatPreviewScore (T1.3 — shared score vocabulary)', () => {
  it('returns the shared band label + signal strength, not the raw score', () => {
    // raw total_score ~247 → /100 = 2.47 → "Тёплый" (≥2, <3), strength "2.5"
    const out = formatPreviewScore(247);
    expect(out.bandLabel).toMatch(/Тёплый|Горячий|Холодный/);
    expect(out.strength).toMatch(/^\d\.\d$/);
    // The raw "247.0" must NOT be the surfaced value.
    expect(`${out.bandLabel} ${out.strength}`).not.toContain('247');
  });

  it('a direct-hiring raw score (~320) reads as hot', () => {
    const out = formatPreviewScore(320);
    expect(out.bandLabel).toBe('Горячий');
    expect(out.strength).toBe('3.2');
  });

  it('a weak raw score (~150) reads as cold', () => {
    const out = formatPreviewScore(150);
    expect(out.bandLabel).toBe('Холодный');
    expect(out.strength).toBe('1.5');
  });

  it('handles null/undefined raw score without throwing', () => {
    const out = formatPreviewScore(null);
    expect(out.bandLabel).toBe('Холодный');
    expect(out.strength).toBe('—');
  });
});
