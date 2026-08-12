'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import { CheckIcon, MotionIcon, XIcon } from '../ui/icons';
import { GATE_LABELS } from '../ui/internal-page';
import s from './leads-filters.module.css';

const GATE_OPTIONS = [
  { value: '', label: 'Все уровни подтверждения' },
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

/**
 * Ephemeral review filters — everything EXCEPT the profile switcher. "Сбросить"
 * wipes only these, so a durable practice choice survives a reset. Kept in its
 * own key set so the reset button and the active-filter highlight stay honest.
 */
const EPHEMERAL_FILTER_KEYS = ['gate', 'feedback', 'today'] as const;

export default function LeadsFilters({ profiles = [] }: { profiles?: ProfileOption[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const currentGate = searchParams.get('gate') ?? '';
  const currentFeedback = searchParams.get('feedback') ?? '';
  const currentProfile = searchParams.get('profile') ?? '';
  const currentToday = searchParams.get('today') === '1';

  const navigate = useCallback(
    (params: URLSearchParams) => {
      const qs = params.toString();
      startTransition(() => {
        router.push(`/leads${qs ? `?${qs}` : ''}`, { scroll: false });
      });
    },
    [router],
  );

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
      navigate(params);
    },
    [navigate, searchParams],
  );

  const toggleToday = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (currentToday) {
      params.delete('today');
    } else {
      params.set('today', '1');
      // "Сегодня в работе" supersedes a single-status feedback filter — clear it
      // so the two don't combine into a confusing narrow slice.
      params.delete('feedback');
    }
    params.delete('page');
    navigate(params);
  }, [navigate, searchParams, currentToday]);

  const resetEphemeral = useCallback(() => {
    // Keep the profile (durable), wipe only the review filters.
    const params = new URLSearchParams(searchParams.toString());
    for (const key of EPHEMERAL_FILTER_KEYS) {
      params.delete(key);
    }
    params.delete('page');
    navigate(params);
  }, [navigate, searchParams]);

  const hasEphemeralFilters =
    currentGate !== '' || currentFeedback !== '' || currentToday;

  return (
    <div className={s.filterBar} aria-busy={isPending}>
      {/* Durable profile choice — survives "Сбросить". Visually separated from
          the ephemeral review filters below so the agency sees profile setup as
          a persistent context, not a today-filter. */}
      {profiles.length > 1 && (
        <div className={s.filterGroup} data-kind="profile">
          <span className={s.filterGroupLabel}>Профиль</span>
          <select
            value={currentProfile}
            disabled={isPending}
            onChange={(e) => updateFilter('profile', e.target.value)}
            className={s.filterSelect}
            aria-label="Фильтр по практике (постоянный профиль)"
          >
            <option value="">Все практики</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {profiles.length > 1 && <div className={s.filterDivider} aria-hidden="true" />}

      {/* Ephemeral review filters — the temporary working view. */}
      <div className={s.filterGroup}>
        <span className={s.filterGroupLabel}>Обзор</span>
        <select
          value={currentGate}
          disabled={isPending}
          onChange={(e) => updateFilter('gate', e.target.value)}
          className={s.filterSelect}
          data-active={currentGate !== '' ? 'true' : undefined}
          aria-label="Фильтр по уровню подтверждения"
        >
          {GATE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          value={currentFeedback}
          disabled={isPending}
          onChange={(e) => updateFilter('feedback', e.target.value)}
          className={s.filterSelect}
          data-active={currentFeedback !== '' ? 'true' : undefined}
          aria-label="Фильтр по обратной связи"
        >
          {FEEDBACK_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={toggleToday}
        disabled={isPending}
        className={s.todayToggle}
        data-motion-interactive
        data-active={currentToday ? 'true' : undefined}
        aria-pressed={currentToday ? 'true' : 'false'}
        title="Лиды, которые вы взяли в работу или по которым уже ответили"
      >
        <MotionIcon
          kind="filter"
          state={isPending ? 'pending' : currentToday ? 'active' : 'idle'}
          className={s.todayToggleIcon}
        >
          <CheckIcon />
        </MotionIcon>
        Сегодня в работе
      </button>

      {hasEphemeralFilters && (
        <button
          type="button"
          onClick={resetEphemeral}
          disabled={isPending}
          className={s.filterReset}
          data-motion-interactive
        >
          <MotionIcon
            kind="reset"
            state={isPending ? 'pending' : 'idle'}
            className={s.filterResetIcon}
          >
            <XIcon />
          </MotionIcon>
          Сбросить фильтры
        </button>
      )}

      <span
        className={s.filterStatus}
        role="status"
        aria-live="polite"
        data-motion-status
      >
        {isPending ? 'Обновляем список…' : ''}
      </span>
    </div>
  );
}
