'use client';

import { useState, useEffect, useRef } from 'react';

export default function LiveClock() {
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
    <time
      style={{ fontSize: '0.875rem', color: 'var(--c-text-muted)' }}
      dateTime={currentTime.toISOString()}
      aria-label={`Текущее время: ${currentTime.toLocaleTimeString('ru-RU')}`}
    >
      Обновлено: {currentTime.toLocaleTimeString('ru-RU')}
    </time>
  );
}
