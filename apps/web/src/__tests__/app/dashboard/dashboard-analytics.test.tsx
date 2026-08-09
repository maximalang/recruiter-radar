/**
 * @jest-environment jsdom
 *
 * Phase 5 — UX-hardening for the dashboard analytics surface.
 *
 * Covers T5.1–T5.4:
 *   - T5.1: responsive analytics tables carry a per-cell `data-label` so the
 *     CSS-only `tr→block / td→grid` mobile transform reads as a card list
 *     without losing the source/leads/score semantics (a11y intact).
 *   - T5.2: the feedback-funnel color/icon map contains ONLY DB-legal
 *     `digest_feedback_status` keys (contacted/replied/won/badfit/snooze/
 *     dismissed) plus a display-only legacy map for historical rows. The old
 *     "dead" keys (accepted/later/call/client) no longer appear as primary
 *     map entries — a correctness fix, not decoration.
 *   - T5.3: an `AnalyticsSkeleton` export exists and renders an `aria-busy`
 *     skeleton block (the analytics `<Suspense>` fallback stops flashing
 *     white); the today-radar empty-state carries a semantic SVG icon via the
 *     Phase-0 `EmptyState.icon` API.
 *   - T5.4: the dashboard `.metricCard` style is the one `DashboardOverview`
 *     already uses — i.e. analytics metric cards and the internal-page
 *     `MetricCard` share one visual language (verified via class name, no
 *     component merge).
 */
import { render, screen } from '@testing-library/react';
import DashboardAnalytics from '@/app/dashboard/dashboard-analytics';
import DashboardTodayRadar from '@/app/dashboard/dashboard-today-radar';

const funnel = [
  { status: 'contacted', count: 10, label: 'В работе' },
  { status: 'replied', count: 3, label: 'Ответили' },
  { status: 'won', count: 1, label: 'Клиент' },
  { status: 'badfit', count: 2, label: 'Не наш профиль' },
  { status: 'snooze', count: 4, label: 'Отложено' },
  { status: 'dismissed', count: 5, label: 'Мимо' },
];

const leadMetrics = { totalLeads: 100, todayLeads: 5, avgScore: 2.4 };

const sourcePerformance = [
  { source: 'career-pages', leads: 40, avgScore: 2.6 },
  { source: 'habr-career', leads: 12, avgScore: 2.1 },
];

const sourceEvidenceQuality = [
  {
    source: 'career-pages',
    leads: 40,
    gateA: 12,
    gateB: 20,
    gateC: 8,
    gateD: 0,
    directHiringProof: 32,
    platformAggregation: 8,
    enrichmentContext: 0,
    avgAgeDays: 4.5,
  },
];

describe('DashboardAnalytics — T5.1 responsive tables', () => {
  it('each source-performance cell carries a data-label for the mobile card-list transform', () => {
    const { container } = render(
      <DashboardAnalytics
        feedbackFunnel={funnel}
        leadMetrics={leadMetrics}
        sourcePerformance={sourcePerformance}
      />,
    );
    const rows = container.querySelectorAll('table tbody tr');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const firstRow = rows[0];
    const cells = firstRow.querySelectorAll('td');
    // Every cell has a data-label so on mobile (tr→block) the value is captioned.
    cells.forEach((cell) => {
      expect(cell.getAttribute('data-label')).toBeTruthy();
    });
  });

  it('evidence-quality cells carry data-labels too', () => {
    const { container } = render(
      <DashboardAnalytics
        feedbackFunnel={funnel}
        leadMetrics={leadMetrics}
        sourcePerformance={sourcePerformance}
        sourceEvidenceQuality={sourceEvidenceQuality}
      />,
    );
    // Two tables now; the second one is the evidence-quality table.
    const tables = container.querySelectorAll('table');
    expect(tables.length).toBe(2);
    const evidenceRows = tables[1].querySelectorAll('tbody tr');
    expect(evidenceRows.length).toBe(1);
    const cells = evidenceRows[0].querySelectorAll('td');
    cells.forEach((cell) => {
      expect(cell.getAttribute('data-label')).toBeTruthy();
    });
  });

  it('tables preserve thead/scope col semantics (a11y intact on desktop)', () => {
    const { container } = render(
      <DashboardAnalytics
        feedbackFunnel={funnel}
        leadMetrics={leadMetrics}
        sourcePerformance={sourcePerformance}
        sourceEvidenceQuality={sourceEvidenceQuality}
      />,
    );
    const headers = container.querySelectorAll('table thead th[scope="col"]');
    // source-perf has 3 columns, evidence-quality has 8 columns.
    expect(headers.length).toBe(3 + 8);
  });
});

describe('DashboardAnalytics — T5.2 funnel enum DB-legal keys', () => {
  // The map is module-internal; we assert behavior through rendering. A funnel
  // built from the current DB-legal statuses must render an icon + colored bar
  // for every item, with no "dead" key silently falling through.

  it('renders an svg icon for every current DB-legal feedback status', () => {
    const { container } = render(
      <DashboardAnalytics
        feedbackFunnel={funnel}
        leadMetrics={leadMetrics}
        sourcePerformance={[]}
      />,
    );
    // 6 funnel items → 6 svg icons in the funnel list.
    const icons = container.querySelectorAll('.funnelItemIcon');
    expect(icons.length).toBe(6);
  });

  it('does NOT carry the legacy "accepted/later/call/client" keys as primary funnel entries', () => {
    // Render a funnel that mixes a legacy status with a current one. The legacy
    // row should still render (display-tolerance), but the component must not
    // emit legacy keys into the DOM as data-status — i.e. the canonical map
    // is DB-legal; legacy is display-only fallback.
    const { container } = render(
      <DashboardAnalytics
        feedbackFunnel={[
          { status: 'contacted', count: 10, label: 'В работе' },
          { status: 'accepted', count: 2, label: 'Беру' },
        ]}
        leadMetrics={leadMetrics}
        sourcePerformance={[]}
      />,
    );
    // Both rows render (historical rows still get a label).
    const items = container.querySelectorAll('.funnelItem');
    expect(items.length).toBe(2);
    // Each renders an icon (no raw ❓/emoji fallback for the legacy row).
    const icons = container.querySelectorAll('.funnelItemIcon');
    expect(icons.length).toBe(2);
  });

  it('the funnel renders the DB-legal "won" status (not the legacy "client")', () => {
    // "client" was the legacy key for a closed deal; the current DB enum is
    // "won". The funnel must map "won" to an icon (HandshakeIcon), not treat
    // it as unknown.
    const { container } = render(
      <DashboardAnalytics
        feedbackFunnel={[{ status: 'won', count: 1, label: 'Клиент' }]}
        leadMetrics={leadMetrics}
        sourcePerformance={[]}
      />,
    );
    expect(container.querySelectorAll('.funnelItemIcon').length).toBe(1);
  });

  it('renders the canonical DB-legal status via data-status (won → success green)', () => {
    const { container } = render(
      <DashboardAnalytics
        feedbackFunnel={[{ status: 'won', count: 1, label: 'Клиент' }]}
        leadMetrics={leadMetrics}
        sourcePerformance={[]}
      />,
    );
    const item = container.querySelector('.funnelItem');
    expect(item?.getAttribute('data-status')).toBe('won');
    // The bar fill carries the won color (#10b981) — locks the map, not just
    // the icon presence.
    const fill = container.querySelector('.funnelBarFill') as HTMLElement | null;
    expect(fill?.style.backgroundColor).toBe('rgb(16, 185, 129)');
  });

  it('maps a legacy "accepted" row onto the canonical "contacted" color/icon', () => {
    const { container } = render(
      <DashboardAnalytics
        feedbackFunnel={[{ status: 'accepted', count: 2, label: 'Беру' }]}
        leadMetrics={leadMetrics}
        sourcePerformance={[]}
      />,
    );
    // data-status reflects the canonical key, not the raw legacy input.
    const item = container.querySelector('.funnelItem');
    expect(item?.getAttribute('data-status')).toBe('contacted');
    const fill = container.querySelector('.funnelBarFill') as HTMLElement | null;
    expect(fill?.style.backgroundColor).toBe('rgb(35, 128, 111)'); // evidence teal
  });
});

describe('DashboardAnalytics — T5.3 analytics skeleton export', () => {
  it('exports an AnalyticsSkeleton component that renders an aria-busy skeleton', async () => {
    const mod = await import('@/app/dashboard/dashboard-analytics');
    expect(typeof mod.AnalyticsSkeleton).toBe('function');
    const { container } = render(<mod.AnalyticsSkeleton />);
    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
    // A skeleton block carries at least one animated placeholder bar.
    expect(busy?.querySelector('[data-skeleton]')).not.toBeNull();
  });
});

describe('DashboardTodayRadar — T5.3 empty-state icon', () => {
  it('renders a semantic SVG icon in the empty state (no flat text-only block)', () => {
    const { container } = render(
      <DashboardTodayRadar topLeads={[]} pendingReview={0} />,
    );
    // The empty state must carry an inline-SVG glyph from the icon system,
    // not be text-only.
    const emptySvg = container.querySelector('svg');
    expect(emptySvg).not.toBeNull();
    // Honest copy is preserved.
    expect(screen.getByText(/пока нет компаний для контакта/i)).toBeTruthy();
  });

  it('preserves the "проверить настройки профиля" next-step link', () => {
    render(<DashboardTodayRadar topLeads={[]} pendingReview={0} />);
    const link = screen.getByText(/проверить настройки профиля/i).closest('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/profile');
  });
});

describe('DashboardAnalytics — T5.4 metric-card consistency', () => {
  it('analytics metric cards use the shared .metricCard style from dashboard.module.css', () => {
    // The analytics lead-metrics grid reuses .metricCard (the same class
    // DashboardOverview uses), so the two surfaces share one visual language
    // without merging components.
    const { container } = render(
      <DashboardAnalytics
        feedbackFunnel={funnel}
        leadMetrics={leadMetrics}
        sourcePerformance={[]}
      />,
    );
    const metricCards = container.querySelectorAll('.metricCard');
    // 3 metric cards: Всего лидов / Сегодня / Средний балл.
    expect(metricCards.length).toBe(3);
  });
});
