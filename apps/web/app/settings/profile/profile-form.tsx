"use client";

import { useActionState } from "react";

import type { ClientProfile } from "../../../lib/clientProfiles";
import {
  INDUSTRY_OPTIONS,
  COMPANY_SIZE_OPTIONS,
  ROLE_OPTIONS,
  CONTACT_POLICY_OPTIONS,
  type ProfileOption,
} from "../../../lib/clientProfileOptions";
import { FormSubmitButton } from "../../ui/form-submit-button";
import { NoticeBox } from "../../ui/page-primitives";
import ppStyles from "../../ui/page-primitives.module.css";
import { saveSettingsProfileAction, type SaveProfileResult } from "./actions";
import styles from "./profile-form.module.css";

/** One entry per line — mirrors how the action parses these textareas back. */
function toLines(values: readonly string[]): string {
  return values.join("\n");
}

function CheckboxGroup(props: {
  name: string;
  title: string;
  hint: string;
  options: readonly ProfileOption[];
  selected: readonly string[];
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
        <span className={styles.groupEmptyHint}>Фильтр не настроен — учитываются все варианты.</span>
      )}
    </fieldset>
  );
}

export function ProfileForm(props: { profile: ClientProfile }) {
  const { profile } = props;
  const [state, formAction] = useActionState<SaveProfileResult | null, FormData>(
    saveSettingsProfileAction,
    null
  );

  return (
    <form action={formAction} className={styles.form}>
      {state?.ok === true ? (
        <NoticeBox tone="success" title="Профиль сохранён" description="Новые фильтры применятся к следующей подборке. Превью совпадений выше обновится после перезагрузки страницы." />
      ) : null}
      {state?.ok === false ? (
        <NoticeBox tone="danger" title="Не удалось сохранить" description={state.error} />
      ) : null}

      {/* Agency identity + cadence */}
      <fieldset className={styles.group}>
        <div className={styles.groupHead}>
          <span className={styles.groupTitle}>Агентство</span>
          <span className={styles.groupHint}>Как вас называть и сколько компаний показывать в одной подборке.</span>
        </div>
        <div className={styles.twoCol}>
          <label className={ppStyles.field}>
            <span className={ppStyles.fieldLabel}>Название агентства</span>
            <input className={ppStyles.input} name="agencyName" defaultValue={profile.agencyName} required />
          </label>
          <label className={ppStyles.field}>
            <span className={ppStyles.fieldLabel}>Компаний в подборке</span>
            <input
              className={ppStyles.input}
              name="dailyDigestLimit"
              type="number"
              min={1}
              max={10}
              defaultValue={profile.dailyDigestLimit}
            />
            <span className={ppStyles.helperText}>От 1 до 10 компаний в одной подборке.</span>
          </label>
        </div>
      </fieldset>

      {/* Roles — drives Fit scoring AND boosts within-digest ranking (not a hard filter) */}
      <CheckboxGroup
        name="roles"
        title="Роли, которые вы закрываете"
        hint="Поднимает компании с релевантным наймом выше в подборке и усиливает их скоринг."
        options={ROLE_OPTIONS}
        selected={profile.roles}
      />

      {/* Industries served */}
      <CheckboxGroup
        name="industries"
        title="Отрасли клиентов"
        hint="Усиливает компании из этих отраслей в подборке. Пусто — без отраслевого предпочтения."
        options={INDUSTRY_OPTIONS}
        selected={profile.industries}
      />

      {/* Company sizes */}
      <CheckboxGroup
        name="companySizes"
        title="Размер компаний"
        hint="Поднимает компании подходящего размера выше в подборке."
        options={COMPANY_SIZE_OPTIONS}
        selected={profile.companySizes}
      />

      {/* Targeting thresholds — data-backed hard filters (Block 2) */}
      <fieldset className={styles.group}>
        <div className={styles.groupHead}>
          <span className={styles.groupTitle}>Пороги качества сигнала</span>
          <span className={styles.groupHint}>
            Жёсткие фильтры по силе и свежести найма. Пусто — порог не применяется.
          </span>
        </div>
        <div className={styles.threeCol}>
          <label className={ppStyles.field}>
            <span className={ppStyles.fieldLabel}>Мин. сила сигнала</span>
            <input
              className={ppStyles.input}
              name="hiringIntentMin"
              type="number"
              min={0}
              max={4}
              step={0.1}
              defaultValue={profile.hiringIntentMin ?? ""}
              placeholder="напр. 2.5"
            />
            <span className={ppStyles.helperText}>FIUR-оценка 0–4. Отсекает слабые лиды.</span>
          </label>
          <label className={ppStyles.field}>
            <span className={ppStyles.fieldLabel}>Свежесть сигнала, дней</span>
            <input
              className={ppStyles.input}
              name="signalFreshnessDays"
              type="number"
              min={1}
              step={1}
              defaultValue={profile.signalFreshnessDays ?? ""}
              placeholder="напр. 14"
            />
            <span className={ppStyles.helperText}>Не старше N дней. Без даты — оставляем.</span>
          </label>
          <label className={ppStyles.field}>
            <span className={ppStyles.fieldLabel}>Мин. открытых ролей</span>
            <input
              className={ppStyles.input}
              name="minOpenRoles"
              type="number"
              min={0}
              step={1}
              defaultValue={profile.minOpenRoles ?? ""}
              placeholder="напр. 2"
            />
            <span className={ppStyles.helperText}>Минимум распознанных вакансий.</span>
          </label>
        </div>
      </fieldset>

      {/* Geography + remote */}
      <fieldset className={styles.group}>
        <div className={styles.groupHead}>
          <span className={styles.groupTitle}>Регионы</span>
          <span className={styles.groupHint}>Где вы работаете и как относитесь к удалённым компаниям.</span>
        </div>
        <div className={styles.twoCol}>
          <label className={ppStyles.field}>
            <span className={ppStyles.fieldLabel}>Основной регион</span>
            <input className={ppStyles.input} name="targetCity" defaultValue={profile.targetCity ?? ""} placeholder="Москва" />
          </label>
          <label className={ppStyles.field}>
            <span className={ppStyles.fieldLabel}>Специализация</span>
            <input className={ppStyles.input} name="specialization" defaultValue={profile.specialization ?? ""} placeholder="IT-рекрутмент" />
          </label>
        </div>
        <label className={styles.toggle}>
          <input type="checkbox" name="remoteFriendly" defaultChecked={profile.remoteFriendly} />
          Готовы работать с удалёнными компаниями вне основного региона
        </label>
        <label className={ppStyles.field}>
          <span className={ppStyles.fieldLabel}>Исключённые регионы</span>
          <textarea
            className={ppStyles.textarea}
            name="excludedLocations"
            rows={3}
            defaultValue={toLines(profile.excludedLocations)}
          />
          <span className={ppStyles.helperText}>По одному региону на строку. Компании из этих регионов не появятся в радаре.</span>
        </label>
      </fieldset>

      {/* Contact policy — gates reachability/delivery */}
      <fieldset className={styles.group}>
        <div className={styles.groupHead}>
          <span className={styles.groupTitle}>Политика контакта</span>
          <span className={styles.groupHint}>Определяет, какой путь контакта мы считаем безопасным. «Только корпоративные» отсекает лиды без корпоративной поверхности.</span>
        </div>
        <label className={ppStyles.field}>
          <select className={ppStyles.input} name="contactPolicy" defaultValue={profile.contactPolicy}>
            {CONTACT_POLICY_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>{opt.label}</option>
            ))}
          </select>
        </label>
      </fieldset>

      {/* Keyword include / exclude */}
      <fieldset className={styles.group}>
        <div className={styles.groupHead}>
          <span className={styles.groupTitle}>Ключевые фразы</span>
          <span className={styles.groupHint}>Точная настройка: какие сигналы усиливать, а какие исключать из радара.</span>
        </div>
        <div className={styles.twoCol}>
          <label className={ppStyles.field}>
            <span className={ppStyles.fieldLabel}>Усиливать</span>
            <textarea
              className={ppStyles.textarea}
              name="includeKeywords"
              rows={4}
              defaultValue={toLines(profile.includeKeywords)}
            />
            <span className={ppStyles.helperText}>По одной фразе на строку.</span>
          </label>
          <label className={ppStyles.field}>
            <span className={ppStyles.fieldLabel}>Исключать</span>
            <textarea
              className={ppStyles.textarea}
              name="excludeKeywords"
              rows={4}
              defaultValue={toLines(profile.excludeKeywords)}
            />
            <span className={ppStyles.helperText}>Компании с этими фразами не попадут в радар.</span>
          </label>
        </div>
      </fieldset>

      {/* Excluded industries */}
      <CheckboxGroup
        name="excludedIndustries"
        title="Отрасли, с которыми не работаете"
        hint="Жёсткое исключение: такие компании не попадут в радар, даже при сильном сигнале найма."
        options={INDUSTRY_OPTIONS}
        selected={profile.excludedIndustries}
      />

      <div className={styles.submitRow}>
        <FormSubmitButton idleLabel="Сохранить профиль" pendingLabel="Сохраняем..." className={ppStyles.primaryAction} />
        <span className={ppStyles.helperText}>Изменения применяются к следующей подборке.</span>
      </div>
    </form>
  );
}
