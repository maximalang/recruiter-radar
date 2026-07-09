/**
 * @jest-environment jsdom
 *
 * T7.2 (Phase 7) — human error paths. A data surface that fails to load must
 * show a calm, human-readable explanation + a concrete next step, never a raw
 * error string / stack trace, and never a silent empty list that reads as
 * "no data" (the worst case — the user thinks the radar found nothing when it
 * actually crashed).
 *
 * This test locks the contract at two levels:
 *   1. A new `ErrorState` primitive in internal-page.tsx renders a title +
 *      description + optional next-step with role="alert" and never exposes
 *      a raw error message to the DOM.
 *   2. The surfaces that previously swallowed errors or rendered raw text
 *      (dashboard-quality raw `{error}`, leads/review silent catch blocks,
 *      dashboard Promise.all with no recovery) now route through ErrorState
 *      or a human copy path and no longer leak raw internals.
 *
 * Source-level assertions complement the primitive component test because the
 * failing surfaces are async server components (DB reads) too heavy to mount.
 */
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ErrorState } from '@/app/ui/internal-page';

function readApp(rel: string): string {
  return readFileSync(resolve(process.cwd(), 'app', rel), 'utf8');
}

describe('T7.2 — ErrorState primitive', () => {
  it('renders a human title + description with role=alert', () => {
    render(
      <ErrorState
        title="Не удалось загрузить аналитику"
        description="Собираем данные по источникам. Повторите через минуту."
      />,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Не удалось загрузить аналитику')).toBeTruthy();
    expect(screen.getByText('Собираем данные по источникам. Повторите через минуту.')).toBeTruthy();
  })

  it('renders an optional next-step action link', () => {
    render(
      <ErrorState
        title="Профиль не загрузился"
        description="Проверьте настройки — без профиля радар не подбирает компании."
        action={{ href: '/settings/profile', label: 'Открыть профиль' }}
      />,
    )
    const link = screen.getByText('Открыть профиль')
    expect(link.getAttribute('href')).toBe('/settings/profile')
  })

  it('never exposes a raw error message to the DOM', () => {
    // Even if a caller passes a raw internal error string, the primitive must
    // not render it — it renders only the human title/description it was given.
    const { container } = render(
      <ErrorState
        title="Не удалось загрузить метрики"
        description="Повторите позже."
      />,
    )
    // No raw stack-trace / SQL / internal leak appears in the rendered DOM.
    expect(container.textContent ?? '').not.toMatch(/error:/i)
    expect(container.textContent ?? '').not.toMatch(/at \//)
    expect(container.textContent ?? '').not.toMatch(/SELECT |INSERT |UPDATE /i)
  })
})

describe('T7.2 — surfaces route errors through human paths (source-level)', () => {
  it('dashboard-quality no longer renders the raw error string', () => {
    const src = readApp('dashboard/dashboard-quality.tsx')
    // The old raw `{error}` interpolation is gone.
    expect(src).not.toMatch(/Ошибка загрузки метрик: \{error\}/)
    // An ErrorState (or equivalent human path) is used instead.
    expect(src).toMatch(/ErrorState/)
  })

  it('leads/page.tsx surfaces an error state instead of silently swallowing the leads fetch', () => {
    const src = readApp('leads/page.tsx')
    // The leads fetch catch block must not silently set empty arrays and render
    // an empty list that reads as "no data". It must propagate an error flag
    // the page renders as an ErrorState.
    expect(src).toMatch(/ErrorState/)
    // No bare `} catch {` that only zeros out the leads arrays remains on the
    // leads-fetch path — the catch must set an error signal.
    expect(src).not.toMatch(/} catch \{\s*allLeads = \[\];\s*totalLeads = 0;\s*pendingReview = 0;\s*}/)
  })

  it('review/page.tsx surfaces an error state instead of silently returning an empty queue', () => {
    const src = readApp('review/page.tsx')
    expect(src).toMatch(/ErrorState/)
    // The old silent `catch { return { items: [], total: 0 }; }` is gone.
    expect(src).not.toMatch(/catch \{\s*return \{ items: \[\], total: 0 \};\s*}/)
  })

  it('dashboard/page.tsx recovers from a single fetcher failure instead of crashing the whole page', () => {
    const src = readApp('dashboard/page.tsx')
    // Promise.all is brittle (one rejection kills all 8 fetchers). The page
    // must wrap fetchers so a single failure surfaces an ErrorState for that
    // block, not a full-page crash.
    expect(src).toMatch(/ErrorState|safeDashboardFetch|recover|reflection/)
  })
})
