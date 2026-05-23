'use client';

import React, { useState } from 'react';

interface SourceHealth {
  id: string;
  name: string;
  overall: number;
  lastRun: string;
  recordsProcessed: number;
  errors: number;
  status: 'excellent' | 'good' | 'warning' | 'critical';
}

const DashboardSources: React.FC = () => {
  const [sources, setSources] = useState<SourceHealth[]>([
    { id: 'hh', name: 'HeadHunter', overall: 95, lastRun: '2 минуты назад', recordsProcessed: 1250, errors: 0, status: 'excellent' },
    { id: 'career-pages', name: 'Career Pages', overall: 88, lastRun: '5 минут назад', recordsProcessed: 890, errors: 2, status: 'good' },
    { id: 'rabota-rossii', name: 'Rabota Rossii', overall: 92, lastRun: '1 минута назад', recordsProcessed: 2100, errors: 1, status: 'excellent' },
    { id: 'company-site', name: 'Company Site', overall: 76, lastRun: '15 минут назад', recordsProcessed: 450, errors: 5, status: 'warning' },
    { id: 'tech-job-boards', name: 'Tech Job Boards', overall: 83, lastRun: '8 минут назад', recordsProcessed: 670, errors: 3, status: 'good' },
    { id: 'linkedin-company-pages', name: 'LinkedIn', overall: 70, lastRun: '30 минут назад', recordsProcessed: 340, errors: 8, status: 'warning' },
  ]);

  const getStatusColor = (status: SourceHealth['status']): string => {
    switch (status) {
      case 'excellent': return 'text-green-600';
      case 'good': return 'text-blue-600';
      case 'warning': return 'text-yellow-600';
      case 'critical': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getStatusEmoji = (status: SourceHealth['status']): string => {
    switch (status) {
      case 'excellent': return '✅';
      case 'good': return '⚠️';
      case 'warning': return '⚠️';
      case 'critical': return '❌';
      default: return '❓';
    }
  };

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
          🎯 Статистика источников
        </div>
        <div style={{
          fontSize: '12px',
          color: '#6b7280'
        }}>
          {sources.length} источников
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {sources
          .sort((a, b) => b.overall - a.overall)
          .map((source) => (
            <div key={source.id} style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px',
              border: '1px solid #e5e7eb',
              borderRadius: '8px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <span style={{ fontSize: '18px' }}>{getStatusEmoji(source.status)}</span>
                <div>
                  <div style={{ fontSize: '16px', fontWeight: '500' }}>{source.name}</div>
                  <div style={{
                    fontSize: '14px',
                    color: '#6b7280',
                    marginTop: '4px'
                  }}>
                    {source.lastRun} • {source.recordsProcessed} записей
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{
                    fontSize: '18px',
                    fontWeight: 'bold',
                    color: getStatusColor(source.status)
                  }}>
                    {source.overall}%
                  </div>
                  <div style={{
                    width: '96px',
                    height: '6px',
                    backgroundColor: '#e5e7eb',
                    borderRadius: '3px',
                    overflow: 'hidden',
                    marginTop: '4px'
                  }}>
                    <div
                      style={{
                        width: `${source.overall}%`,
                        height: '100%',
                        backgroundColor: source.overall >= 80 ? '#10b981' :
                                         source.overall >= 60 ? '#f59e0b' : '#ef4444',
                        transition: 'width 0.3s ease'
                      }}
                    />
                  </div>
                </div>
                {source.errors > 0 && (
                  <div style={{
                    fontSize: '14px',
                    color: '#ef4444'
                  }}>
                    {source.errors} ошибок
                  </div>
                )}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
};

export default DashboardSources;