import type { ProfileCompletion } from "@/lib/profileCompletion";
import { CheckIcon, CircleIcon, SearchIcon } from "../../ui/icons";
import s from "./profile-completion-panel.module.css";

/**
 * Profile-completion panel for /settings/profile.
 *
 * Shows two honest signals so a user knows whether their radar is well-targeted
 * BEFORE waiting a full digest cycle:
 *   1. a completion progress bar + per-group checklist (which filters are filled);
 *   2. a live match-count preview — "≈N компаний сейчас подходят" — computed from
 *      the current candidate pool against the saved filters.
 *
 * The checklist uses the unified SVG icon system: a filled group shows the
 * brand-tone CheckIcon, an unfilled group shows the muted CircleIcon — no
 * literal "✓"/"○" character glyphs. The match-count preview leads with a
 * semantic SearchIcon so it reads as "проверка радара", not a debug readout.
 *
 * Server-rendered display only (no client state). `matchCount` is null when it
 * could not be computed (no DB), in which case the preview line is omitted.
 */

export default function ProfileCompletionPanel(props: {
  completion: ProfileCompletion;
  matchCount: { count: number; capped: boolean } | null;
  /** Hours until the next scheduled digest, for the save-confirmation hint. */
  nextDigestHours?: number | null;
}) {
  const { completion, matchCount } = props;
  const pct = Math.round(completion.ratio * 100);

  return (
    <div className={s.panel}>
      <div className={s.head}>
        <span className={s.title}>Профиль заполнен</span>
        <span className={s.count}>
          {completion.filledCount} из {completion.totalCount}
        </span>
      </div>

      <div className={s.barTrack} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={s.barFill} style={{ width: `${pct}%` }} data-complete={completion.isComplete || undefined} />
      </div>

      <ul className={s.checklist}>
        {completion.groups.map((g) => (
          <li key={g.key} className={s.checkItem} data-filled={g.filled || undefined}>
            <span className={s.checkIcon} aria-hidden="true">
              {g.filled ? <CheckIcon /> : <CircleIcon />}
            </span>
            {g.label}
          </li>
        ))}
      </ul>

      {matchCount !== null && (
        <div className={s.preview}>
          {matchCount.count > 0 ? (
            <p className={s.previewText}>
              <SearchIcon className={s.previewIcon} aria-hidden="true" /> С текущими
              настройками подходят{" "}
              <strong>
                ≈{matchCount.count}
                {matchCount.capped ? "+" : ""}
              </strong>{" "}
              {pluralizeCompanies(matchCount.count)} прямо сейчас.
            </p>
          ) : (
            <p className={s.previewEmpty}>
              <SearchIcon className={s.previewIcon} aria-hidden="true" /> Пока ни
              одной подходящей компании — возможно, фильтры слишком узкие.
              Ослабьте пороги или добавьте роли и отрасли.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Russian plural for "компания" (1 / 2–4 / 5+), nominative count phrasing. */
function pluralizeCompanies(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "компания";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "компании";
  return "компаний";
}
