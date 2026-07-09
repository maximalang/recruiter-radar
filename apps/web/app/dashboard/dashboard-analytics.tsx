'use client';

import type { ReactElement, SVGProps } from 'react';
import styles from './dashboard.module.css';
import {
  WaveIcon,
  ClockIcon,
  MailIcon,
  ChatIcon,
  HandshakeIcon,
  XIcon,
  HelpIcon,
} from '../ui/icons';

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

interface SourceEvidenceQualityItem {
  source: string;
  leads: number;
  gateA: number;
  gateB: number;
  gateC: number;
  gateD: number;
  directHiringProof: number;
  platformAggregation: number;
  enrichmentContext: number;
  avgAgeDays: number | null;
}

interface DashboardAnalyticsProps {
  feedbackFunnel: FeedbackFunnelItem[];
  leadMetrics: LeadMetrics;
  sourcePerformance: SourcePerformanceItem[];
  sourceEvidenceQuality?: SourceEvidenceQualityItem[];
}

const SOURCE_LABEL_RU: Record<string, string> = {
  'career-pages': 'Career pages',
  'habr-career': 'Habr Career',
  'rabota-rossii': 'Работа России',
  superjob: 'SuperJob',
  hh: 'HeadHunter',
  'tech-job-boards': 'Tech boards',
  'linkedin-company-pages': 'LinkedIn',
  'regional-job-boards': 'Региональные',
};

function sourceLabel(source: string): string {
  return SOURCE_LABEL_RU[source] ?? source;
}

function formatAgeDays(avgAgeDays: number | null): string {
  if (avgAgeDays === null || Number.isNaN(avgAgeDays)) return '—';
  if (avgAgeDays < 1) return 'свежие';
  const rounded = Math.round(avgAgeDays * 10) / 10;
  return `${rounded} дн`;
}

/**
 * Feedback-funnel color + icon map.
 *
 * Primary keys mirror the current `digest_feedback_status` DB enum
 * (none/contacted/replied/won/badfit/snooze/dismissed) — the in-app writer
 * emits only this set (memory `project_feedback_enum_drift`). `none` is
 * excluded from the funnel by the SQL query, so it has no entry here.
 *
 * `FUNNEL_LEGACY_DISPLAY` is a display-only tolerance map for historical rows
 * whose status predates the enum (accepted/later/call/client). No writer emits
 * these today; the map only keeps an old row from rendering as a raw status
 * string with the wrong color. Mirrors the `FEEDBACK_LABELS` legacy tail in
 * `internal-page.tsx` — display tolerance, not a writer contract.
 */
const FUNNEL_COLORS: Record<string, string> = {
  contacted: '#3b82f6',
  replied: '#8b5cf6',
  won: '#10b981',
  badfit: '#ef4444',
  snooze: '#f59e0b',
  dismissed: '#6b7280',
};

const FUNNEL_ICONS: Record<string, (p: SVGProps<SVGSVGElement>) => ReactElement> = {
  contacted: MailIcon,
  replied: ChatIcon,
  won: HandshakeIcon,
  badfit: XIcon,
  snooze: ClockIcon,
  dismissed: WaveIcon,
};

/** Display-only fallback for historical rows (accepted/later/call/client).
 *  Maps a legacy status onto the current DB-legal status whose color/icon
 *  best matches it, so an old row reads sensibly without re-introducing dead
 *  primary keys. No writer emits legacy statuses. */
const FUNNEL_LEGACY_DISPLAY: Record<string, string> = {
  accepted: 'contacted',
  later: 'snooze',
  call: 'replied',
  client: 'won',
};

/** Resolve a (possibly legacy) feedback status to a canonical DB-legal key. */
function canonicalFunnelStatus(status: string): string {
  return FUNNEL_LEGACY_DISPLAY[status] ?? status;
}

export default function DashboardAnalytics({
  feedbackFunnel,
  leadMetrics,
  sourcePerformance,
  sourceEvidenceQuality,
}: DashboardAnalyticsProps) {
  const totalFeedback = feedbackFunnel.reduce((sum, item) => sum + item.count, 0);
  const maxFunnelCount = Math.max(...feedbackFunnel.map((f) => f.count), 1);
  const hasEvidenceQuality = (sourceEvidenceQuality?.length ?? 0) > 0;

  return (
    <div className={styles.analyticsSection}>
      {/* Lead Metrics */}
      <section aria-labelledby="lead-metrics-heading">
        <h2 id="lead-metrics-heading" className={styles.analyticsHeading}>
          Метрики лидов
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
            <div className={styles.cardLabel}>Средний балл</div>
            <div className={`${styles.cardValue} ${styles.metricValueWarning}`}>{leadMetrics.avgScore.toFixed(1)}</div>
          </div>
        </div>
      </section>

      {/* Feedback Funnel */}
      <section aria-labelledby="feedback-funnel-heading">
        <h2 id="feedback-funnel-heading" className={styles.analyticsHeading}>
          Воронка обратной связи
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
                const canonical = canonicalFunnelStatus(item.status);
                const color = FUNNEL_COLORS[canonical] ?? '#6b7280';
                const Icon = FUNNEL_ICONS[canonical] ?? HelpIcon;
                return (
                  <div key={item.status} className={styles.funnelItem} data-status={canonical}>
                    <div className={styles.funnelItemHeader}>
                      <span className={styles.funnelItemLabel}>
                        <Icon className={styles.funnelItemIcon} style={{ color }} /> {item.label}
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
          Производительность источников
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
                  <th className={styles.gateItemLabel} scope="col">Ср. балл</th>
                </tr>
              </thead>
              <tbody>
                {sourcePerformance.map((src) => (
                  <tr key={src.source} className={styles.sourceItem}>
                    <td
                      className={`${styles.sourcePerfTd} ${styles.sourcePerfTdStrong}`}
                      data-label="Источник"
                    >
                      {sourceLabel(src.source)}
                    </td>
                    <td className={styles.sourcePerfTd} data-label="Лидов">
                      {src.leads}
                    </td>
                    <td className={styles.sourcePerfTd} data-label="Ср. балл">
                      {src.avgScore.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Source Evidence Quality — gate + evidence-tier distribution per source.
          Lead count alone is a volume signal; this surfaces whether a source's
          leads are gate-A direct hiring proof or gate-C platform noise, plus
          average freshness. The HTML-card fallback's contribution shows up as
          more direct_hiring_proof leads under career-pages. */}
      {hasEvidenceQuality && (
        <section aria-labelledby="source-evidence-heading">
          <h2 id="source-evidence-heading" className={styles.analyticsHeading}>
            Качество доказательств по источникам
          </h2>
          <div className={styles.sourcePerfTable}>
            <table className={styles.sourcePerfTableInner}>
              <thead>
                <tr className={styles.gateItemBar /* reuse border-bottom style */}>
                  <th className={styles.gateItemLabel} scope="col">Источник</th>
                  <th className={styles.gateItemLabel} scope="col">Лидов</th>
                  <th className={styles.gateItemLabel} scope="col">Гейт A</th>
                  <th className={styles.gateItemLabel} scope="col">Гейт B</th>
                  <th className={styles.gateItemLabel} scope="col">Гейт C</th>
                  <th className={styles.gateItemLabel} scope="col">Прямой найм</th>
                  <th className={styles.gateItemLabel} scope="col">Платформа</th>
                  <th className={styles.gateItemLabel} scope="col">Свежесть</th>
                </tr>
              </thead>
              <tbody>
                {sourceEvidenceQuality!.map((src) => {
                  const directShare = src.leads > 0 ? Math.round((src.directHiringProof / src.leads) * 100) : 0;
                  return (
                    <tr key={src.source} className={styles.sourceItem}>
                      <td
                        className={`${styles.sourcePerfTd} ${styles.sourcePerfTdStrong}`}
                        data-label="Источник"
                      >
                        {sourceLabel(src.source)}
                      </td>
                      <td className={styles.sourcePerfTd} data-label="Лидов">{src.leads}</td>
                      <td className={styles.sourcePerfTd} data-label="Гейт A">{src.gateA}</td>
                      <td className={styles.sourcePerfTd} data-label="Гейт B">{src.gateB}</td>
                      <td className={styles.sourcePerfTd} data-label="Гейт C">{src.gateC}</td>
                      <td className={styles.sourcePerfTd} data-label="Прямой найм">
                        {src.directHiringProof}
                        {src.directHiringProof > 0 && (
                          <span className={styles.sourcePerfShare}> {directShare}%</span>
                        )}
                      </td>
                      <td className={styles.sourcePerfTd} data-label="Платформа">{src.platformAggregation}</td>
                      <td className={styles.sourcePerfTd} data-label="Свежесть">{formatAgeDays(src.avgAgeDays)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Analytics `<Suspense>` fallback — modeled on `QualitySkeleton`/
 * `OverviewSkeleton`. Renders an `aria-busy` skeleton block shaped like the
 * analytics section (heading + metric grid + funnel + table rows) so a
 * loading gap doesn't flash white. Used by `dashboard/page.tsx`.
 */
export function AnalyticsSkeleton() {
  return (
    <div className={styles.analyticsSection} aria-busy="true" role="status" aria-live="polite">
      <span className={styles.srOnly}>Загрузка аналитики…</span>
      {/* Lead metrics — 3 skeleton cards */}
      <section aria-labelledby="lead-metrics-heading-skeleton">
        <h2 id="lead-metrics-heading-skeleton" className={styles.analyticsHeading}>
          Метрики лидов
        </h2>
        <div className={styles.analyticsMetricsGrid}>
          {[1, 2, 3].map((i) => (
            <div key={i} className={styles.metricCard}>
              <div className={`${styles.skeletonBase} ${styles.skeletonCardHeaderLeft}`} />
              <div className={`${styles.skeletonBase} ${styles.skeletonCardValue}`} />
            </div>
          ))}
        </div>
      </section>
      {/* Feedback funnel — skeleton bars */}
      <section aria-labelledby="feedback-funnel-heading-skeleton">
        <h2 id="feedback-funnel-heading-skeleton" className={styles.analyticsHeading}>
          Воронка обратной связи
        </h2>
        <div className={styles.funnelCard}>
          <div className={styles.funnelList}>
            {[1, 2, 3].map((i) => (
              <div key={i} className={styles.funnelItem}>
                <div className={styles.funnelItemHeader}>
                  <span className={`${styles.skeletonBase} ${styles.skeletonSourcesTitle}`} style={{ width: '40%' }} />
                  <span className={`${styles.skeletonBase} ${styles.skeletonSourcesCount}`} style={{ width: '15%' }} />
                </div>
                <div className={`${styles.skeletonBase} ${styles.funnelBarTrack}`} data-skeleton="true" />
              </div>
            ))}
          </div>
        </div>
      </section>
      {/* Source performance — skeleton table rows */}
      <section aria-labelledby="source-perf-heading-skeleton">
        <h2 id="source-perf-heading-skeleton" className={styles.analyticsHeading}>
          Производительность источников
        </h2>
        <div className={styles.sourcePerfTable}>
          {[1, 2, 3].map((i) => (
            <div key={i} className={styles.skeletonSourceItem}>
              <span className={`${styles.skeletonBase} ${styles.skeletonSourceName}`} />
              <span className={`${styles.skeletonBase} ${styles.skeletonSourceScore}`} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
