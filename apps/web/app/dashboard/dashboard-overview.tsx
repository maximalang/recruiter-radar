'use client';

import React from 'react';
import styles from './dashboard.module.css';

interface DashboardOverviewProps {
  totalSources?: number;
  activeSources?: number;
  overallHealth?: number;
  totalAlerts?: number;
  loading?: boolean;
}

function OverviewSkeleton() {
  return (
    <section aria-labelledby="overview-heading" aria-busy="true">
      <h2 id="overview-heading" className={styles.srOnly}>
        Обзор метрик
      </h2>
      <div className={styles.overviewSection} role="list" aria-label="Загрузка метрик">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={styles.skeletonCard}>
            <div className={styles.skeletonCardHeader}>
              <div className={`${styles.skeletonBase} ${styles.skeletonCardHeaderLeft}`} />
              <div className={`${styles.skeletonBase} ${styles.skeletonCardHeaderRight}`} />
            </div>
            <div className={`${styles.skeletonBase} ${styles.skeletonCardValue}`} />
            <div className={`${styles.skeletonBase} ${styles.skeletonCardSubtext}`} />
          </div>
        ))}
      </div>
    </section>
  );
}

const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  totalSources = 12,
  activeSources = 10,
  overallHealth = 85,
  totalAlerts = 2,
  loading = false
}) => {
  if (loading) {
    return <OverviewSkeleton />;
  }

  const healthPercentage = overallHealth;
  const activePercentage = (activeSources / totalSources) * 100;

  const getProgressColor = (value: number) => {
    if (value >= 80) return styles.progressBarGreen;
    if (value >= 60) return styles.progressBarYellow;
    return styles.progressBarRed;
  };

  return (
    <section aria-labelledby="overview-heading">
      <h2 id="overview-heading" className={styles.srOnly}>
        Обзор метрик
      </h2>
      <div className={styles.overviewSection} role="list">
        {/* Карточка: Всего источников */}
        <article
          className={styles.metricCard}
          role="listitem"
          aria-label={`Всего источников: ${totalSources}, ${activeSources} активных`}
        >
          <div className={styles.cardHeader}>
            <span className={styles.cardLabel}>Всего источников</span>
          </div>
          <div>
            <div className={styles.cardValue}>{totalSources}</div>
            <p className={styles.cardSubtext}>{activeSources} активных</p>
          </div>
        </article>

        {/* Карточка: Общее здоровье */}
        <article
          className={styles.metricCard}
          role="listitem"
          aria-label={`Общее здоровье системы: ${healthPercentage}%`}
        >
          <div className={styles.cardHeader}>
            <span className={styles.cardLabel}>Общее здоровье</span>
          </div>
          <div>
            <div className={styles.cardValue}>{healthPercentage}%</div>
            <div
              className={styles.progressTrack}
              role="progressbar"
              aria-valuenow={healthPercentage}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Здоровье системы: ${healthPercentage}%`}
            >
              <div
                className={`${styles.progressBar} ${getProgressColor(healthPercentage)}`}
                style={{ width: `${healthPercentage}%` }}
              />
            </div>
          </div>
        </article>

        {/* Карточка: Активные источники */}
        <article
          className={styles.metricCard}
          role="listitem"
          aria-label={`Активные источники: ${activePercentage.toFixed(0)}%`}
        >
          <div className={styles.cardHeader}>
            <span className={styles.cardLabel}>Активные источники</span>
          </div>
          <div>
            <div className={styles.cardValue}>{activePercentage.toFixed(0)}%</div>
            <div
              className={styles.progressTrack}
              role="progressbar"
              aria-valuenow={activePercentage}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Активность источников: ${activePercentage.toFixed(0)}%`}
            >
              <div
                className={`${styles.progressBar} ${getProgressColor(activePercentage)}`}
                style={{ width: `${activePercentage}%` }}
              />
            </div>
          </div>
        </article>

        {/* Карточка: Активные алерты */}
        <article
          className={styles.metricCard}
          role="listitem"
          aria-label={`Активных алертов: ${totalAlerts}, требуют внимания`}
        >
          <div className={styles.cardHeader}>
            <span className={styles.cardLabel}>Активные алерты</span>
          </div>
          <div>
            <div
              className={styles.cardValue}
              style={{ color: totalAlerts > 0 ? '#ef4444' : '#111827' }}
            >
              {totalAlerts}
            </div>
            <p className={styles.cardSubtext}>Требуют внимания</p>
          </div>
        </article>
      </div>
    </section>
  );
};

export default DashboardOverview;