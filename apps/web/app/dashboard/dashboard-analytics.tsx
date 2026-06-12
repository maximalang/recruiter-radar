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
    <div className={styles.analyticsSection}>
      {/* Lead Metrics */}
      <section aria-labelledby="lead-metrics-heading">
        <h2 id="lead-metrics-heading" className={styles.analyticsHeading}>
          📊 Метрики лидов
        </h2>
        <div className={styles.analyticsMetricsGrid}>
          <div className={styles.metricCard}>
            <div className={styles.cardLabel}>Всего лидов</div>
            <div className={styles.cardValue}>{leadMetrics.totalLeads}</div>
          </div>
          <div className={styles.metricCard}>
            <div className={styles.cardLabel}>Сегодня</div>
            <div className={`${styles.cardValue} ${styles.metricValueInfo}`}>{leadMetrics.todayLeads}</div>
          </div>
          <div className={styles.metricCard}>
            <div className={styles.cardLabel}>Средний скоринг</div>
            <div className={`${styles.cardValue} ${styles.metricValueWarning}`}>{leadMetrics.avgScore.toFixed(1)}</div>
          </div>
        </div>
      </section>

      {/* Feedback Funnel */}
      <section aria-labelledby="feedback-funnel-heading">
        <h2 id="feedback-funnel-heading" className={styles.analyticsHeading}>
          🔍 Воронка обратной связи
        </h2>
        {feedbackFunnel.length === 0 ? (
          <div className={styles.analyticsEmpty}>
            Нет данных об обратной связи
          </div>
        ) : (
          <div className={styles.funnelCard}>
            <div className={styles.funnelTotalLabel}>
              Всего ответов: {totalFeedback}
            </div>
            <div className={styles.funnelList}>
              {feedbackFunnel.map((item) => {
                const pct = totalFeedback > 0 ? Math.round((item.count / totalFeedback) * 100) : 0;
                const barPct = Math.round((item.count / maxFunnelCount) * 100);
                const color = FUNNEL_COLORS[item.status] ?? '#6b7280';
                const icon = FUNNEL_ICONS[item.status] ?? '❓';
                return (
                  <div key={item.status} className={styles.funnelItem}>
                    <div className={styles.funnelItemHeader}>
                      <span className={styles.funnelItemLabel}>
                        {icon} {item.label}
                      </span>
                      <span className={styles.funnelItemStats}>
                        {item.count} ({pct}%)
                      </span>
                    </div>
                    <div className={styles.funnelBarTrack}>
                      <div
                        className={styles.funnelBarFill}
                        style={{ width: `${barPct}%`, backgroundColor: color }}
                      />
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
        <h2 id="source-perf-heading" className={styles.analyticsHeading}>
          📡 Производительность источников
        </h2>
        {sourcePerformance.length === 0 ? (
          <div className={styles.analyticsEmpty}>
            Нет данных по источникам
          </div>
        ) : (
          <div className={styles.sourcePerfTable}>
            <table className={styles.sourcePerfTableInner}>
              <thead>
                <tr className={styles.gateItemBar /* reuse border-bottom style */}>
                  <th className={styles.gateItemLabel} scope="col">Источник</th>
                  <th className={styles.gateItemLabel} scope="col">Лидов</th>
                  <th className={styles.gateItemLabel} scope="col">Ср. скоринг</th>
                </tr>
              </thead>
              <tbody>
                {sourcePerformance.map((src) => (
                  <tr key={src.source} className={styles.sourceItem}>
                    <td className={`${styles.sourcePerfTd} ${styles.sourcePerfTdStrong}`}>
                      {src.source}
                    </td>
                    <td className={styles.sourcePerfTd}>
                      {src.leads}
                    </td>
                    <td className={styles.sourcePerfTd}>
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
