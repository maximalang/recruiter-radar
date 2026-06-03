'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import styles from './dashboard.module.css';

interface DashboardHeaderProps {
  lastUpdated?: string;
}

const DashboardHeader: React.FC<DashboardHeaderProps> = ({ lastUpdated }) => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const tick = () => {
      if (!document.hidden) {
        setCurrentTime(new Date());
      }
    };

    const scheduleNext = () => {
      if (document.hidden) {
        intervalId = setInterval(() => {
          if (!document.hidden) {
            tick();
            startActiveLoop();
          }
        }, 1000);
      }
    };

    const startActiveLoop = () => {
      tick();
      rafRef.current = requestAnimationFrame(() => {
        const now = Date.now();
        const delay = 1000 - (now % 1000);
        intervalId = setTimeout(() => {
          tick();
          if (!document.hidden) {
            startActiveLoop();
          } else {
            scheduleNext();
          }
        }, delay);
      });
    };

    const onVisibilityChange = () => {
      if (!document.hidden) {
        tick();
        startActiveLoop();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    startActiveLoop();

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      if (intervalId !== null) {
        clearTimeout(intervalId);
        clearInterval(intervalId);
      }
    };
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
