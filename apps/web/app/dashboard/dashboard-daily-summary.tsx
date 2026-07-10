'use client';

import React from 'react';
import styles from './dashboard.module.css';

interface DailySummaryProps {
  todayLeads?: number;
  totalLeads?: number;
  gateA?: number;
  gateB?: number;
  gateC?: number;
  pendingReview?: number;
  loading?: boolean;
}

function SummarySkeleton() {
  return (
    <section aria-labelledby="daily-summary-heading" aria-busy="true">
      <h2 id="daily-summary-heading" className={styles.srOnly}>
        Сводка дня
      </h2>
      <div className={styles.summaryGrid} role="list" aria-label="Загрузка сводки">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={styles.summaryCardSkeleton}>
            <div className={`${styles.skeletonBase} ${styles.skeletonCardHeaderLeft}`} />
            <div className={`${styles.skeletonBase} ${styles.skeletonCardValue}`} />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Agency-facing daily summary — replaces system metrics (sources, health, alerts)
 * with business-value metrics that matter to recruitment agencies.
 *
 * "What can I act on today?" instead of "How healthy is the system?"
 */
const DashboardDailySummary: React.FC<DailySummaryProps> = ({
  todayLeads = 0,
  totalLeads = 0,
  gateA = 0,
  gateB = 0,
  gateC = 0,
  pendingReview = 0,
  loading = false,
}) => {
  if (loading) {
    return <SummarySkeleton />;
  }

  const readyToContact = gateA + gateB;

  return (
    <section aria-labelledby="daily-summary-heading" className={styles.summarySection}>
      <h2 id="daily-summary-heading" className={styles.summaryHeading}>
        Сегодня
      </h2>
      <div className={styles.summaryGrid} role="list" aria-label="Сводка дня">
        {/* Primary: companies in radar today */}
        <article
          className={`${styles.summaryCard} ${styles.summaryCardPrimary}`}
          role="listitem"
          aria-label={`Компаний в радаре сегодня: ${todayLeads}`}
        >
          <div className={styles.summaryCardLabel}>В радаре сегодня</div>
          <div className={`${styles.summaryCardValue} ${styles.summaryCardValuePrimary}`}>
            {todayLeads}
          </div>
          <div className={styles.summaryCardSubtext}>
            компаний по вашему профилю
          </div>
        </article>

        {/* Ready to contact — the action metric */}
        <article
          className={`${styles.summaryCard} ${styles.summaryCardReady}`}
          role="listitem"
          aria-label={`Готовы к контакту: ${readyToContact}`}
        >
          <div className={styles.summaryCardLabel}>Готовы к контакту</div>
          <div className={`${styles.summaryCardValue} ${styles.summaryCardValueReady}`}>
            {readyToContact}
          </div>
          <div className={styles.summaryCardSubtext}>
            gate A+B с доказательствами
          </div>
        </article>

        {/* Pending review — needs attention */}
        {pendingReview > 0 && (
          <article
            className={`${styles.summaryCard} ${styles.summaryCardReview}`}
            role="listitem"
            aria-label={`На проверке: ${pendingReview}`}
          >
            <div className={styles.summaryCardLabel}>На проверке</div>
            <div className={`${styles.summaryCardValue} ${styles.summaryCardValueReview}`}>
              {pendingReview}
            </div>
            <div className={styles.summaryCardSubtext}>
              требуют вашей оценки
            </div>
          </article>
        )}

        {/* Total evidence base — credibility */}
        <article
          className={styles.summaryCard}
          role="listitem"
          aria-label={`Всего компаний в базе: ${totalLeads}`}
        >
          <div className={styles.summaryCardLabel}>В базе</div>
          <div className={styles.summaryCardValue}>
            {totalLeads}
          </div>
          <div className={styles.summaryCardSubtext}>
            компаний за всё время
          </div>
        </article>
      </div>
    </section>
  );
};

export default DashboardDailySummary;
