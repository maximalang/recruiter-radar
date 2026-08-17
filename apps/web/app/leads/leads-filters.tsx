'use client';

import { FormEvent, useCallback, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckIcon, MotionIcon, SearchIcon, XIcon } from '../ui/icons';
import { GATE_LABELS } from '../ui/internal-page';
import s from './leads-filters.module.css';

const GATE_OPTIONS = [
  { value: '', label: 'Все уровни' },
  { value: 'A', label: GATE_LABELS.A },
  { value: 'B', label: GATE_LABELS.B },
  { value: 'C', label: GATE_LABELS.C },
  { value: 'D', label: GATE_LABELS.D },
] as const;

const FEEDBACK_OPTIONS = [
  { value: '', label: 'Все статусы' },
  { value: 'none', label: 'Без обратной связи' },
  { value: 'contacted', label: 'В работе' },
  { value: 'replied', label: 'Ответили' },
  { value: 'won', label: 'Клиент' },
  { value: 'snooze', label: 'Отложено' },
  { value: 'dismissed', label: 'Мимо' },
  { value: 'badfit', label: 'Не наш профиль' },
] as const;

type ProfileOption = { id: string; name: string };
const EPHEMERAL_FILTER_KEYS = ['q', 'gate', 'feedback', 'today'] as const;

export default function LeadsFilters({ profiles = [] }: { profiles?: ProfileOption[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const currentQuery = searchParams.get('q') ?? '';
  const [query, setQuery] = useState(currentQuery);
  const currentGate = searchParams.get('gate') ?? '';
  const currentFeedback = searchParams.get('feedback') ?? '';
  const currentProfile = searchParams.get('profile') ?? '';
  const currentToday = searchParams.get('today') === '1';

  const navigate = useCallback((params: URLSearchParams) => {
    const qs = params.toString();
    startTransition(() => router.push(`/leads${qs ? `?${qs}` : ''}`, { scroll: false }));
  }, [router]);

  const updateFilter = useCallback((key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value); else params.delete(key);
    params.delete('page');
    navigate(params);
  }, [navigate, searchParams]);

  const submitSearch = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateFilter('q', query.trim());
  }, [query, updateFilter]);

  const toggleToday = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (currentToday) params.delete('today');
    else {
      params.set('today', '1');
      params.delete('feedback');
    }
    params.delete('page');
    navigate(params);
  }, [navigate, searchParams, currentToday]);

  const resetEphemeral = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of EPHEMERAL_FILTER_KEYS) params.delete(key);
    params.delete('page');
    setQuery('');
    navigate(params);
  }, [navigate, searchParams]);

  const hasEphemeralFilters = currentQuery !== '' || currentGate !== '' || currentFeedback !== '' || currentToday;

  return (
    <div className={s.filterBar} aria-busy={isPending}>
      <form className={s.search} role="search" onSubmit={submitSearch}>
        <SearchIcon aria-hidden="true" />
        <input
          type="search"
          value={query}
          disabled={isPending}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Компания, роль или сигнал"
          aria-label="Поиск по текущему списку компаний"
        />
      </form>

      {profiles.length > 1 ? (
        <select value={currentProfile} disabled={isPending}
          onChange={(event) => updateFilter('profile', event.target.value)}
          className={s.filterSelect} aria-label="Профиль радара">
          <option value="">Все практики</option>
          {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </select>
      ) : null}

      <select value={currentGate} disabled={isPending}
        onChange={(event) => updateFilter('gate', event.target.value)}
        className={s.filterSelect} aria-label="Уровень подтверждения"
        data-active={currentGate ? 'true' : undefined}>
        {GATE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>

      <select value={currentFeedback} disabled={isPending}
        onChange={(event) => updateFilter('feedback', event.target.value)}
        className={s.filterSelect} aria-label="Статус работы"
        data-active={currentFeedback ? 'true' : undefined}>
        {FEEDBACK_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>

      <button type="button" onClick={toggleToday} disabled={isPending}
        className={s.todayToggle} data-motion-interactive data-active={currentToday ? 'true' : undefined}
        aria-pressed={currentToday} title="Компании, которые вы взяли в работу или по которым уже ответили">
        <MotionIcon kind="filter" state={isPending ? 'pending' : currentToday ? 'active' : 'idle'} className={s.icon}>
          <CheckIcon />
        </MotionIcon>
        Сегодня в работе
      </button>

      {hasEphemeralFilters ? (
        <button type="button" onClick={resetEphemeral} disabled={isPending}
          className={s.filterReset} data-motion-interactive>
          <MotionIcon kind="reset" state={isPending ? 'pending' : 'idle'} className={s.icon}><XIcon /></MotionIcon>
          Сбросить
        </button>
      ) : null}

      <span className={s.filterStatus} role="status" aria-live="polite" data-motion-status>
        {isPending ? 'Обновляем список…' : ''}
      </span>
    </div>
  );
}
