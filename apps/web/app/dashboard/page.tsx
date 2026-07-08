import { Suspense } from 'react';
import DashboardOverview from './dashboard-overview';
import DashboardSources from './dashboard-sources';
import DashboardAlerts from './dashboard-alerts';
import DashboardQuality from './dashboard-quality';
import DashboardAnalytics, { AnalyticsSkeleton } from './dashboard-analytics';
import DashboardTodayRadar from './dashboard-today-radar';
import LiveClock from './live-clock';
import { InternalPageFrame, InternalPageHeader, type NavItem } from '../ui/internal-page';
import dashStyles from './dashboard.module.css';

const DASHBOARD_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Дашборд', active: true },
  { href: '/leads', label: 'Лиды' },
  { href: '/review', label: 'Ревью' },
  { href: '/settings/profile', label: 'Профиль' },
];

import {
  getDashboardOverviewMetrics,
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

export default async function DashboardPage() {
  // "Сегодняшний радар" is tenant data → owner-scope it. Without a session it
  // stays empty; the rest of the dashboard is global source/quality telemetry.
  const ownerId = await getOwnerIdFromSession();

  // Fetch all dashboard data in parallel on the server
  const [
    overview,
    quality,
    sources,
    feedbackFunnel,
    leadMetrics,
    sourcePerformance,
    sourceEvidenceQuality,
    todayRadar,
  ] = await Promise.all([
    getDashboardOverviewMetrics(),
    getDashboardQualityMetrics(),
    getDashboardSourceHealth(),
    getDashboardFeedbackFunnel(),
    getDashboardLeadMetrics(),
    getDashboardSourcePerformance(),
    getDashboardSourceEvidenceQuality(),
    ownerId
      ? getDashboardTodayRadar(ownerId)
      : Promise.resolve<TodayRadar>({ topLeads: [], pendingReview: 0, hiringModeByProfileId: {} }),
  ]);

  return (
    <InternalPageFrame navItems={DASHBOARD_NAV}>
      <InternalPageHeader
        title="Радар"
        subtitle="Компании, которым стоит написать сегодня, и состояние источников в реальном времени"
        nav={<LiveClock />}
      />
      <Suspense fallback={<AnalyticsSkeleton />}>
        <div className={dashStyles.dashboardStack}>
          {/* Agency value zone — what to act on today */}
          <DashboardTodayRadar
            topLeads={todayRadar.topLeads}
            pendingReview={todayRadar.pendingReview}
            hiringModeByProfileId={todayRadar.hiringModeByProfileId}
          />
          <DashboardQuality data={quality} />
          <DashboardAnalytics
            feedbackFunnel={feedbackFunnel}
            leadMetrics={leadMetrics}
            sourcePerformance={sourcePerformance}
            sourceEvidenceQuality={sourceEvidenceQuality}
          />

          {/* System zone — operational telemetry, secondary to the value above */}
          <div className={`${dashStyles.zoneLabel} ${dashStyles.zoneLabelSystem}`}>
            Система и источники
          </div>
          <DashboardOverview
            totalSources={overview.totalSources}
            activeSources={overview.activeSources}
            overallHealth={overview.overallHealth}
            totalAlerts={overview.totalAlerts}
          />
          <DashboardSources sources={sources} />
          <DashboardAlerts />
        </div>
      </Suspense>
    </InternalPageFrame>
  );
}
