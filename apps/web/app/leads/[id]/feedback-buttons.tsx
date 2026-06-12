'use client';

import { useTransition, useState } from 'react';
import { updateLeadFeedbackAction } from './actions';
import s from './feedback-buttons.module.css';
import type { ScoreTone } from '../../ui/internal-page';

const BUTTON_CONFIG = [
  { status: 'accepted', label: 'Беру', emoji: '✅', tone: 'success' as ScoreTone },
  { status: 'dismissed', label: 'Мимо', emoji: '👋', tone: 'neutral' as ScoreTone },
  { status: 'later', label: 'Позже', emoji: '⏰', tone: 'warning' as ScoreTone },
  { status: 'contacted', label: 'Написал', emoji: '✉️', tone: 'info' as ScoreTone },
  { status: 'badfit', label: 'Не подходит', emoji: '❌', tone: 'danger' as ScoreTone },
] as const;

interface FeedbackButtonsProps {
  orgId: string;
  clientProfileId: string;
  currentStatus: string;
}

export default function FeedbackButtons({ orgId, clientProfileId, currentStatus }: FeedbackButtonsProps) {
  const [isPending, startTransition] = useTransition();
  const [activeStatus, setActiveStatus] = useState(currentStatus);
  const [error, setError] = useState<string | null>(null);

  function handleClick(status: string) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateLeadFeedbackAction(orgId, clientProfileId, status);
        setActiveStatus(result.feedbackStatus);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ошибка обновления');
      }
    });
  }

  return (
    <div>
      <div className={s.feedbackBtnRow}>
        {BUTTON_CONFIG.map((btn) => {
          const isActive = activeStatus === btn.status;
          return (
            <button
              key={btn.status}
              onClick={() => handleClick(btn.status)}
              disabled={isPending}
              className={s.feedbackBtn}
              data-active={isActive ? "true" : undefined}
              data-tone={isActive ? btn.tone : undefined}
            >
              {btn.emoji} {btn.label}
            </button>
          );
        })}
      </div>
      {error && (
        <p className={s.errorText}>{error}</p>
      )}
    </div>
  );
}
