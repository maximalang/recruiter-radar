'use client';

import { useState } from 'react';

interface Alert {
  id: string;
  type: 'critical' | 'warning' | 'info';
  source: string;
  message: string;
  timestamp: string;
  recommendation?: string;
  resolved: boolean;
}

export default function DashboardAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([
    {
      id: '1',
      type: 'critical',
      source: 'linkedin-company-pages',
      message: 'Источник не отвечает уже 30 минут',
      timestamp: '2026-05-21 14:30:00',
      recommendation: 'Проверить конфигурацию API LinkedIn',
      resolved: false
    },
    {
      id: '2',
      type: 'warning',
      source: 'company-site',
      message: 'Увеличение ошибок на 40% за последний час',
      timestamp: '2026-05-21 14:15:00',
      recommendation: 'Проверить доступность целевых сайтов',
      resolved: false
    },
    {
      id: '3',
      type: 'info',
      source: 'hh',
      message: 'Доступен новый метод API для поиска',
      timestamp: '2026-05-21 13:45:00',
      recommendation: 'Рассмотреть обновление для повышения производительности',
      resolved: true
    }
  ]);

  const getAlertIcon = (type: string): string => {
    switch (type) {
      case 'critical': return '🚨';
      case 'warning': return '⚠️';
      case 'info': return 'ℹ️';
      default: return '❓';
    }
  };

  const getAlertColor = (type: string): string => {
    switch (type) {
      case 'critical': return 'border-red-200 bg-red-50';
      case 'warning': return 'border-yellow-200 bg-yellow-50';
      case 'info': return 'border-blue-200 bg-blue-50';
      default: return 'border-gray-200 bg-gray-50';
    }
  };

  const resolveAlert = (id: string): void => {
    setAlerts(alerts.map(alert =>
      alert.id === id ? { ...alert, resolved: true } : alert
    ));
  };

  const activeAlerts = alerts.filter(alert => !alert.resolved);

  return (
    <div style={{
      backgroundColor: 'white',
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      padding: '24px',
      boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px'
      }}>
        <div style={{
          fontSize: '18px',
          fontWeight: '600',
          color: '#111827'
        }}>
          🚨 Активные алерты
        </div>
        <div style={{
          fontSize: '12px',
          color: '#6b7280'
        }}>
          {activeAlerts.length} активных
        </div>
      </div>
      {activeAlerts.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '32px',
          color: '#6b7280'
        }}>
          ✅ Все системы в порядке
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {activeAlerts.map((alert: Alert) => (
            <div
              key={alert.id}
              style={{
                padding: '16px',
                borderRadius: '8px',
                border: `1px solid ${alert.type === 'critical' ? '#fecaca' :
                                      alert.type === 'warning' ? '#fed7aa' : '#bfdbfe'}`,
                backgroundColor: alert.type === 'critical' ? '#fef2f2' :
                                 alert.type === 'warning' ? '#fffbeb' : '#eff6ff'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <span style={{ fontSize: '18px' }}>{getAlertIcon(alert.type)}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '16px', fontWeight: '500', color: '#111827' }}>
                      {alert.source}
                    </div>
                    <div style={{ fontSize: '14px', color: '#6b7280', marginTop: '4px' }}>
                      {alert.message}
                    </div>
                    <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '8px' }}>
                      {alert.timestamp}
                    </div>
                    {alert.recommendation && (
                      <div style={{ marginTop: '12px', padding: '12px', backgroundColor: 'white', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
                        <div style={{ fontSize: '14px', fontWeight: '500', color: '#374151' }}>
                          💡 Рекомендация
                        </div>
                        <div style={{ fontSize: '14px', color: '#6b7280', marginTop: '4px' }}>
                          {alert.recommendation}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => resolveAlert(alert.id)}
                  style={{
                    padding: '8px 16px',
                    fontSize: '14px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    backgroundColor: 'white',
                    cursor: 'pointer',
                    color: '#374151'
                  }}
                >
                  ✅ Решить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {alerts.filter((a: Alert) => a.resolved).length > 0 && (
        <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid #e5e7eb' }}>
          <div style={{
            fontSize: '14px',
            fontWeight: '500',
            color: '#374151',
            marginBottom: '12px'
          }}>
            📋 Решенные алерты
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {alerts
              .filter((alert: Alert) => alert.resolved)
              .slice(0, 3)
              .map((alert: Alert) => (
                <div key={alert.id} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px',
                  backgroundColor: '#f9fafb',
                  borderRadius: '6px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: '#10b981' }}>✅</span>
                    <span style={{ fontSize: '14px', color: '#6b7280' }}>
                      {alert.source} - {alert.message}
                    </span>
                  </div>
                  <span style={{ fontSize: '12px', color: '#9ca3af' }}>
                    {alert.timestamp}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}