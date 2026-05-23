'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface DashboardHeaderProps {
  lastUpdated?: string;
}

const DashboardHeader: React.FC<DashboardHeaderProps> = ({ lastUpdated }) => {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div style={{
      borderBottom: '1px solid #e5e7eb',
      paddingBottom: '24px'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start'
      }}>
        <div>
          <h1 style={{
            fontSize: '32px',
            fontWeight: 'bold',
            color: '#111827'
          }}>
            📊 Радар источников
          </h1>
          <p style={{
            marginTop: '8px',
            color: '#6b7280'
          }}>
            Мониторинг производительности и состояние источников в реальном времени
          </p>
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px'
        }}>
          <div style={{
            fontSize: '14px',
            color: '#6b7280'
          }}>
            Обновлено: {currentTime.toLocaleTimeString('ru-RU')}
          </div>
          {lastUpdated && (
            <div style={{
              fontSize: '14px',
              color: '#6b7280'
            }}>
              Последний sync: {new Date(lastUpdated).toLocaleString('ru-RU')}
            </div>
          )}
          <Link
            href="/"
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              fontWeight: '500',
              color: '#374151',
              backgroundColor: 'white',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              textDecoration: 'none'
            }}
          >
            На главную
          </Link>
        </div>
      </div>
    </div>
  );
};

export default DashboardHeader;