'use client';

import { useState } from 'react';
import styles from './dashboard.module.css';

interface Alert {
  id: string;
  type: 'critical' | 'warning' | 'info';
  source: string;
  message: string;
  timestamp: string;
  recommendation?: string;
  resolved: boolean;
}

interface DashboardAlertsProps {
  loading?: boolean;
}

function AlertsSkeleton() {
  return (
    <section aria-labelledby="alerts-heading" aria-busy="true" className={styles.alertsSection}>
      <div className={styles.alertsHeader}>
        <div className={styles.skeletonBase} style={{ width: '120px', height: '18px', borderRadius: '4px' }} />
        <div className={styles.skeletonBase} style={{ width: '80px', height: '12px', borderRadius: '4px' }} />
      </div>
      <ul className={styles.alertsList} role="list" aria-label="Загрузка алертов">
        {[1, 2, 3].map((i) => (
          <li key={i} className={`${styles.skeletonAlertItem} ${styles.skeletonBase}`}>
            <div className={styles.skeletonAlertIcon} />
            <div className={styles.skeletonAlertSource} />
            <div className={styles.skeletonAlertMessage} />
            <div className={styles.skeletonAlertTime} />
          </li>
        ))}
      </ul>
    </section>
  );
}

const ALERT_CONFIG: Record<Alert['type'], { icon: string; colorClass: string }> = {
  critical: { icon: '🚨', colorClass: styles.alertCritical },
  warning:  { icon: '⚠️',  colorClass: styles.alertWarning },
  info:     { icon: 'ℹ️',  colorClass: styles.alertInfo },
};

export default function DashboardAlerts({ loading = false }: DashboardAlertsProps) {
  const [alerts, setAlerts] = useState<Alert[]>([
    { id: '1', type: 'critical', source: 'linkedin-company-pages', message: 'Источник не отвечает уже 30 минут', timestamp: '2026-05-21 14:30:00', recommendation: 'Проверить конфигурацию API LinkedIn', resolved: false },
    { id: '2', type: 'warning', source: 'company-site', message: 'Увеличение ошибок на 40% за последний час', timestamp: '2026-05-21 14:15:00', recommendation: 'Проверить доступность целевых сайтов', resolved: false },
    { id: '3', type: 'info', source: 'hh', message: 'Доступен новый метод API для поиска', timestamp: '2026-05-21 13:45:00', recommendation: 'Рассмотреть обновление для повышения производительности', resolved: true }
  ]);

  if (loading) {
    return <AlertsSkeleton />;
  }

  const resolveAlert = (id: string) =>
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, resolved: true } : a));

  const activeAlerts = alerts.filter(a => !a.resolved);
  const resolvedAlerts = alerts.filter(a => a.resolved);

  return (
    <section aria-labelledby="alerts-heading" className={styles.alertsSection}>
      <div className={styles.alertsHeader}>
        <h2 id="alerts-heading" className={styles.alertsTitle}>
          🚨 Активные алерты
        </h2>
        <span
          className={styles.alertsCount}
          aria-live="polite"
          aria-atomic="true"
        >
          {activeAlerts.length} активных
        </span>
      </div>

      {activeAlerts.length === 0 ? (
        <div className={styles.alertsEmpty}>
          ✅ Все системы в порядке
        </div>
      ) : (
        <ul
          className={styles.alertsList}
          role="list"
          aria-label="Активные алерты"
        >
          {activeAlerts.map((alert: Alert) => {
            const config = ALERT_CONFIG[alert.type];
            return (
              <li
                key={alert.id}
                className={`${styles.alertItem} ${config.colorClass}`}
              >
                <div className={styles.alertItemContent}>
                  <span className={styles.alertItemIcon} aria-hidden="true">
                    {config.icon}
                  </span>
                  <div className={styles.alertItemBody}>
                    <div className={styles.alertItemSource}>{alert.source}</div>
                    <div className={styles.alertItemMessage}>{alert.message}</div>
                    <div className={styles.alertItemTime}>{alert.timestamp}</div>
                    {alert.recommendation && (
                      <div className={styles.alertItemRecommendation}>
                        <div className={styles.alertItemRecommendationTitle}>💡 Рекомендация</div>
                        <div className={styles.alertItemRecommendationText}>{alert.recommendation}</div>
                      </div>
                    )}
                  </div>
                  <button
                    className={styles.alertItemAction}
                    onClick={() => resolveAlert(alert.id)}
                    aria-describedby={`alert-action-${alert.id}`}
                  >
                    <span id={`alert-action-${alert.id}`} className="sr-only">Отметить алерт как решённый</span>
                    ✅ Решить
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {resolvedAlerts.length > 0 && (
        <div className={styles.alertsResolved}>
          <div className={styles.alertsResolvedTitle}>
            📋 Решенные алерты
          </div>
          <ul
            className={styles.alertsResolvedList}
            role="list"
            aria-label="Решенные алерты"
          >
            {resolvedAlerts.slice(0, 3).map((alert: Alert) => (
              <li
                key={alert.id}
                className={styles.resolvedItem}
              >
                <div className={styles.resolvedItemContent}>
                  <span className={styles.resolvedItemIcon} aria-hidden="true">✅</span>
                  <span className={styles.resolvedItemText}>
                    {alert.source} — {alert.message}
                  </span>
                </div>
                <time className={styles.resolvedItemTime} dateTime={alert.timestamp}>
                  {alert.timestamp}
                </time>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}