/**
 * @jest-environment jsdom
 *
 * Phase 2 (T2.1) — the profile-completion checklist must use the unified SVG
 * icon system, not the literal "✓" / "○" character glyphs it rendered before.
 *
 * Contract:
 *   - A filled group renders an inline-SVG CheckIcon (brand tone via CSS).
 *   - An unfilled group renders an inline-SVG CircleIcon (muted via CSS).
 *   - No literal "✓" or "○" text node appears in the checklist.
 *   - The progress bar + count + match-count preview are unchanged.
 */
import { render, screen } from '@testing-library/react';
import ProfileCompletionPanel from '@/app/profile/profile-completion-panel';
import type { ProfileCompletion } from '@/lib/profileCompletion';

function completion(overrides: Partial<ProfileCompletion> = {}): ProfileCompletion {
  return {
    groups: [
      { key: 'roles', label: 'Роли, которые вы закрываете', filled: true },
      { key: 'industries', label: 'Отрасли клиентов', filled: true },
      { key: 'region', label: 'Регион', filled: false },
      { key: 'keywords', label: 'Ключевые фразы', filled: false },
    ],
    filledCount: 2,
    totalCount: 4,
    ratio: 0.5,
    isComplete: false,
    ...overrides,
  };
}

describe('ProfileCompletionPanel (T2.1 — SVG checklist)', () => {
  it('renders an SVG icon for every checklist item (filled and unfilled)', () => {
    const { container } = render(
      <ProfileCompletionPanel completion={completion()} matchCount={null} />,
    );
    // 4 groups → 4 svg icons in the checklist.
    const checks = container.querySelectorAll('ul li svg');
    expect(checks.length).toBe(4);
  });

  it('does NOT render the literal ✓ / ○ character glyphs', () => {
    const { container } = render(
      <ProfileCompletionPanel completion={completion()} matchCount={null} />,
    );
    const list = container.querySelector('ul');
    expect(list?.textContent).not.toMatch(/✓|○/);
  });

  it('marks filled vs unfilled items with data-filled (tone contract preserved)', () => {
    const { container } = render(
      <ProfileCompletionPanel completion={completion()} matchCount={null} />,
    );
    const items = container.querySelectorAll('ul li');
    expect(items.length).toBe(4);
    expect(items[0].getAttribute('data-filled')).toBe('true'); // roles filled
    expect(items[2].getAttribute('data-filled')).toBeNull(); // region unfilled
  });

  it('renders the match-count preview when matchCount is provided', () => {
    render(
      <ProfileCompletionPanel
        completion={completion()}
        matchCount={{ count: 12, capped: false }}
      />,
    );
    expect(screen.getByText(/≈12/)).toBeTruthy();
    expect(screen.getByText(/компаний/)).toBeTruthy();
  });

  it('renders the honest empty preview when matchCount is 0', () => {
    render(
      <ProfileCompletionPanel
        completion={completion()}
        matchCount={{ count: 0, capped: false }}
      />,
    );
    expect(screen.getByText(/слишком узкие|ни одной/i)).toBeTruthy();
  });
});
