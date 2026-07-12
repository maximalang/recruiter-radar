"use client";

import type { ProfileOption } from "../../lib/clientProfileOptions";
import styles from "./profile-form.module.css";

/**
 * Shared checkbox-chip group for client-profile forms: the /profile
 * editor and the onboarding confirm-profile step. One source of the chip
 * styling + the "nothing selected" hint so the two ICP surfaces never drift.
 *
 * Client component (uses no hooks, but is rendered inside client forms and
 * imports a CSS module — kept "use client" for consistency with the form
 * hosts).
 */
export function CheckboxGroup(props: {
  name: string;
  title: string;
  hint: string;
  options: readonly ProfileOption[];
  selected: readonly string[];
  /** Shown when nothing is selected. Defaults to a soft-boost phrasing. */
  emptyHint?: string;
}) {
  const selectedSet = new Set(props.selected);
  return (
    <fieldset className={styles.group}>
      <div className={styles.groupHead}>
        <span className={styles.groupTitle}>{props.title}</span>
        <span className={styles.groupHint}>{props.hint}</span>
      </div>
      <div className={styles.chips}>
        {props.options.map((opt) => (
          <label key={opt.key} className={styles.chip}>
            <input
              type="checkbox"
              name={props.name}
              value={opt.key}
              defaultChecked={selectedSet.has(opt.key)}
            />
            {opt.label}
          </label>
        ))}
      </div>
      {selectedSet.size === 0 && (
        <span className={styles.groupEmptyHint}>
          {props.emptyHint ?? "Ничего не выбрано — все варианты учитываются без усиления."}
        </span>
      )}
    </fieldset>
  );
}
