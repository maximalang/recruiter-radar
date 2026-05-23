'use client';

import React from 'react';

interface DashboardOverviewProps {
  totalSources?: number;
  activeSources?: number;
  overallHealth?: number;
  totalAlerts?: number;
}

const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  totalSources = 12,
  activeSources = 10,
  overallHealth = 85,
  totalAlerts = 2
}) => {
  const healthPercentage = overallHealth;
  const activePercentage = (activeSources / totalSources) * 100;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <div style={{
        backgroundColor: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        padding: '20px',
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '12px'
        }}>
          <div style={{
            fontSize: '14px',
            fontWeight: '500',
            color: '#374151'
          }}>
            Всего источников
          </div>
          <span style={{ fontSize: '24px' }}>🎯</span>
        </div>
        <div>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{totalSources}</div>
          <p style={{
            fontSize: '12px',
            color: '#6b7280',
            marginTop: '4px'
          }}>
            {activeSources} активных
          </p>
        </div>
      </div>

      <div style={{
        backgroundColor: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        padding: '20px',
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '12px'
        }}>
          <div style={{
            fontSize: '14px',
            fontWeight: '500',
            color: '#374151'
          }}>
            Общее здоровье
          </div>
          <span style={{ fontSize: '24px' }}>💪</span>
        </div>
        <div>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{healthPercentage}%</div>
          <div
            style={{
              width: '100%',
              height: '8px',
              backgroundColor: '#e5e7eb',
              borderRadius: '4px',
              overflow: 'hidden',
              marginTop: '8px'
            }}
          >
            <div
              style={{
                width: `${healthPercentage}%`,
                height: '100%',
                backgroundColor: healthPercentage >= 80 ? '#10b981' :
                                 healthPercentage >= 60 ? '#f59e0b' : '#ef4444',
                transition: 'width 0.3s ease'
              }}
            />
          </div>
        </div>
      </div>

      <div style={{
        backgroundColor: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        padding: '20px',
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '12px'
        }}>
          <div style={{
            fontSize: '14px',
            fontWeight: '500',
            color: '#374151'
          }}>
            Активные источники
          </div>
          <span style={{ fontSize: '24px' }}>⚡</span>
        </div>
        <div>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{activePercentage.toFixed(0)}%</div>
          <div
            style={{
              width: '100%',
              height: '8px',
              backgroundColor: '#e5e7eb',
              borderRadius: '4px',
              overflow: 'hidden',
              marginTop: '8px'
            }}
          >
            <div
              style={{
                width: `${activePercentage}%`,
                height: '100%',
                backgroundColor: activePercentage >= 80 ? '#10b981' :
                                 activePercentage >= 60 ? '#f59e0b' : '#ef4444',
                transition: 'width 0.3s ease'
              }}
            />
          </div>
        </div>
      </div>

      <div style={{
        backgroundColor: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        padding: '20px',
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '12px'
        }}>
          <div style={{
            fontSize: '14px',
            fontWeight: '500',
            color: '#374151'
          }}>
            Активные алерты
          </div>
          <span style={{ fontSize: '24px' }}>🚨</span>
        </div>
        <div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#ef4444' }}>{totalAlerts}</div>
          <p style={{
            fontSize: '12px',
            color: '#6b7280',
            marginTop: '4px'
          }}>
            Требуют внимания
          </p>
        </div>
      </div>
    </div>
  );
};

export default DashboardOverview;