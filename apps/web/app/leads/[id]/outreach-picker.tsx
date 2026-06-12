'use client';

import { useState, useTransition } from 'react';
import {
  OUTREACH_TEMPLATES,
  renderOutreachTemplate,
  type OutreachContext,
} from '@/lib/outreach-templates';
import { sendOutreachToTelegramAction } from './actions';
import s from './outreach-picker.module.css';

interface OutreachPickerProps {
  context: OutreachContext;
  clientProfileId: string;
}

export default function OutreachPicker({ context, clientProfileId }: OutreachPickerProps) {
  const [selectedId, setSelectedId] = useState(OUTREACH_TEMPLATES[0].id);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [telegramStatus, setTelegramStatus] = useState<'idle' | 'sent' | 'error'>('idle');
  const [telegramError, setTelegramError] = useState<string | null>(null);

  const selected = OUTREACH_TEMPLATES.find((t) => t.id === selectedId) ?? OUTREACH_TEMPLATES[0];
  const rendered = renderOutreachTemplate(selected, context);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(rendered);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = rendered;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleTelegramSend() {
    setTelegramError(null);
    startTransition(async () => {
      const result = await sendOutreachToTelegramAction(clientProfileId, rendered);
      if (result.ok) {
        setTelegramStatus('sent');
        setTimeout(() => setTelegramStatus('idle'), 3000);
      } else {
        setTelegramStatus('error');
        setTelegramError(result.error);
      }
    });
  }

  return (
    <div>
      <div className={s.templateTabs}>
        {OUTREACH_TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => setSelectedId(t.id)}
            className={s.templateTab}
            data-active={t.id === selectedId ? "true" : undefined}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className={s.renderedTemplate}>
        {rendered}
      </div>
      <div className={s.actionBtnGroup}>
        <button
          onClick={handleCopy}
          className={s.actionBtn}
          data-state={copied ? "copied" : undefined}
        >
          {copied ? '✅ Скопировано' : '📋 Копировать'}
        </button>
        <button
          onClick={handleTelegramSend}
          disabled={isPending}
          className={s.actionBtn}
          data-state={telegramStatus === 'sent' ? "sent" : undefined}
        >
          {isPending ? '⏳ Отправка...' : telegramStatus === 'sent' ? '✅ Отправлено в Telegram' : '📩 Отправить в Telegram'}
        </button>
      </div>
      {telegramError && (
        <p className={s.errorText}>{telegramError}</p>
      )}
    </div>
  );
}
