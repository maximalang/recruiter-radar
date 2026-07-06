'use client';

import { useState, useTransition } from 'react';
import s from './next-steps-block.module.css';

/**
 * "Дальнейшие шаги" — the operational handoff area on lead detail.
 *
 * Answers the recruiter's question after reading the evidence: "what do I do
 * next?" Three concrete, calm actions, no invented data:
 *   1. Open the company's surfaces (site / career page) — grouped links.
 *   2. Copy a structured CRM-ready block — company, score, gate, INN/ОГРН,
 *      domain, contact path, why-now, evidence, sources — for pasting into a
 *      CRM or a team chat. Pure client-side clipboard; nothing leaves the page.
 *   3. Export this single lead as a CSV row (one-row file) for a quick handoff
 *      without pulling the whole list.
 *
 * The copy block is built server-side and passed in as a string so no lead
 * data crosses the client/server boundary implicitly. This component only
 * handles the clipboard action + the open-links rendering.
 */
interface NextStepsBlockProps {
  /** Pre-rendered CRM-ready plain-text block. */
  crmBlock: string;
  /** Openable company surfaces. Empty array → the links group is hidden. */
  links: { href: string; label: string }[];
  /** Single-lead CSV download href (already includes the lead id). */
  singleExportHref: string;
}

export default function NextStepsBlock({ crmBlock, links, singleExportHref }: NextStepsBlockProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCopy() {
    // Clipboard API with a graceful fallback for non-secure contexts / older
    // browsers. The fallback uses a hidden textarea + execCommand, which is
    // deprecated but still the only synchronous copy path without permissions.
    const onSuccess = () => {
      setCopied(true);
      setCopyError(null);
      setTimeout(() => setCopied(false), 2000);
    };
    const onFailure = () => {
      setCopyError('Не удалось скопировать — выделите текст вручную.');
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(crmBlock).then(onSuccess).catch(() => {
        // Fall back to the legacy path if the async API rejects (e.g. permissions).
        if (legacyCopy(crmBlock)) onSuccess();
        else onFailure();
      });
      return;
    }
    if (legacyCopy(crmBlock)) onSuccess();
    else onFailure();
  }

  function handleDownload() {
    // Navigate to the single-lead CSV endpoint; the browser handles the
    // download via Content-Disposition: attachment.
    startTransition(() => {
      window.location.href = singleExportHref;
    });
  }

  return (
    <div className={s.nextSteps}>
      <div className={s.nextStepsLabel}>Дальнейшие шаги</div>

      {links.length > 0 && (
        <div className={s.nextStepsLinks}>
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className={s.nextStepsLink}
            >
              {l.label} ↗
            </a>
          ))}
        </div>
      )}

      <div className={s.nextStepsActions}>
        <button
          type="button"
          onClick={handleCopy}
          className={s.nextStepsBtn}
          data-variant="primary"
          disabled={isPending}
        >
          {copied ? '✓ Скопировано' : 'Скопировать для CRM'}
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className={s.nextStepsBtn}
          disabled={isPending}
        >
          Экспорт этого лида
        </button>
      </div>

      {copyError && <p className={s.nextStepsError}>{copyError}</p>}

      <details className={s.nextStepsPreview}>
        <summary>Что попадёт в CRM</summary>
        <pre className={s.nextStepsPre}>{crmBlock}</pre>
      </details>
    </div>
  );
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
