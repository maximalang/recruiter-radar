import { Suspense } from 'react';
import DashboardOverview from './dashboard-overview';
import DashboardSources from './dashboard-sources';
import DashboardAlerts from './dashboard-alerts';
import DashboardQuality from './dashboard-quality';
import DashboardAnalytics from './dashboard-analytics';
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
} from '@/lib/dashboard-data';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  // Fetch all dashboard data in parallel on the server
  const [overview, quality, sources, feedbackFunnel, leadMetrics, sourcePerformance] = await Promise.all([
    getDashboardOverviewMetrics(),
    getDashboardQualityMetrics(),
    getDashboardSourceHealth(),
    getDashboardFeedbackFunnel(),
    getDashboardLeadMetrics(),
    getDashboardSourcePerformance(),
  ]);

  return (
    <InternalPageFrame navItems={DASHBOARD_NAV}>
      <InternalPageHeader
        title="📊 Радар источников"
        subtitle="Мониторинг производительности и состояние источников в реальном времени"
        nav={<LiveClock />}
      />
      <Suspense fallback={<div>Загрузка...</div>}>
        <div style={{ marginTop: '32px', display: 'flex', flexDirection: 'column', gap: '32px' }}>
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
