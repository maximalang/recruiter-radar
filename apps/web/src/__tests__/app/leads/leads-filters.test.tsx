/**
 * @jest-environment jsdom
 *
 * Leads filter bar contract: active state stays visible and the live surface
 * reuses the shared Calm Intelligence FilterBar/SearchField primitives.
 */
import { render, screen } from '@testing-library/react';
import LeadsFilters from '@/app/leads/leads-filters';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams('gate=A'),
}));

afterEach(() => {
  mockPush.mockClear();
});

describe('LeadsFilters', () => {
  it('uses the shared filter and search primitives on the live workspace', () => {
    const { container } = render(<LeadsFilters profiles={[]} />);
    expect(container.querySelector('[data-ui="filter-bar"]')).not.toBeNull();
    expect(container.querySelector('[data-ui="search-field"]')).not.toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Поиск по текущему списку компаний' })).toBeInTheDocument();
  });

  it('marks the gate select data-active when a gate value is set', () => {
    const { container } = render(<LeadsFilters profiles={[]} />);
    const gateSelect = container.querySelector('[aria-label="Уровень подтверждения"]');
    expect(gateSelect).not.toBeNull();
    expect(gateSelect?.getAttribute('data-active')).toBe('true');
    expect(screen.getByRole('option', { name: 'Подтверждение A' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Авто (A)' })).toBeNull();
  });

  it('does NOT mark the feedback select data-active when feedback is empty', () => {
    const { container } = render(<LeadsFilters profiles={[]} />);
    const fbSelect = container.querySelector('[aria-label="Статус работы"]');
    expect(fbSelect).not.toBeNull();
    expect(fbSelect?.getAttribute('data-active')).toBeNull();
  });

  it('renders an XIcon SVG inside the reset button', () => {
    render(<LeadsFilters profiles={[]} />);
    const resetBtn = screen.getByRole('button', { name: /сбросить/i });
    expect(resetBtn.querySelector('svg')).not.toBeNull();
  });

  it('renders the today-toggle with a CheckIcon SVG', () => {
    render(<LeadsFilters profiles={[]} />);
    const todayBtn = screen.getByRole('button', { name: /сегодня в работе/i });
    expect(todayBtn.querySelector('svg')).not.toBeNull();
  });

  it('exposes navigation progress and semantic icon states', () => {
    const { container } = render(<LeadsFilters profiles={[]} />);
    const filterBar = container.querySelector('[aria-busy]');
    const todayBtn = screen.getByRole('button', { name: /сегодня в работе/i });
    const resetBtn = screen.getByRole('button', { name: /сбросить/i });

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
