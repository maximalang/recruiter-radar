'use client';

import { useState } from 'react';

import type { StoredOpenerDraft } from '@/lib/ai/opener/openerDraftStore';
import {
  confirmOpenerDraftAction,
  generateOpenerDraftAction,
  saveOpenerDraftEditsAction,
} from './opener-actions';
import s from './opener-draft-block.module.css';

/** Product cap for a first-touch opener — mirrors MAX_OPENER_DRAFT_CHARS. */
const MAX_CHARS = 450;

interface OpenerDraftBlockProps {
  /** Digest-candidate id the draft belongs to. */
  candidateId: string;
  /** Stored draft from the server render; null when none was generated yet. */
  initialDraft: StoredOpenerDraft | null;
}

/**
 * D3 — AI draft-opener on the lead detail page (owner directive 2026-10-01).
 *
 * Flow: generate → edit → human confirm → manual clipboard copy. The product
 * NEVER sends anything: the only exit is the copy button, which appears only
 * after an explicit confirmation of the exact saved text, and editing after
 * confirmation resets it (the server drops status back to 'draft').
 *
 * The block is attributed as AI, advisory, and fact-bounded (boundary.ts
 * draft-opener capability); it never renders inside or next to the score/gate
 * evidence as if it were evidence.
 */
export default function OpenerDraftBlock({ candidateId, initialDraft }: OpenerDraftBlockProps) {
  const [draft, setDraft] = useState<StoredOpenerDraft | null>(initialDraft);
  const [text, setText] = useState(initialDraft?.currentText ?? '');
  const [busy, setBusy] = useState<'generate' | 'save' | 'confirm' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const dirty = draft !== null && text !== draft.currentText;
  const confirmed = draft?.status === 'confirmed';

  async function run(
    kind: 'generate' | 'save' | 'confirm',
    action: () => Promise<StoredOpenerDraft>,
  ) {
    setBusy(kind);
    setError(null);
    try {
      const updated = await action();
      setDraft(updated);
      setText(updated.currentText);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка. Попробуйте ещё раз.');
    } finally {
      setBusy(null);
    }
  }

  function handleCopy() {
    // Copy is the ONLY "send": client-side clipboard, gated on a confirmed
    // draft. Same graceful fallback as next-steps-block (non-secure contexts).
    if (!draft || draft.status !== 'confirmed') return;
    const value = draft.currentText;
    const onSuccess = () => {
      setCopied(true);
      setCopyError(null);
      setTimeout(() => setCopied(false), 2000);
    };
    const onFailure = () => {
      setCopyError('Не удалось скопировать — выделите текст вручную.');
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(value).then(onSuccess).catch(() => {
        if (legacyCopy(value)) onSuccess();
        else onFailure();
      });
      return;
    }
    if (legacyCopy(value)) onSuccess();
    else onFailure();
  }

  return (
    <section className={s.opener} aria-labelledby="ai-opener-title">
      <h2 id="ai-opener-title">Черновик первого сообщения (ИИ)</h2>
      <p className={s.disclaimer}>
        Текст предлагает ИИ на основе фактов лида; это черновик, не факт и не оценка сигнала.
        Продукт ничего не отправляет автоматически: сгенерируйте, отредактируйте, подтвердите
        и скопируйте текст — отправка полностью ручная. Проверьте факты перед использованием.
      </p>

      {!draft ? (
        <div className={s.actions}>
          <button
            type="button"
            className={s.btn}
            data-variant="primary"
            disabled={busy !== null}
            onClick={() => run('generate', () => generateOpenerDraftAction(candidateId))}
          >
            {busy === 'generate' ? 'Генерация…' : 'Сгенерировать черновик'}
          </button>
        </div>
      ) : (
        <>
          <textarea
            className={s.editor}
            value={text}
            rows={6}
            maxLength={MAX_CHARS}
            aria-label="Текст черновика первого сообщения"
            disabled={busy !== null}
            onChange={(event) => setText(event.target.value)}
          />
          <div className={s.statusRow}>
            <span className={s.status} data-status={draft.status}>
              {confirmed ? 'Подтверждён' : 'Черновик'}
            </span>
            <span className={s.counter}>
              {text.length}/{MAX_CHARS}
            </span>
          </div>
          {confirmed && dirty ? (
            <p className={s.hint}>
              Сохраните правки: подтверждение сбрасывается, изменённый текст нужно подтвердить заново.
            </p>
          ) : null}
          <div className={s.actions}>
            <button
              type="button"
              className={s.btn}
              disabled={busy !== null || !dirty}
              onClick={() => run('save', () => saveOpenerDraftEditsAction(candidateId, text))}
            >
              {busy === 'save' ? 'Сохранение…' : 'Сохранить правки'}
            </button>
            <button
              type="button"
              className={s.btn}
              data-variant="primary"
              disabled={busy !== null || dirty || confirmed}
              onClick={() => run('confirm', () => confirmOpenerDraftAction(candidateId))}
            >
              {busy === 'confirm' ? 'Подтверждение…' : 'Подтвердить'}
            </button>
            <button
              type="button"
              className={s.btn}
              disabled={busy !== null}
              onClick={() => run('generate', () => generateOpenerDraftAction(candidateId))}
            >
              {busy === 'generate' ? 'Генерация…' : 'Сгенерировать заново'}
            </button>
            {confirmed && !dirty ? (
              <button type="button" className={s.btn} onClick={handleCopy}>
                {copied ? 'Скопировано' : 'Скопировать текст'}
              </button>
            ) : null}
          </div>
          <p className={s.provenance}>
            ИИ: {draft.provider || 'провайдер не указан'}
            {draft.model ? ` · ${draft.model}` : ''}
            {draft.promptVersion ? ` · ${draft.promptVersion}` : ''}
            {draft.generatedAt ? ` · сгенерировано ${formatStamp(draft.generatedAt)}` : ''}
            {draft.editedAt ? ` · отредактировано ${formatStamp(draft.editedAt)}` : ''}
            {draft.confirmedAt ? ` · подтверждено ${formatStamp(draft.confirmedAt)}` : ''}
          </p>
        </>
      )}

      {copyError ? <p className={s.error}>{copyError}</p> : null}
      {error ? (
        <p className={s.error} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** Hydration-safe ISO stamp (no locale formatting during SSR). */
function formatStamp(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
