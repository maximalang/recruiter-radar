'use client';

import styles from './dashboard.module.css';

interface FeedbackFunnelItem {
  status: string;
  count: number;
  label: string;
}

interface LeadMetrics {
  totalLeads: number;
  todayLeads: number;
  avgScore: number;
}

interface SourcePerformanceItem {
  source: string;
  leads: number;
  avgScore: number;
}

interface DashboardAnalyticsProps {
  feedbackFunnel: FeedbackFunnelItem[];
  leadMetrics: LeadMetrics;
  sourcePerformance: SourcePerformanceItem[];
}

const FUNNEL_COLORS: Record<string, string> = {
  accepted: '#10b981',
  dismissed: '#6b7280',
  later: '#f59e0b',
  contacted: '#3b82f6',
  replied: '#8b5cf6',
  call: '#ec4899',
  client: '#14b8a6',
  badfit: '#ef4444',
};

const FUNNEL_ICONS: Record<string, string> = {
  accepted: '✅',
  dismissed: '👋',
  later: '⏰',
  contacted: '✉️',
  replied: '💬',
  call: '📞',
  client: '🤝',
  badfit: '❌',
};

export default function DashboardAnalytics({
  feedbackFunnel,
  leadMetrics,
  sourcePerformance,
}: DashboardAnalyticsProps) {
  const totalFeedback = feedbackFunnel.reduce((sum, item) => sum + item.count, 0);
  const maxFunnelCount = Math.max(...feedbackFunnel.map((f) => f.count), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {/* Lead Metrics */}
      <section aria-labelledby="lead-metrics-heading">
        <h2 id="lead-metrics-heading" style={{ fontSize: '1.125rem', fontWeight: 600, color: '#111827', marginBottom: '16px' }}>
          📊 Метрики лидов
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
          <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '16px', border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 500 }}>Всего лидов</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', marginTop: '4px' }}>
              {leadMetrics.totalLeads}
            </div>
          </div>
          <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '16px', border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 500 }}>Сегодня</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#3b82f6', marginTop: '4px' }}>
              {leadMetrics.todayLeads}
            </div>
          </div>
          <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '16px', border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 500 }}>Средний скоринг</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f59e0b', marginTop: '4px' }}>
              {leadMetrics.avgScore.toFixed(1)}
            </div>
          </div>
        </div>
      </section>

      {/* Feedback Funnel */}
      <section aria-labelledby="feedback-funnel-heading">
        <h2 id="feedback-funnel-heading" style={{ fontSize: '1.125rem', fontWeight: 600, color: '#111827', marginBottom: '16px' }}>
          🔍 Воронка обратной связи
        </h2>
        {feedbackFunnel.length === 0 ? (
          <div style={{
            backgroundColor: '#fff', borderRadius: '8px', padding: '32px',
            border: '1px solid #e5e7eb', textAlign: 'center', color: '#6b7280',
          }}>
            Нет данных об обратной связи
          </div>
        ) : (
          <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '20px', border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '16px' }}>
              Всего ответов: {totalFeedback}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {feedbackFunnel.map((item) => {
                const pct = totalFeedback > 0 ? Math.round((item.count / totalFeedback) * 100) : 0;
                const barPct = Math.round((item.count / maxFunnelCount) * 100);
                const color = FUNNEL_COLORS[item.status] ?? '#6b7280';
                const icon = FUNNEL_ICONS[item.status] ?? '❓';
                return (
                  <div key={item.status}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 500, color: '#374151' }}>
                        {icon} {item.label}
                      </span>
                      <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                        {item.count} ({pct}%)
                      </span>
                    </div>
                    <div style={{
                      height: '8px', borderRadius: '4px',
                      backgroundColor: '#f3f4f6', overflow: 'hidden',
                    }}>
                      <div style={{
                        height: '100%', width: `${barPct}%`,
                        backgroundColor: color, borderRadius: '4px',
                        transition: 'width 0.2s',
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Source Performance */}
      <section aria-labelledby="source-perf-heading">
        <h2 id="source-perf-heading" style={{ fontSize: '1.125rem', fontWeight: 600, color: '#111827', marginBottom: '16px' }}>
          📡 Производительность источников
        </h2>
        {sourcePerformance.length === 0 ? (
          <div style={{
            backgroundColor: '#fff', borderRadius: '8px', padding: '32px',
            border: '1px solid #e5e7eb', textAlign: 'center', color: '#6b7280',
          }}>
            Нет данных по источникам
          </div>
        ) : (
          <div style={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ padding: '8px 16px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>
                    Источник
                  </th>
                  <th style={{ padding: '8px 16px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>
                    Лидов
                  </th>
                  <th style={{ padding: '8px 16px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>
                    Ср. скоринг
                  </th>
                </tr>
              </thead>
              <tbody>
                {sourcePerformance.map((src) => (
                  <tr key={src.source} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '10px 16px', fontSize: '0.85rem', fontWeight: 500, color: '#111827' }}>
                      {src.source}
                    </td>
                    <td style={{ padding: '10px 16px', fontSize: '0.85rem', color: '#374151' }}>
                      {src.leads}
                    </td>
                    <td style={{ padding: '10px 16px', fontSize: '0.85rem', color: '#374151' }}>
                      {src.avgScore.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
