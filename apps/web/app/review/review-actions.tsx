'use client';

import { useTransition, useState } from 'react';

export default function ReviewActions({
  candidateId,
  clientProfileId,
}: {
  candidateId: string;
  clientProfileId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<'idle' | 'approved' | 'rejected' | 'error'>('idle');

  const handleAction = (action: 'approve' | 'reject') => {
    startTransition(async () => {
      try {
        const res = await fetch('/api/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            candidateId,
            clientProfileId,
            action,
          }),
        });

        if (res.ok) {
          setStatus(action === 'approve' ? 'approved' : 'rejected');
        } else {
          setStatus('error');
        }
      } catch {
        setStatus('error');
      }
    });
  };

  const btnBase: React.CSSProperties = {
    padding: '4px 10px',
    borderRadius: '6px',
    border: '1px solid var(--c-border)',
    background: 'var(--c-surface)',
    color: 'var(--c-text)',
    cursor: 'pointer',
    fontSize: '0.8rem',
    fontWeight: 500,
    transition: 'all 0.15s ease',
  };

  if (status === 'approved' || status === 'rejected') {
    return (
      <span style={{ fontSize: '0.8rem', color: 'var(--c-text-muted)', fontWeight: 500 }}>
        {status === 'approved' ? '✅ Одобрено' : '❌ Отклонено'}
      </span>
    );
  }

  if (status === 'error') {
    return (
      <span style={{ fontSize: '0.8rem', color: '#e53e3e' }}>
        Ошибка{' '}
        <button
          style={btnBase}
          onClick={() => setStatus('idle')}
          disabled={isPending}
        >
          Повторить
        </button>
      </span>
    );
  }

  return (
    <div style={{ display: 'flex', gap: '6px' }}>
      <button
        style={btnBase}
        onClick={() => handleAction('approve')}
        disabled={isPending}
        title="Одобрить — лид будет доставлен клиенту"
      >
        ✅ Одобрить
      </button>
      <button
        style={btnBase}
        onClick={() => handleAction('reject')}
        disabled={isPending}
        title="Отклонить — лид не будет доставлен"
      >
        ❌ Отклонить
      </button>
    </div>
  );
}
