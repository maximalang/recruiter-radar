'use client';

import { useTransition, useState } from 'react';
import { updateLeadFeedbackAction } from './actions';

const BUTTON_CONFIG = [
  { status: 'accepted', label: 'Беру', emoji: '✅', color: '#10b981' },
  { status: 'dismissed', label: 'Мимо', emoji: '👋', color: '#6b7280' },
  { status: 'later', label: 'Позже', emoji: '⏰', color: '#f59e0b' },
  { status: 'contacted', label: 'Написал', emoji: '✉️', color: '#3b82f6' },
  { status: 'badfit', label: 'Не подходит', emoji: '❌', color: '#ef4444' },
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
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
        {BUTTON_CONFIG.map((btn) => {
          const isActive = activeStatus === btn.status;
          return (
            <button
              key={btn.status}
              onClick={() => handleClick(btn.status)}
              disabled={isPending}
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '0.75rem',
                fontWeight: 500,
                border: isActive ? `2px solid ${btn.color}` : '1px solid #d1d5db',
                backgroundColor: isActive ? `${btn.color}18` : '#fff',
                color: isActive ? btn.color : '#374151',
                cursor: isPending ? 'not-allowed' : 'pointer',
                opacity: isPending ? 0.6 : 1,
                transition: 'all 0.15s',
              }}
            >
              {btn.emoji} {btn.label}
            </button>
          );
        })}
      </div>
      {error && (
        <p style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: '6px' }}>
          {error}
        </p>
      )}
    </div>
  );
}
