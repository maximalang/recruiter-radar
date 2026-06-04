'use client';

import { useState, useTransition } from 'react';
import {
  OUTREACH_TEMPLATES,
  renderOutreachTemplate,
  type OutreachContext,
} from '@/lib/outreach-templates';
import { sendOutreachToTelegramAction } from './actions';

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
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {OUTREACH_TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => setSelectedId(t.id)}
            style={{
              padding: '4px 10px',
              borderRadius: '6px',
              fontSize: '0.75rem',
              fontWeight: 500,
              border: t.id === selectedId ? '2px solid #3b82f6' : '1px solid #d1d5db',
              backgroundColor: t.id === selectedId ? '#eff6ff' : '#fff',
              color: t.id === selectedId ? '#1e40af' : '#374151',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        style={{
          padding: '12px',
          borderRadius: '6px',
          backgroundColor: '#f9fafb',
          border: '1px solid #e5e7eb',
          fontSize: '0.85rem',
          lineHeight: 1.6,
          color: '#374151',
          whiteSpace: 'pre-wrap',
          marginBottom: '8px',
        }}
      >
        {rendered}
      </div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button
          onClick={handleCopy}
          style={{
            padding: '6px 14px',
            borderRadius: '6px',
            fontSize: '0.8rem',
            fontWeight: 500,
            border: '1px solid #d1d5db',
            backgroundColor: copied ? '#d1fae5' : '#fff',
            color: copied ? '#065f46' : '#374151',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
        >
          {copied ? '✅ Скопировано' : '📋 Копировать'}
        </button>
        <button
          onClick={handleTelegramSend}
          disabled={isPending}
          style={{
            padding: '6px 14px',
            borderRadius: '6px',
            fontSize: '0.8rem',
            fontWeight: 500,
            border: '1px solid #d1d5db',
            backgroundColor: telegramStatus === 'sent' ? '#dbeafe' : '#fff',
            color: telegramStatus === 'sent' ? '#1e40af' : '#374151',
            cursor: isPending ? 'not-allowed' : 'pointer',
            opacity: isPending ? 0.6 : 1,
            transition: 'all 0.15s',
          }}
        >
          {isPending ? '⏳ Отправка...' : telegramStatus === 'sent' ? '✅ Отправлено в Telegram' : '📩 Отправить в Telegram'}
        </button>
      </div>
      {telegramError && (
        <p style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: '6px' }}>
          {telegramError}
        </p>
      )}
    </div>
  );
}
