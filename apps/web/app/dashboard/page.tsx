import { Suspense } from 'react';
import DashboardHeader from './dashboard-header';
import DashboardOverview from './dashboard-overview';
import DashboardSources from './dashboard-sources';
import DashboardAlerts from './dashboard-alerts';
import DashboardQuality from './dashboard-quality';

export default function DashboardPage() {
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
            <DashboardQuality />
            <DashboardOverview />
            <DashboardSources />
            <DashboardAlerts />
          </div>
        </Suspense>
      </div>
    </main>
  );
}