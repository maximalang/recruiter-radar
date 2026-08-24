'use client';

import { useState, useEffect } from 'react';

export default function LiveClock() {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const tick = () => {
      if (!document.hidden) {
        setCurrentTime(new Date());
      }
    };

    const clearScheduledTick = () => {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    };

    const scheduleNextTick = () => {
      if (document.hidden) return;

      const delay = 1000 - (Date.now() % 1000);
      timerId = setTimeout(() => {
        tick();
        scheduleNextTick();
      }, delay);
    };

    const onVisibilityChange = () => {
      clearScheduledTick();
      if (document.hidden) return;

      tick();
      scheduleNextTick();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    tick();
    scheduleNextTick();

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearScheduledTick();
    };
  }, []);

  return (
    <time
      style={{ fontSize: '0.875rem', color: 'var(--color-text-tertiary)' }}
      dateTime={currentTime.toISOString()}
      aria-label={`Текущее время: ${currentTime.toLocaleTimeString('ru-RU')}`}
    >
      Обновлено: {currentTime.toLocaleTimeString('ru-RU')}
    </time>
  );
}
