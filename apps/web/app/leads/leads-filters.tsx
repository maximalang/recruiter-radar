'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import s from './leads-filters.module.css';

const GATE_OPTIONS = [
  { value: '', label: 'Все уровни доверия' },
  { value: 'A', label: 'Авто (A)' },
  { value: 'B', label: 'Авто с меткой (B)' },
  { value: 'C', label: 'На проверке (C)' },
  { value: 'D', label: 'Не доставлять (D)' },
] as const;

const FEEDBACK_OPTIONS = [
  { value: '', label: 'Все статусы' },
  { value: 'none', label: 'Без обратной связи' },
  { value: 'accepted', label: 'Беру' },
  { value: 'dismissed', label: 'Мимо' },
  { value: 'later', label: 'Позже' },
  { value: 'contacted', label: 'Написал' },
  { value: 'replied', label: 'Ответили' },
  { value: 'call', label: 'Созвон' },
  { value: 'client', label: 'Клиент' },
  { value: 'badfit', label: 'Не подходит' },
] as const;

type ProfileOption = { id: string; name: string };

export default function LeadsFilters({ profiles = [] }: { profiles?: ProfileOption[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentGate = searchParams.get('gate') ?? '';
  const currentFeedback = searchParams.get('feedback') ?? '';
  const currentProfile = searchParams.get('profile') ?? '';

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      // Reset to page 1 when filter changes
      params.delete('page');
      const qs = params.toString();
      router.push(`/leads${qs ? `?${qs}` : ''}`, { scroll: false });
    },
    [router, searchParams],
  );

  return (
    <div className={s.filterBar}>
      {profiles.length > 1 && (
        <select
          value={currentProfile}
          onChange={(e) => updateFilter('profile', e.target.value)}
          className={s.filterSelect}
          aria-label="Фильтр по практике"
        >
          <option value="">Все практики</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      <select
        value={currentGate}
        onChange={(e) => updateFilter('gate', e.target.value)}
        className={s.filterSelect}
        aria-label="Фильтр по уровню доверия"
      >
        {GATE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <select
        value={currentFeedback}
        onChange={(e) => updateFilter('feedback', e.target.value)}
        className={s.filterSelect}
        aria-label="Фильтр по обратной связи"
      >
        {FEEDBACK_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {(currentGate || currentFeedback || currentProfile) && (
        <button
          onClick={() => router.push('/leads', { scroll: false })}
          className={s.filterReset}
        >
          Сбросить
        </button>
      )}
    </div>
  );
}
