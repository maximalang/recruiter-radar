'use client';

import { useTransition, useState } from 'react';
import { CheckIcon, XIcon } from '../ui/icons';
import s from './review-actions.module.css';

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

  if (status === 'approved' || status === 'rejected') {
    return (
      <span className={s.verdict} data-tone={status === 'approved' ? 'success' : 'danger'}>
        {status === 'approved' ? <CheckIcon className={s.btnIcon} /> : <XIcon className={s.btnIcon} />}
        {status === 'approved' ? 'Одобрено' : 'Отклонено'}
      </span>
    );
  }

  if (status === 'error') {
    return (
      <span className={s.error}>
        Ошибка{' '}
        <button
          className={s.btn}
          onClick={() => setStatus('idle')}
          disabled={isPending}
        >
          Повторить
        </button>
      </span>
    );
  }

  return (
    <div className={s.row}>
      <button
        className={s.btn}
        data-tone="success"
        onClick={() => handleAction('approve')}
        disabled={isPending}
        title="Одобрить — лид будет доставлен клиенту"
      >
        <CheckIcon className={s.btnIcon} /> Одобрить
      </button>
      <button
        className={s.btn}
        data-tone="danger"
        onClick={() => handleAction('reject')}
        disabled={isPending}
        title="Отклонить — лид не будет доставлен"
      >
        <XIcon className={s.btnIcon} /> Отклонить
      </button>
    </div>
  );
}
