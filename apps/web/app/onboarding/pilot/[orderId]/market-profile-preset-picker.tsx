"use client";

/**
 * Market-profile preset picker (D2 — «Инженерный подбор»).
 *
 * Rendered inside the pilot onboarding confirm-profile <form>. Selecting a
 * preset fills the real form fields (specialization, roles, industries,
 * includeKeywords, remoteFriendly) with the preset criteria, so the user sees
 * and can edit every value before submitting («критерии можно изменить в
 * любой момент»). The chosen preset id travels to the server action as the
 * `marketProfilePreset` radio value and is persisted on the order payload;
 * the criteria themselves persist on the client profile and flow into the
 * query-planner v2 scan parameters through the existing profile → keywords
 * path (buildProfileKeywords → HH_SEARCH_TEXT / SUPERJOB_KEYWORD /
 * RABOTA_ROSSII_SEARCH_TEXT).
 *
 * Pure DOM prefill (no React state over the server-rendered inputs): the form
 * fields are uncontrolled defaultValue inputs owned by the server component,
 * so the picker writes to them directly and never re-renders them.
 */

import { useRef, type ChangeEvent } from "react";

import type { MarketProfilePreset } from "../../../../lib/marketProfilePresets";
import { INDUSTRY_OPTIONS, ROLE_OPTIONS } from "../../../../lib/clientProfileOptions";

import styles from "./market-profile-preset-picker.module.css";

const ROLE_LABELS: ReadonlyMap<string, string> = new Map(
  ROLE_OPTIONS.map((option) => [option.key, option.label]),
);
const INDUSTRY_LABELS: ReadonlyMap<string, string> = new Map(
  INDUSTRY_OPTIONS.map((option) => [option.key, option.label]),
);

function describeKeys(
  keys: readonly string[],
  labels: ReadonlyMap<string, string>,
): string {
  return keys.map((key) => labels.get(key) ?? key).join(", ");
}

function setTextField(form: HTMLFormElement, name: string, value: string): void {
  const element = form.elements.namedItem(name);
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.value = value;
  }
}

function setCheckboxGroup(form: HTMLFormElement, name: string, values: readonly string[]): void {
  const boxes = form.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${name}"]`);
  boxes.forEach((box) => {
    box.checked = values.includes(box.value);
  });
}

function setSingleCheckbox(form: HTMLFormElement, name: string, checked: boolean): void {
  const element = form.elements.namedItem(name);
  if (element instanceof HTMLInputElement && element.type === "checkbox") {
    element.checked = checked;
  }
}

export type MarketProfilePresetPickerProps = {
  presets: readonly MarketProfilePreset[];
  /** Canonical preset id already persisted for this order, or null (custom). */
  selectedPresetId: string | null;
};

export function MarketProfilePresetPicker(props: MarketProfilePresetPickerProps) {
  const rootRef = useRef<HTMLFieldSetElement>(null);

  function applyPresetCriteria(preset: MarketProfilePreset): void {
    const form = rootRef.current?.closest("form");
    if (!form) return;
    setTextField(form, "specialization", preset.criteria.specialization);
    setCheckboxGroup(form, "roles", preset.criteria.roles);
    setCheckboxGroup(form, "industries", preset.criteria.industries);
    setTextField(form, "includeKeywords", preset.criteria.demandSignals.join("\n"));
    setSingleCheckbox(form, "remoteFriendly", preset.criteria.remoteFriendly);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const value = event.target.value;
    const preset = props.presets.find((candidate) => candidate.id === value) ?? null;
    // «Свой профиль» (value="custom") and unknown values never touch the
    // fields — manual criteria stay exactly as the user typed them.
    if (preset) applyPresetCriteria(preset);
  }

  return (
    <fieldset className={styles.picker} ref={rootRef} data-testid="market-profile-preset-picker">
      <legend className={styles.title}>Профиль рынка</legend>
      <p className={styles.hint}>
        Пресет заполняет нишу, роли, географию и признаки спроса — каждое значение можно
        изменить в блоке «Уточнить профиль».
      </p>
      <div className={styles.options}>
        {props.presets.map((preset) => (
          <label key={preset.id} className={styles.option} data-preset-id={preset.id}>
            <input
              type="radio"
              name="marketProfilePreset"
              value={preset.id}
              defaultChecked={props.selectedPresetId === preset.id}
              onChange={handleChange}
            />
            <span className={styles.optionBody}>
              <span className={styles.optionLabel}>{preset.label}</span>
              <span className={styles.optionDescription}>{preset.description}</span>
              <span className={styles.criteria}>
                <span className={styles.chip}>Ниша: {preset.criteria.specialization}</span>
                <span className={styles.chip}>
                  Роли: {describeKeys(preset.criteria.roles, ROLE_LABELS)}
                </span>
                <span className={styles.chip}>География: {preset.geographyLabel}</span>
                <span className={styles.chip}>
                  Признаки спроса: {preset.criteria.demandSignals.join(", ")}
                </span>
              </span>
            </span>
          </label>
        ))}
        <label className={styles.option} data-preset-id="custom">
          <input
            type="radio"
            name="marketProfilePreset"
            value="custom"
            defaultChecked={props.selectedPresetId === null}
            onChange={handleChange}
          />
          <span className={styles.optionBody}>
            <span className={styles.optionLabel}>Свой профиль</span>
            <span className={styles.optionDescription}>Заполнить критерии вручную.</span>
          </span>
        </label>
      </div>
    </fieldset>
  );
}
