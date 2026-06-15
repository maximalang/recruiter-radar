import { Suspense } from 'react';
import DashboardOverview from './dashboard-overview';
import DashboardSources from './dashboard-sources';
import DashboardAlerts from './dashboard-alerts';
import DashboardQuality from './dashboard-quality';
import DashboardAnalytics from './dashboard-analytics';
import DashboardTodayRadar from './dashboard-today-radar';
import LiveClock from './live-clock';
import { InternalPageFrame, InternalPageHeader, type NavItem } from '../ui/internal-page';

const DASHBOARD_NAV: NavItem[] = [
  { href: '/dashboard', label: '📊 Дашборд', active: true },
  { href: '/leads', label: '🎯 Лиды' },
  { href: '/review', label: '🔍 Ревью' },
];

import {
  getDashboardOverviewMetrics,
  getDashboardQualityMetrics,
  getDashboardSourceHealth,
  getDashboardFeedbackFunnel,
  getDashboardLeadMetrics,
  getDashboardSourcePerformance,
  getDashboardTodayRadar,
} from '@/lib/dashboard-data';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  // Fetch all dashboard data in parallel on the server
  const [overview, quality, sources, feedbackFunnel, leadMetrics, sourcePerformance, todayRadar] = await Promise.all([
    getDashboardOverviewMetrics(),
    getDashboardQualityMetrics(),
    getDashboardSourceHealth(),
    getDashboardFeedbackFunnel(),
    getDashboardLeadMetrics(),
    getDashboardSourcePerformance(),
    getDashboardTodayRadar(),
  ]);

  return (
    <InternalPageFrame navItems={DASHBOARD_NAV}>
      <InternalPageHeader
        title="📊 Радар"
        subtitle="Компании, которым стоит написать сегодня, и состояние источников в реальном времени"
        nav={<LiveClock />}
      />
      <Suspense fallback={<div>Загрузка...</div>}>
        <div style={{ marginTop: '32px', display: 'flex', flexDirection: 'column', gap: '32px' }}>
          <DashboardTodayRadar topLeads={todayRadar.topLeads} pendingReview={todayRadar.pendingReview} />
          <DashboardQuality data={quality} />
          <DashboardAnalytics
            feedbackFunnel={feedbackFunnel}
            leadMetrics={leadMetrics}
            sourcePerformance={sourcePerformance}
          />
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
