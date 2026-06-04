import { Suspense } from 'react';
import DashboardHeader from './dashboard-header';
import DashboardOverview from './dashboard-overview';
import DashboardSources from './dashboard-sources';
import DashboardAlerts from './dashboard-alerts';
import DashboardQuality from './dashboard-quality';
import {
  getDashboardOverviewMetrics,
  getDashboardQualityMetrics,
  getDashboardSourceHealth,
} from '@/lib/dashboard-data';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  // Fetch all dashboard data in parallel on the server
  const [overview, quality, sources] = await Promise.all([
    getDashboardOverviewMetrics(),
    getDashboardQualityMetrics(),
    getDashboardSourceHealth(),
  ]);

  return (
    <main style={{
      backgroundColor: '#f9fafb',
      minHeight: '100vh'
    }}>
      <div style={{
        maxWidth: '1280px',
        margin: '0 auto',
        padding: '32px 16px'
      }}>
        <Suspense fallback={<div>Загрузка...</div>}>
          <DashboardHeader />
          <div style={{ marginTop: '32px', display: 'flex', flexDirection: 'column', gap: '32px' }}>
            <DashboardQuality data={quality} />
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
      </div>
    </main>
  );
}