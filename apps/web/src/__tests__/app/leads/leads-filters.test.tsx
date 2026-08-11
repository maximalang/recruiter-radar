/**
 * @jest-environment jsdom
 *
 * Phase 3 (T3.1) — the leads filter bar must show active state visually on the
 * selects (not just via the subtitle "(фильтр активен)" text), the today-toggle
 * must read as a premium active pill with a CheckIcon, and the reset button
 * must carry an XIcon — so a recruiter sees the active filter at a glance on
 * mobile without reading text.
 */
import { render, screen } from '@testing-library/react';
import LeadsFilters from '@/app/leads/leads-filters';

// Mock next/navigation — LeadsFilters is a client component using useRouter +
// useSearchParams. We stub useSearchParams to control the active filter state.
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams('gate=A'),
}));

afterEach(() => {
  mockPush.mockClear();
});

describe('LeadsFilters (T3.1 — active filter state)', () => {
  it('marks the gate select data-active when a gate value is set', () => {
    const { container } = render(<LeadsFilters profiles={[]} />);
    const gateSelect = container.querySelector('[aria-label="Фильтр по уровню доверия"]');
    expect(gateSelect).not.toBeNull();
    expect(gateSelect?.getAttribute('data-active')).toBe('true');
  });

  it('does NOT mark the feedback select data-active when feedback is empty', () => {
    const { container } = render(<LeadsFilters profiles={[]} />);
    const fbSelect = container.querySelector('[aria-label="Фильтр по обратной связи"]');
    expect(fbSelect).not.toBeNull();
    expect(fbSelect?.getAttribute('data-active')).toBeNull();
  });

  it('renders an XIcon SVG inside the reset button (only when a filter is active)', () => {
    // gate=A is active via the mock → reset button is rendered with an XIcon.
    const { container } = render(<LeadsFilters profiles={[]} />);
    const resetBtn = screen.getByRole('button', { name: /сбросить фильтры/i });
    expect(resetBtn.querySelector('svg')).not.toBeNull();
  });

  it('renders the today-toggle with a CheckIcon SVG', () => {
    const { container } = render(<LeadsFilters profiles={[]} />);
    const todayBtn = screen.getByRole('button', { name: /сегодня в работе/i });
    expect(todayBtn.querySelector('svg')).not.toBeNull();
  });

  it('exposes navigation progress and semantic icon states', () => {
    const { container } = render(<LeadsFilters profiles={[]} />);
    const filterBar = container.querySelector('[aria-busy]');
    const todayBtn = screen.getByRole('button', { name: /сегодня в работе/i });
    const resetBtn = screen.getByRole('button', { name: /сбросить фильтры/i });

    expect(filterBar).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(todayBtn).toHaveAttribute('data-motion-interactive');
    expect(todayBtn.querySelector('[data-motion-icon="filter"]')).toHaveAttribute(
      'data-motion-state',
      'idle',
    );
    expect(resetBtn.querySelector('[data-motion-icon="reset"]')).not.toBeNull();
  });
});
