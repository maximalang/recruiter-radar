import { Suspense } from 'react';
import type { Metadata } from 'next';
import DashboardDailySummary from './dashboard-daily-summary';
import DashboardSources from './dashboard-sources';
import DashboardAlerts from './dashboard-alerts';
import DashboardQuality from './dashboard-quality';
import DashboardAnalytics, { AnalyticsSkeleton } from './dashboard-analytics';
import DashboardTodayRadar from './dashboard-today-radar';
import LiveClock from './live-clock';
import { InternalPageFrame, InternalPageHeader, ErrorState, type NavItem } from '../ui/internal-page';
import { SiteFooter } from '../ui/site-footer';
import dashStyles from './dashboard.module.css';

export const metadata: Metadata = {
  title: 'Дашборд — Recruiter Radar',
  description: 'Сегодняшний радар, источники и качество доказательств.',
};

const DASHBOARD_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Дашборд', active: true },
  { href: '/leads', label: 'Лиды' },
  { href: '/review', label: 'Ревью' },
  { href: '/profile', label: 'Профиль' },
];

import {
  getDashboardQualityMetrics,
  getDashboardSourceHealth,
  getDashboardFeedbackFunnel,
  getDashboardLeadMetrics,
  getDashboardSourcePerformance,
  getDashboardSourceEvidenceQuality,
  getDashboardTodayRadar,
  type TodayRadar,
} from '@/lib/dashboard-data';
import { getOwnerIdFromSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Run a dashboard fetcher with per-block recovery. A single fetcher rejection
 * no longer crashes the whole dashboard (Promise.all is all-or-nothing); the
 * failed block returns null and renders an ErrorState inline, while the rest
 * of the page stays healthy. The raw error is logged server-side and NEVER
 * reaches the DOM — the caller shows only the human ErrorState copy.
 */
async function safeDashboardFetch<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.error('[dashboard] fetcher failed', err instanceof Error ? err.message : String(err));
    return null;
  }
}

export default async function DashboardPage() {
  // "Сегодняшний радар" is tenant data → owner-scope it. Without a session it
  // stays empty; the rest of the dashboard is global source/quality telemetry.
  const ownerId = await getOwnerIdFromSession();

  // Fetch all dashboard data in parallel on the server, each wrapped in
  // safeDashboardFetch so a single rejection surfaces an ErrorState for that
  // block instead of crashing the entire page.
  const [
    quality,
    sources,
    feedbackFunnel,
    leadMetrics,
    sourcePerformance,
    sourceEvidenceQuality,
    todayRadar,
  ] = await Promise.all([
    safeDashboardFetch(() => getDashboardQualityMetrics()),
    safeDashboardFetch(() => getDashboardSourceHealth()),
    safeDashboardFetch(() => getDashboardFeedbackFunnel()),
    safeDashboardFetch(() => getDashboardLeadMetrics()),
    safeDashboardFetch(() => getDashboardSourcePerformance()),
    safeDashboardFetch(() => getDashboardSourceEvidenceQuality()),
    ownerId
      ? safeDashboardFetch(() => getDashboardTodayRadar(ownerId))
      : Promise.resolve<TodayRadar | null>({ topLeads: [], pendingReview: 0, hiringModeByProfileId: {} }),
  ]);

  return (
    <InternalPageFrame navItems={DASHBOARD_NAV} footer={<SiteFooter />}>
      <InternalPageHeader
        title="Радар"
        subtitle="Компании, которым стоит написать сегодня, и состояние источников в реальном времени"
        nav={<LiveClock />}
      />
      <Suspense fallback={<AnalyticsSkeleton />}>
        <div className={dashStyles.dashboardStack}>
          {/* Agency value zone — what to act on today */}
          <DashboardDailySummary
            todayLeads={leadMetrics?.todayLeads}
            totalLeads={leadMetrics?.totalLeads}
            gateA={quality?.gateDistribution.find(g => g.gate === 'A')?.count}
            gateB={quality?.gateDistribution.find(g => g.gate === 'B')?.count}
            gateC={quality?.gateDistribution.find(g => g.gate === 'C')?.count}
            pendingReview={todayRadar?.pendingReview}
          />
          {todayRadar ? (
            <DashboardTodayRadar
              topLeads={todayRadar.topLeads}
              pendingReview={todayRadar.pendingReview}
              hiringModeByProfileId={todayRadar.hiringModeByProfileId}
            />
          ) : (
            <ErrorState
              title="Сегодняшний радар не загрузился"
              description="Подбираем компании по вашему профилю. Повторите через минуту — если радар не появится, проверьте настройки профиля."
              action={{ href: '/profile', label: 'Проверить профиль' }}
            />
          )}
          <DashboardQuality data={quality ?? undefined} error={quality === null ? 'Метрики качества не загрузились' : undefined} />
          {feedbackFunnel && leadMetrics && sourcePerformance && sourceEvidenceQuality ? (
            <DashboardAnalytics
              feedbackFunnel={feedbackFunnel}
              leadMetrics={leadMetrics}
              sourcePerformance={sourcePerformance}
              sourceEvidenceQuality={sourceEvidenceQuality}
            />
          ) : (
            <ErrorState
              title="Аналитика не загрузилась"
              description="Собираем данные по источникам и gate-распределению. Повторите через минуту — если не загрузится, напишите поддержку."
            />
          )}

          {/* System zone — operational telemetry, secondary to the value above */}
          <div className={`${dashStyles.zoneLabel} ${dashStyles.zoneLabelSystem}`}>
            Источники
          </div>
          {sources ? <DashboardSources sources={sources} /> : (
            <ErrorState
              title="Источники не загрузились"
              description="Состояние источников обновляется непрерывно. Повторите позже."
            />
          )}
          <DashboardAlerts />
        </div>
      </Suspense>
    </InternalPageFrame>
  );
}
