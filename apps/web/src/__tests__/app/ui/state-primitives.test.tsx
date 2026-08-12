/**
 * @jest-environment jsdom
 *
 * Phase 0 (T0.2) — verifies the repurposed EmptyState/NotFoundState SVG-icon
 * API and the new LoadingState primitive.
 *
 * Contract changes vs. the pre-Phase-0 API:
 *   - EmptyState.icon and NotFoundState.icon were `string` (dead — 0 callers
 *     passed it). They now accept an inline-SVG component
 *     `(p: SVGProps<SVGSVGElement>) => ReactElement`, so every empty state can
 *     carry a semantic glyph from the single icon vocabulary instead of a
 *     text/emoji placeholder.
 *   - LoadingState is new: `variant: 'skeleton' | 'inline'`. `inline` reuses
 *     the calm text loading line; `skeleton` renders an a11y-busy skeleton
 *     block so Suspense fallbacks stop flashing white.
 *
 * These primitives are consumed by Phases 1–5; this test locks the API they
 * will rely on.
 */
import { render, screen } from '@testing-library/react';
import type { ReactElement, SVGProps } from 'react';
import {
  EmptyState,
  NotFoundState,
  LoadingState,
  MetricCard,
  MetricGrid,
  GateBadgeInline,
} from '@/app/ui/internal-page';
import { SearchIcon, CheckIcon } from '@/app/ui/icons';

type IconCmp = (p: SVGProps<SVGSVGElement>) => ReactElement;

describe('EmptyState (T0.2 — SVG icon API)', () => {
  it('announces the state and keeps its next step discoverable', () => {
    render(
      <EmptyState
        title="Настройте профиль"
        text="Добавьте критерии поиска."
        action={{ href: '/profile', label: 'Перейти к профилю' }}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Настройте профиль');
    expect(screen.getByRole('link', { name: 'Перейти к профилю' })).toHaveAttribute(
      'href',
      '/profile',
    );
  });

  it('renders the SVG icon component when `icon` is provided', () => {
    const { container } = render(
      <EmptyState icon={SearchIcon as IconCmp} title="Ничего не найдено" />,
    );
    // The icon renders an <svg>; the title is visible text.
    expect(container.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('Ничего не найдено')).toBeTruthy();
  });

  it('renders no icon node when `icon` is omitted', () => {
    const { container } = render(<EmptyState title="Пусто" text="объяснение" />);
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText('Пусто')).toBeTruthy();
    expect(screen.getByText('объяснение')).toBeTruthy();
  });

  it('renders the action link when provided', () => {
    render(
      <EmptyState
        title="Пусто"
        action={{ href: '/profile', label: 'Настроить профиль' }}
      />,
    );
    const link = screen.getByText('Настроить профиль').closest('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/profile');
  });

  it('no longer accepts a string icon (type contract is SVG-component)', () => {
    // Compile-time contract: `icon` is a component, not a string. We assert
    // the runtime behaviour is to render it as an element, not as raw text.
    const { container } = render(
      <EmptyState icon={CheckIcon as IconCmp} title="Готово" />,
    );
    const svgEl = container.querySelector('svg');
    expect(svgEl).not.toBeNull();
    // The icon container should not echo a literal string glyph.
    expect(container.textContent).not.toMatch(/✓|○/);
  });
});

describe('MetricGrid', () => {
  it('exposes the metric strip as a list of related values', () => {
    render(
      <MetricGrid>
        <MetricCard label="Новые" value="3" />
        <MetricCard label="На проверке" value="2" tone="info" />
      </MetricGrid>,
    );

    expect(screen.getByRole('list')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('GateBadgeInline', () => {
  it('presents the evidence confirmation grade separately from score or automation', () => {
    render(<GateBadgeInline gate="A" />);

    expect(screen.getByText('Подтверждение A')).toHaveAccessibleName(
      'Уровень подтверждения доказательствами: A',
    );
    expect(screen.queryByText('Авто (A)')).toBeNull();
  });
});

describe('NotFoundState (T0.2 — SVG icon API)', () => {
  it('renders the SVG icon when provided, plus a back link', () => {
    const { container } = render(
      <NotFoundState
        icon={SearchIcon as IconCmp}
        title="Лид не найден"
        backHref="/leads"
        backLabel="Назад к списку"
      />,
    );
    // The empty-state icon well carries the provided icon.
    expect(container.querySelector('.emptyStateIcon svg')).not.toBeNull();
    const back = screen.getByText('Назад к списку').closest('a');
    expect(back?.getAttribute('href')).toBe('/leads');
  });

  it('renders without an icon when omitted (the back link still carries its BackIcon)', () => {
    const { container } = render(
      <NotFoundState title="Не найдено" backHref="/leads" backLabel="Назад" />,
    );
    // No empty-state icon well when `icon` is omitted.
    expect(container.querySelector('.emptyStateIcon')).toBeNull();
    // The back link carries its own BackIcon (T4.1) — that is expected, not the
    // empty-state icon.
    expect(container.querySelector('.emptyStateIcon svg')).toBeNull();
  });
});

describe('LoadingState (T0.2 — new primitive)', () => {
  it('variant="inline" renders a calm text loading line', () => {
    render(<LoadingState variant="inline" />);
    expect(screen.getByText(/загрузка/i)).toBeTruthy();
  });

  it('variant="skeleton" renders an aria-busy skeleton block (no white flash)', () => {
    const { container } = render(<LoadingState variant="skeleton" />);
    const skel = container.querySelector('[aria-busy="true"]');
    expect(skel).not.toBeNull();
    // A skeleton block carries at least one animated placeholder bar.
    expect(skel?.querySelector('[data-skeleton]')).not.toBeNull();
  });

  it('defaults to inline variant when variant is omitted', () => {
    render(<LoadingState />);
    expect(screen.getByText(/загрузка/i)).toBeTruthy();
  });
});
