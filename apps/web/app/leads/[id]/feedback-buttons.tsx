'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import type { ReactElement, SVGProps } from 'react';
import { updateLeadFeedbackAction } from './actions';
import {
  HandIcon,
  ChatIcon,
  HandshakeIcon,
  ClockIcon,
  WaveIcon,
  XIcon,
  MotionIcon,
} from '../../ui/icons';
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
 *
 * `icon` is an inline-SVG component (app/ui/icons) — the same visual vocabulary
 * used by the feedback badge and the rest of the product, not emoji.
 */
type TriageGroup = 'action' | 'progress' | 'park';

interface TriageButton {
  status: 'contacted' | 'replied' | 'meeting' | 'won' | 'snooze' | 'dismissed' | 'badfit';
  label: string;
  icon: (p: SVGProps<SVGSVGElement>) => ReactElement;
  tone: FeedbackTone;
  group: TriageGroup;
  /** Allow an optional one-line note for this status. */
  noteAllowed?: boolean;
}

const BUTTONS: readonly TriageButton[] = [
  { status: 'contacted', label: 'В работу', icon: HandIcon, tone: 'info', group: 'action' },
  { status: 'replied', label: 'Ответили', icon: ChatIcon, tone: 'success', group: 'progress' },
  { status: 'meeting', label: 'Созвон', icon: ChatIcon, tone: 'success', group: 'progress' },
  { status: 'won', label: 'Клиент', icon: HandshakeIcon, tone: 'success', group: 'progress' },
  { status: 'snooze', label: 'Отложить', icon: ClockIcon, tone: 'warning', group: 'park' },
  { status: 'dismissed', label: 'Мимо', icon: WaveIcon, tone: 'neutral', group: 'park' },
  { status: 'badfit', label: 'Не наш профиль', icon: XIcon, tone: 'danger', group: 'park', noteAllowed: true },
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
  const [, startTransition] = useTransition();
  const [activeStatus, setActiveStatus] = useState(currentStatus);
  const [error, setError] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [confirmedStatus, setConfirmedStatus] = useState<string | null>(null);
  const [failedStatus, setFailedStatus] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const noteInputRef = useRef<HTMLInputElement>(null);
  const draftStatusRef = useRef<string | null>(null);
  const mutationLockRef = useRef(false);
  const feedbackPending = pendingStatus !== null;

  useEffect(() => {
    if (noteOpen) {
      noteInputRef.current?.focus();
    }
  }, [noteOpen]);

  function clearOutcomeState() {
    setError(null);
    setAnnouncement('');
    setConfirmedStatus(null);
    setFailedStatus(null);
  }

  function commitFeedback(status: string, noteValue: string | null) {
    if (mutationLockRef.current) return;

    mutationLockRef.current = true;
    clearOutcomeState();
    setPendingStatus(status);
    startTransition(async () => {
      try {
        const result = await updateLeadFeedbackAction(
          orgId,
          clientProfileId,
          status,
          noteValue,
        );
        const savedButton = BUTTONS.find(
          (button) => button.status === result.feedbackStatus,
        );
        if (!savedButton) {
          throw new Error('Сервер вернул неизвестный статус обратной связи');
        }
        setActiveStatus(result.feedbackStatus);
        draftStatusRef.current = null;
        setNoteOpen(false);
        setNote('');
        setConfirmedStatus(result.feedbackStatus);
        setAnnouncement(`Статус сохранён: ${savedButton.label}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ошибка обновления');
        setFailedStatus(status);
      } finally {
        setPendingStatus(null);
        mutationLockRef.current = false;
      }
    });
  }

  function handleClick(status: string, noteAllowed?: boolean) {
    if (mutationLockRef.current || draftStatusRef.current) return;

    // For note-allowed statuses, open the note input first instead of committing
    // immediately — the recruiter can add a one-line "почему мимо" or skip it.
    if (noteAllowed) {
      clearOutcomeState();
      draftStatusRef.current = status;
      setNoteOpen(true);
      return;
    }
    commitFeedback(status, null);
  }

  function handleSkipNote() {
    if (mutationLockRef.current) return;
    const draftStatus = draftStatusRef.current;
    if (!draftStatus) return;
    commitFeedback(draftStatus, null);
  }

  function handleSaveNote() {
    if (mutationLockRef.current) return;
    const draftStatus = draftStatusRef.current;
    if (!draftStatus) return;
    commitFeedback(draftStatus, note.trim() || null);
  }

  return (
    <div aria-busy={feedbackPending}>
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
                    disabled={feedbackPending || noteOpen}
                    className={s.feedbackBtn}
                    data-motion-interactive
                    data-active={isActive ? 'true' : undefined}
                    data-tone={isActive ? btn.tone : undefined}
                    aria-pressed={isActive ? 'true' : 'false'}
                  >
                    <MotionIcon
                      kind="feedback"
                      state={
                        pendingStatus === btn.status
                          ? 'pending'
                          : failedStatus === btn.status
                            ? 'error'
                            : confirmedStatus === btn.status
                              ? 'success'
                          : isActive
                            ? 'active'
                            : 'idle'
                      }
                      className={s.btnIcon}
                    >
                      <btn.icon />
                    </MotionIcon>{' '}
                    {btn.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {noteOpen && (
        <div className={s.noteRow} data-motion-disclosure>
          <input
            ref={noteInputRef}
            type="text"
            value={note}
            disabled={feedbackPending}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Почему не подходит (необязательно)"
            maxLength={200}
            className={s.noteInput}
            aria-label="Заметка к решению"
          />
          <button
            type="button"
            onClick={handleSaveNote}
            disabled={feedbackPending}
            className={s.noteSave}
          >
            Сохранить
          </button>
          <button type="button" onClick={handleSkipNote} disabled={feedbackPending} className={s.noteSkip}>
            Без заметки
          </button>
        </div>
      )}

      <p className={s.statusText} role="status" aria-live="polite" data-motion-status>
        {feedbackPending ? 'Сохраняем статус…' : announcement}
      </p>
      {error && (
        <p className={s.errorText} role="alert" data-motion-status>
          {error}
        </p>
      )}
    </div>
  );
}
