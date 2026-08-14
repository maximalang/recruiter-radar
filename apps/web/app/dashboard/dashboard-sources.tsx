'use client';

import React, { useMemo } from 'react';
import type { ReactElement, SVGProps } from 'react';
import styles from './dashboard.module.css';
import { CheckIcon, AlertIcon, XIcon } from '../ui/icons';

interface SourceHealth {
  id: string;
  name: string;
  overall: number;
  lastRun: string;
  recordsProcessed: number;
  errors: number;
  status: 'excellent' | 'good' | 'warning' | 'critical' | 'inactive';
}

const STATUS_CONFIG: Record<SourceHealth['status'], { label: string; icon: (p: SVGProps<SVGSVGElement>) => ReactElement; colorClass: string }> = {
  excellent: { label: 'отлично', icon: CheckIcon, colorClass: styles.sourceItemScoreGreen },
  good:      { label: 'хорошо',   icon: AlertIcon, colorClass: styles.sourceItemScoreYellow },
  warning:   { label: 'внимание', icon: AlertIcon, colorClass: styles.sourceItemScoreYellow },
  critical:  { label: 'критично', icon: XIcon,     colorClass: styles.sourceItemScoreRed },
  inactive:  { label: 'неактивен', icon: AlertIcon, colorClass: styles.sourceItemScoreYellow },
};

const getBarColor = (overall: number, status: SourceHealth['status']) =>
  status === 'inactive' ? styles.sourceItemScoreYellow :
  overall >= 80 ? styles.sourceItemScoreGreen :
  overall >= 60 ? styles.sourceItemScoreYellow :
  styles.sourceItemScoreRed;

/** Renders the source-status SVG icon, inheriting the status tone color. */
function StatusIcon({
  icon: Icon,
  colorClass,
}: {
  icon: (p: SVGProps<SVGSVGElement>) => ReactElement;
  colorClass: string;
}) {
  return <Icon className={`${styles.sourceItemIconSvg} ${colorClass}`} />;
}

/**
 * Render the last-sync moment as a human relative phrase. `lastRun` arrives as a
 * raw ISO timestamp from the health query (or "" when a source produced no
 * signal in the 24h window). Never surface the raw timestamp to the recruiter.
 */
function formatLastRun(lastRun: string): string {
  if (!lastRun) return 'нет данных за 24ч';
  const ts = new Date(lastRun).getTime();
  if (Number.isNaN(ts)) return 'нет данных за 24ч';
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return 'только что';
  if (mins < 60) return `${mins} мин назад`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.round(hours / 24);
  return `${days} дн назад`;
}

/** Russian plural for "источник". */
function pluralSources(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'источник';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'источника';
  return 'источников';
}

interface DashboardSourcesProps {
  sources?: SourceHealth[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

function SourcesErrorState({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <section aria-labelledby="sources-heading" className={styles.sourcesSection}>
      <div className={styles.sourcesHeader}>
        <h2 id="sources-heading" className={styles.sourcesTitle}>
          Статистика источников
        </h2>
      </div>
      <div className={styles.errorState} role="alert" aria-live="assertive">
        <div className={styles.errorStateTitle}>Ошибка загрузки</div>
        <div className={styles.errorStateDescription}>{error}</div>
        {onRetry && (
          <button className={styles.errorStateRetry} onClick={onRetry}>
            Повторить
          </button>
        )}
      </div>
    </section>
  );
}

function SourcesEmptyState() {
  return (
    <section aria-labelledby="sources-heading" className={styles.sourcesSection}>
      <div className={styles.sourcesHeader}>
        <h2 id="sources-heading" className={styles.sourcesTitle}>
          Статистика источников
        </h2>
      </div>
      <div className={styles.sourcesEmpty}>
        <div className={styles.sourcesEmptyTitle}>Нет источников данных</div>
        <div className={styles.sourcesEmptyDescription}>
          Источники данных ещё не настроены. Добавьте первый источник для начала мониторинга.
        </div>
      </div>
    </section>
  );
}

function SourcesSkeleton() {
  return (
    <section aria-labelledby="sources-heading" aria-busy="true" className={styles.skeletonSourcesSection}>
      <div className={styles.skeletonSourcesHeader}>
        <div className={`${styles.skeletonBase} ${styles.skeletonSourcesTitle}`} />
        <div className={`${styles.skeletonBase} ${styles.skeletonSourcesCount}`} />
      </div>
      <ul role="list" aria-label="Загрузка источников" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', listStyle: 'none', padding: 0, margin: 0 }}>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <li key={i} className={styles.skeletonSourceItem}>
            <div className={styles.skeletonSourceInfo}>
              <div className={`${styles.skeletonBase} ${styles.skeletonSourceIcon}`} />
              <div>
                <div className={`${styles.skeletonBase} ${styles.skeletonSourceName}`} />
                <div className={`${styles.skeletonBase} ${styles.skeletonSourceMeta}`} />
              </div>
            </div>
            <div className={styles.skeletonSourceStats}>
              <div className={`${styles.skeletonBase} ${styles.skeletonSourceScore}`} />
              <div className={`${styles.skeletonBase} ${styles.skeletonSourceProgress}`} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const DashboardSources: React.FC<DashboardSourcesProps> = ({
  sources = [],
  loading = false,
  error,
  onRetry
}) => {
  if (loading) {
    return <SourcesSkeleton />;
  }

  if (error) {
    return <SourcesErrorState error={error} onRetry={onRetry} />;
  }

  if (!sources || sources.length === 0) {
    return <SourcesEmptyState />;
  }

  const sortedSources = useMemo(() => [...sources].sort((a, b) => b.overall - a.overall), [sources]);

  return (
    <section aria-labelledby="sources-heading" className={styles.sourcesSection}>
      <div className={styles.sourcesHeader}>
        <h2 id="sources-heading" className={styles.sourcesTitle}>
          Статистика источников
        </h2>
        <span className={styles.sourcesCount}>
          {sources.length} {pluralSources(sources.length)}
        </span>
      </div>
      <ul
        className={styles.sourcesList}
        role="list"
        aria-label="Список источников данных"
      >
        {sortedSources.map((source) => {
            const config = STATUS_CONFIG[source.status];
            return (
              <li
                key={source.id}
                className={styles.sourceItem}
                aria-label={`${source.name}: ${source.overall}%, статус ${config.label}, ${source.recordsProcessed} записей${source.errors > 0 ? `, ${source.errors} ошибок` : ''}`}
              >
                <div className={styles.sourceItemInfo}>
                  <span className={styles.sourceItemIcon} aria-hidden="true">
                    <StatusIcon icon={config.icon} colorClass={config.colorClass} />
                  </span>
                  <div>
                    <div className={styles.sourceItemName}>{source.name}</div>
                    <div className={styles.sourceItemMeta}>
                      {formatLastRun(source.lastRun)} • {source.recordsProcessed} записей
                    </div>
                  </div>
                </div>
                <div className={styles.sourceItemStats}>
                  <div className={styles.sourceItemScore}>
                    <div className={`${styles.sourceItemScoreValue} ${config.colorClass}`}>
                      {source.overall}%
                    </div>
                    <div
                      className={styles.sourceItemProgress}
                      role="progressbar"
                      aria-valuenow={source.overall}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${source.name}: ${source.overall}%`}
                    >
                      <div
                        className={`${styles.sourceItemProgressBar} ${getBarColor(source.overall, source.status)}`}
                        style={{ width: `${source.overall}%` }}
                      />
                    </div>
                  </div>
                  {source.errors > 0 && (
                    <span className={styles.sourceItemErrors}>
                      {source.errors} ошибок
                    </span>
                  )}
                </div>
              </li>
            );
          })}
      </ul>
    </section>
  );
};

export default DashboardSources;
export type { SourceHealth };
