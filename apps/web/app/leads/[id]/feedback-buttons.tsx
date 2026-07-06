'use client';

import { useTransition, useState } from 'react';
import { updateLeadFeedbackAction } from './actions';
import s from './feedback-buttons.module.css';

/**
 * Feedback button tone — a superset of the scoring ScoreTone. The CSS supports
 * success / warning / danger / info / neutral, and triage uses all five (info
 * for "в работу", neutral for "мимо", etc.). Kept local so the scoring-only
 * ScoreTone type stays narrow.
 */
type FeedbackTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/**
 * In-app triage state machine — writes ONLY DB-legal `digest_feedback_status`
 * values (none/contacted/replied/won/badfit/snooze/dismissed). The earlier
 * button set emitted `accepted`/`later`, which are not in the enum and threw
 * `invalid input value for enum` on click. See lib/leads-data.ts VALID set.
 *
 * Grouped into the three actions an agency actually performs after seeing a
 * lead, so the workflow reads left-to-right:
 *   - "В работу"   : take the lead into active motion (contacted)
 *   - "Продвижение": advance an in-work lead one step (replied → won)
 *   - "Отложить"   : park or reject without losing the decision (snooze / dismissed / badfit)
 *
 * The active status is highlighted with its group tone. A short optional note
 * can be attached to the "not a fit" decisions (badfit/dismissed) — the DB
 * allows a note for any non-none status, and a one-line "почему мимо" is the
 * single most useful piece of triage context for a future re-run.
 */
type TriageGroup = 'action' | 'progress' | 'park';

interface TriageButton {
  status: 'contacted' | 'replied' | 'won' | 'snooze' | 'dismissed' | 'badfit';
  label: string;
  emoji: string;
  tone: FeedbackTone;
  group: TriageGroup;
  /** Allow an optional one-line note for this status. */
  noteAllowed?: boolean;
}

const BUTTONS: readonly TriageButton[] = [
  { status: 'contacted', label: 'В работу', emoji: '✋', tone: 'info', group: 'action' },
  { status: 'replied', label: 'Ответили', emoji: '💬', tone: 'success', group: 'progress' },
  { status: 'won', label: 'Клиент', emoji: '🤝', tone: 'success', group: 'progress' },
  { status: 'snooze', label: 'Отложить', emoji: '⏰', tone: 'warning', group: 'park' },
  { status: 'dismissed', label: 'Мимо', emoji: '👋', tone: 'neutral', group: 'park' },
  { status: 'badfit', label: 'Не наш профиль', emoji: '❌', tone: 'danger', group: 'park', noteAllowed: true },
];

const GROUP_LABEL: Record<TriageGroup, string> = {
  action: 'В работу',
  progress: 'Продвижение',
  park: 'Отложить',
};

const GROUP_ORDER: readonly TriageGroup[] = ['action', 'progress', 'park'];

interface FeedbackButtonsProps {
  orgId: string;
  clientProfileId: string;
  currentStatus: string;
}

export default function FeedbackButtons({ orgId, clientProfileId, currentStatus }: FeedbackButtonsProps) {
  const [isPending, startTransition] = useTransition();
  const [activeStatus, setActiveStatus] = useState(currentStatus);
  const [error, setError] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');

  function handleClick(status: string, noteAllowed?: boolean) {
    setError(null);
    // For note-allowed statuses, open the note input first instead of committing
    // immediately — the recruiter can add a one-line "почему мимо" or skip it.
    if (noteAllowed && !noteOpen) {
      setNoteOpen(true);
      setActiveStatus(status);
      return;
    }
    startTransition(async () => {
      try {
        const result = await updateLeadFeedbackAction(
          orgId,
          clientProfileId,
          status,
          note.trim() || null,
        );
        setActiveStatus(result.feedbackStatus);
        setNoteOpen(false);
        setNote('');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ошибка обновления');
      }
    });
  }

  function handleSkipNote() {
    setNoteOpen(false);
    setNote('');
    // Commit the pending park status without a note.
    if (activeStatus) {
      handleClick(activeStatus);
    }
  }

  return (
    <div>
      {GROUP_ORDER.map((group) => {
        const groupButtons = BUTTONS.filter((b) => b.group === group);
        return (
          <div key={group} className={s.feedbackGroup}>
            <div className={s.feedbackGroupLabel}>{GROUP_LABEL[group]}</div>
            <div className={s.feedbackBtnRow}>
              {groupButtons.map((btn) => {
                const isActive = activeStatus === btn.status;
                return (
                  <button
                    key={btn.status}
                    onClick={() => handleClick(btn.status, btn.noteAllowed)}
                    disabled={isPending}
                    className={s.feedbackBtn}
                    data-active={isActive ? 'true' : undefined}
                    data-tone={isActive ? btn.tone : undefined}
                    aria-pressed={isActive ? 'true' : 'false'}
                  >
                    {btn.emoji} {btn.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {noteOpen && (
        <div className={s.noteRow}>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Почему не подходит (необязательно)"
            maxLength={200}
            className={s.noteInput}
            aria-label="Заметка к решению"
          />
          <button
            type="button"
            onClick={() => activeStatus && handleClick(activeStatus)}
            disabled={isPending}
            className={s.noteSave}
          >
            Сохранить
          </button>
          <button type="button" onClick={handleSkipNote} disabled={isPending} className={s.noteSkip}>
            Без заметки
          </button>
        </div>
      )}

      {error && <p className={s.errorText}>{error}</p>}
    </div>
  );
}
