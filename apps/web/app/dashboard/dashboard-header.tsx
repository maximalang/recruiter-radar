'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import styles from './dashboard.module.css';

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
    <header className={styles.header}>
      <div className={styles.headerContent}>
        <div>
          <h1 className={styles.headerTitle}>
            📊 Радар источников
          </h1>
          <p className={styles.headerSubtitle}>
            Мониторинг производительности и состояние источников в реальном времени
          </p>
        </div>
        <nav className={styles.headerActions} aria-label="Действия на панели">
          <time
            className={styles.headerTime}
            dateTime={currentTime.toISOString()}
            aria-label={`Текущее время: ${currentTime.toLocaleTimeString('ru-RU')}`}
          >
            Обновлено: {currentTime.toLocaleTimeString('ru-RU')}
          </time>
          {lastUpdated && (
            <span className={styles.headerSync}>
              Последний sync: {new Date(lastUpdated).toLocaleString('ru-RU')}
            </span>
          )}
          <Link
            href="/"
            className={styles.headerLink}
          >
            На главную
          </Link>
        </nav>
      </div>
    </header>
  );
};

export default DashboardHeader;
