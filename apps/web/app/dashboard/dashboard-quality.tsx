'use client';

import React from 'react';
import styles from './dashboard.module.css';
import { GATE_LABELS, ErrorState } from '../ui/internal-page';

interface AcceptanceRate {
  period: string;
  delivered: number;
  accepted: number;
  rate: number;
}

interface GateDistribution {
  gate: string;
  count: number;
  percentage: number;
}

interface MetricsData {
  gateDistribution: GateDistribution[];
  acceptanceRate7d: AcceptanceRate;
  acceptanceRate30d: AcceptanceRate;
  totalLeadsDelivered: number;
  totalSourcesActive: number;
  overallHealth: number;
}

interface DashboardQualityProps {
  data?: MetricsData;
  loading?: boolean;
  error?: string | null;
}

function QualitySkeleton() {
  return (
    <section aria-labelledby="quality-heading" aria-busy="true" className={styles.qualitySection}>
      <h2 id="quality-heading" className={styles.qualityHeading}>
        Метрики качества
      </h2>
      <div className={styles.qualityCards} role="list" aria-label="Загрузка метрик качества">
        {[1, 2].map((i) => (
          <div key={i} className={styles.skeletonCard}>
            <div className={styles.skeletonCardHeader}>
              <div className={`${styles.skeletonBase} ${styles.skeletonCardHeaderLeft}`} />
              <div className={`${styles.skeletonBase} ${styles.skeletonCardHeaderRight}`} />
            </div>
            <div className={`${styles.skeletonBase} ${styles.skeletonCardValue}`} style={{ width: '50%', height: '32px' }} />
            <div className={`${styles.skeletonBase} ${styles.skeletonCardSubtext}`} style={{ width: '80%' }} />
          </div>
        ))}
        <div className={`${styles.skeletonCard} ${styles.skeletonCardWide}`}>
          <div className={styles.skeletonCardHeader}>
            <div className={`${styles.skeletonBase} ${styles.skeletonCardHeaderLeft}`} />
            <div className={`${styles.skeletonBase} ${styles.skeletonCardHeaderRight}`} />
          </div>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className={styles.skeletonGateItem}>
              <div className={styles.skeletonGateItemHeader}>
                <div className={`${styles.skeletonBase} ${styles.skeletonGateItemLabel}`} />
                <div className={`${styles.skeletonBase} ${styles.skeletonGateItemStats}`} />
              </div>
              <div className={`${styles.skeletonBase} ${styles.skeletonGateItemBar}`} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const GATE_COLORS: Record<string, string> = {
  A: '#10b981',
  B: '#3b82f6',
  C: '#f59e0b',
  D: '#6b7280',
};

const getRateColor = (r: number) =>
  r >= 30 ? '#10b981' : r >= 15 ? '#f59e0b' : '#ef4444';

const getPeriodLabel = (period: string) => period === '7d' ? '7 дней' : '30 дней';

function AcceptanceRateCard({ rate, period, delivered, accepted, srOnly }: AcceptanceRate & { srOnly?: boolean }) {
  const periodLabel = getPeriodLabel(period);
  const color = getRateColor(rate);

  return (
    <article
      className={`${styles.qualityCard} ${srOnly ? styles.srOnly : ''}`}
      role="status"
      aria-live="polite"
      aria-label={`Конверсия за ${periodLabel}: ${rate}%`}
    >
      <div className={styles.qualityCardHeader}>
        <span className={styles.qualityCardLabel}>Конверсия ({periodLabel})</span>
      </div>
      <div className={styles.qualityRateValue} style={{ color }}>
        {rate}%
      </div>
      <div className={styles.qualityRateSubtext}>
        {accepted} принято из {delivered} доставлено
      </div>
      {delivered === 0 && (
        <div className={styles.qualityRateNoData}>
          Недостаточно данных
        </div>
      )}
    </article>
  );
}

function GateDistributionCard({ distribution }: { distribution: GateDistribution[] }) {
  const maxCount = Math.max(...distribution.map(d => d.count), 1);

  return (
    <article
      className={`${styles.qualityCard} ${styles.qualityCardWide}`}
      aria-label="Распределение Gate лидов"
    >
      <div className={styles.qualityCardHeader}>
        <span className={styles.qualityCardLabel}>Распределение Gate</span>
      </div>
      {distribution.length === 0 ? (
        <div className={styles.qualityRateSubtext}>Нет данных за 30 дней</div>
      ) : (
        <ul className={styles.gateList} role="list" aria-label="Распределение по Gate">
          {distribution.map(({ gate, count, percentage }) => (
            <li key={gate} className={styles.gateItem} aria-label={`Gate ${gate}: ${count} лидов (${percentage}%)`}>
              <div className={styles.gateItemHeader}>
                <span className={styles.gateItemLabel}>
                  {GATE_LABELS[gate] ?? gate}
                </span>
                <span className={styles.gateItemStats}>
                  {count} ({percentage}%)
                </span>
              </div>
              <div
                className={styles.gateItemBar}
                role="progressbar"
                aria-valuenow={count}
                aria-valuemin={0}
                aria-valuemax={maxCount}
                aria-label={`${GATE_LABELS[gate] ?? gate}: ${count} из ${maxCount}`}
              >
                <div
                  className={styles.gateItemProgress}
                  style={{
                    width: `${(count / maxCount) * 100}%`,
                    backgroundColor: GATE_COLORS[gate] ?? '#6b7280',
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export default function DashboardQuality({ data, loading, error }: DashboardQualityProps) {
  if (loading) {
    return <QualitySkeleton />;
  }

  if (error) {
    return (
      <section aria-labelledby="quality-heading" className={styles.qualitySection}>
        <h2 id="quality-heading" className={styles.qualityHeading}>
          Метрики качества
        </h2>
        <ErrorState
          title="Метрики качества не загрузились"
          description="Собираем данные по принятым лидам и gate-распределению. Повторите через минуту — если не загрузится, напишите поддержку."
        />
      </section>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <section aria-labelledby="quality-heading" className={styles.qualitySection}>
      <h2 id="quality-heading" className={styles.qualityHeading}>
        Метрики качества
      </h2>
      <div className={styles.qualityCards} role="list" aria-label="Метрики качества">
        <AcceptanceRateCard {...data.acceptanceRate7d} srOnly />
        <AcceptanceRateCard {...data.acceptanceRate30d} />
        <GateDistributionCard distribution={data.gateDistribution} />
      </div>
    </section>
  );
}

export type { MetricsData, AcceptanceRate, GateDistribution };