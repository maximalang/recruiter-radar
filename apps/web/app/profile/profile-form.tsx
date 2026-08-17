"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import type { ClientProfile } from "../../lib/clientProfiles";
import {
  INDUSTRY_OPTIONS,
  COMPANY_SIZE_OPTIONS,
  ROLE_OPTIONS,
  CONTACT_POLICY_OPTIONS,
  HIRING_MODE_OPTIONS,
  RESOLVED_HIRING_MODE_LABEL,
} from "../../lib/clientProfileOptions";
import { FormSubmitButton } from "../ui/form-submit-button";
import { NoticeBox } from "../ui/page-primitives";
import ppStyles from "../ui/page-primitives.module.css";
import { saveSettingsProfileAction, type SaveProfileResult } from "./actions";
import { modeIcon } from "./profile-form-helpers";
import { CheckboxGroup } from "./checkbox-group";
import styles from "./profile-form.module.css";

/** One entry per line — mirrors how the action parses these textareas back. */
function toLines(values: readonly string[]): string {
  return values.join("\n");
}

/** Russian plural for "компания" (1 / 2–4 / 5+), nominative count phrasing. */
function pluralizeCompanies(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "компания";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "компании";
  return "компаний";
}

/**
 * Save-confirmation copy, honest about the radar's current state:
 *  - matchCount === 0 → filters are too strict and the radar is empty (warn);
 *  - matchCount > 0   → name the approximate pool so the agency trusts the save;
 *  - matchCount null  → the count could not be computed; fall back to the generic
 *    "applies to the next digest" message without claiming a number.
 * The match count uses the same gate path as the digest, so the number reflects
 * exactly what the saved filters do — not a loose estimate.
 */
function describeSaveOutcome(
  matchCount: { count: number; capped: boolean } | null,
): string {
  if (matchCount === null) {
    return "Новые фильтры применятся к следующей подборке.";
  }
  if (matchCount.count === 0) {
    return "Пороги слишком строгие — по текущему профилю радар пуст. Ослабьте пороги в блоке «Точная настройка» или добавьте роли и отрасли.";
  }
  return `Новые фильтры применятся к следующей подборке. Сейчас подходят ≈${matchCount.count}${matchCount.capped ? "+" : ""} ${pluralizeCompanies(matchCount.count)}.`;
}

export function ProfileForm(props: {
  profile: ClientProfile;
  /**
   * Effective hiring mode after 'auto' is resolved from the agency's roles.
   * Shown as a "currently active" badge so the agency sees what the radar is
   * actually doing, not just which radio card is checked. Never 'auto'.
   */
  resolvedHiringMode: 'specialist' | 'executive' | 'volume';
}) {
  const { profile, resolvedHiringMode } = props;
  const [state, formAction] = useActionState<SaveProfileResult | null, FormData>(
    saveSettingsProfileAction,
    null
  );
  const router = useRouter();

  // After a successful save, re-fetch the server-rendered parts of the page
  // (completion panel + live match-count preview above the form) so the agency
  // sees the effect of their edits without a manual reload. The form itself keeps
  // its client-side state; only the surrounding server components refresh.
  useEffect(() => {
    if (state?.ok === true) {
      router.refresh();
    }
  }, [state, router]);

  // The effective mode is "auto-chosen" when the agency left hiringMode on
  // 'auto' (the default) — the badge names the inferred mode so the inference is
  // visible and trustable. Otherwise the agency picked the mode explicitly.
  const modeIsAuto = (profile.hiringMode ?? 'auto') === 'auto';
  const resolvedLabel = RESOLVED_HIRING_MODE_LABEL[resolvedHiringMode];

  return (
    <form action={formAction} className={styles.form}>
      {state?.ok === true ? (
        <NoticeBox
          tone="success"
          title="Профиль сохранён"
          description={describeSaveOutcome(state.matchCount)}
        />
      ) : null}
      {state?.ok === false ? (
        <NoticeBox tone="danger" title="Не удалось сохранить" description={state.error} />
      ) : null}

      {/* Group 1 — Agency identity. Just who you are; volume lives in its own
          group at the bottom so it isn't conflated with the name. */}
      <fieldset className={styles.group} id="agency">
        <div className={styles.groupHead}>
          <span className={styles.groupTitle}>Агентство</span>
          <span className={styles.groupHint}>Как вас называть в радаре.</span>
        </div>
        <label className={ppStyles.field}>
          <span className={ppStyles.fieldLabel}>Название агентства</span>
          <input className={ppStyles.input} name="agencyName" defaultValue={profile.agencyName} required />
        </label>
      </fieldset>

      {/* Group 2 — Practice + roles. These belong together: the mode decides HOW
          roles are weighted (executive → seniority, volume → raw count,
          specialist → relevance), so reading them as one block makes the
          radar's lens legible. */}
      <fieldset className={styles.group} id="practice">
        <div className={styles.groupHead}>
          <span className={styles.groupTitle}>Тип практики</span>
          <span className={styles.groupHint}>Как агентство зарабатывает найм — это меняет, какие сигналы важнее в радаре.</span>
        </div>
        {/* Effective-mode badge: surfaces what the radar is actually doing right
            now. When the agency chose 'auto', the badge names the mode inferred
            from their roles so the inference is visible — and overrideable. The
            badge carries a semantic SVG glyph for the resolved mode so the
            agency recognises the practice at a glance. */}
        {(() => {
          const ModeGlyph = modeIcon(resolvedHiringMode);
          return (
            <div className={styles.modeSummary}>
              <span className={styles.modeSummaryValue} data-mode={resolvedHiringMode}>
                {ModeGlyph ? <ModeGlyph className={styles.modeSummaryIcon} aria-hidden="true" /> : null}
                Сейчас действует: {resolvedLabel}
              </span>
              <span className={styles.modeSummarySource}>
                {modeIsAuto
                  ? 'определено автоматически по ролям'
                  : 'выбрано вручную'}
              </span>
            </div>
          );
        })()}
        <div className={styles.radioOptions}>
          {HIRING_MODE_OPTIONS.map((opt) => (
            <label key={opt.key} className={styles.radioOption}>
              <input
                type="radio"
                name="hiringMode"
                value={opt.key}
                defaultChecked={(profile.hiringMode ?? "auto") === opt.key}
              />
              <span className={styles.radioOptionTitle}>{opt.label}</span>
              <span className={styles.radioOptionHint}>{opt.hint}</span>
            </label>
          ))}
        </div>
        {/* Mixed-practice honesty: 'auto' resolves to ONE mode, it does not
            blend. An agency that combines executive + specialist or specialist
            + volume work should pick the dominant practice explicitly, or the
            radar will frame every lead through a single lens. */}
        <p className={styles.modeNote}>
          Если у вас несколько практик сразу (например, executive + спец-подбор или спец-подбор + массовый найм), режим «Авто» выберет одну — радар будет показывать лиды через неё. Чтобы видеть каждую практику честно, выберите доминирующую вручную или разделите на отдельные профили.
        </p>
      </fieldset>

      {/* Roles — drives Fit scoring AND boosts within-digest ranking (not a hard
          filter). Sits right after the mode because the mode is what gives these
          roles their meaning. */}
      <CheckboxGroup
        name="roles"
        title="Роли, которые вы закрываете"
        hint="Поднимает компании с релевантным наймом выше в подборке и усиливает их оценку."
        options={ROLE_OPTIONS}
        selected={profile.roles}
      />

      {/* Group 3 — Where & whom. Geography, sector, size read as one
          "physical + market footprint" block. Served-industries and
          excluded-industries are adjacent now: the two halves of one decision
          (what you take / what you don't) instead of four sections apart. */}
      <fieldset className={styles.group} id="geography">
        <div className={styles.groupHead}>
          <span className={styles.groupTitle}>География и охват</span>
          <span className={styles.groupHint}>Где работаете, какие отрасли и размеры компаний берёте — и какие точно нет.</span>
        </div>
        <div className={styles.twoCol}>
          <label className={ppStyles.field}>
            <span className={ppStyles.fieldLabel}>Основной регион</span>
            <input className={ppStyles.input} name="targetCity" defaultValue={profile.targetCity ?? ""} placeholder="Москва" />
          </label>
          <label className={ppStyles.field}>
            <span className={ppStyles.fieldLabel}>Специализация</span>
            <input className={ppStyles.input} name="specialization" defaultValue={profile.specialization ?? ""} placeholder="Напр.: промышленный подбор, финансы C-level, массовый найм" />
            <span className={ppStyles.helperText}>Через запятую. Помогает точнее находить компании под вашу практику — не только IT.</span>
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

      {/* Served industries — boosts (soft), not a hard filter. */}
      <CheckboxGroup
        name="industries"
        title="Отрасли, с которыми работаете"
        hint="Усиливает компании из этих отраслей в подборке. Пусто — без отраслевого предпочтения."
        options={INDUSTRY_OPTIONS}
        selected={profile.industries}
      />

      {/* Excluded industries — hard exclude. Adjacent to the served list above so
          the take/don't-take decision reads as one. */}
      <CheckboxGroup
        name="excludedIndustries"
        title="Отрасли, с которыми не работаете"
        hint="Жёсткое исключение: такие компании не попадут в радар, даже при сильном сигнале найма."
        options={INDUSTRY_OPTIONS}
        selected={profile.excludedIndustries}
        emptyHint="Ничего не исключено — все отрасли попадают в радар."
      />

      {/* Company sizes — soft boost, kept with the rest of the footprint. */}
      <CheckboxGroup
        name="companySizes"
        title="Размер компаний"
        hint="Поднимает компании подходящего размера выше в подборке."
        options={COMPANY_SIZE_OPTIONS}
        selected={profile.companySizes}
      />

      {/* Group 4 — Contact policy. Reads as "how we reach them", a distinct
          safety concern from "whom we target", so it gets its own labeled block
          before the advanced tuning. */}
      <fieldset className={styles.group} id="contact-path">
        <div className={styles.groupHead}>
          <span className={styles.groupTitle}>Путь контакта</span>
          <span className={styles.groupHint}>Какой путь контакта считать безопасным. «Только корпоративные» отсекает компании без корпоративной поверхности.</span>
        </div>
        <label className={ppStyles.field}>
          <select className={ppStyles.input} name="contactPolicy" defaultValue={profile.contactPolicy}>
            {CONTACT_POLICY_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>{opt.label}</option>
            ))}
          </select>
        </label>
      </fieldset>

      {/* Group 5 — Fine-tuning. The advanced controls that can zero out the
          radar if set too aggressively. Deliberately last and clearly framed:
          thresholds + keyword tuning. Everything here is optional — empty
          means "no constraint". Anchored #fine-tuning so deep links from
          empty-state nudges land here directly. */}
      <fieldset className={styles.group} id="fine-tuning">
        <div className={styles.groupHead}>
          <span className={styles.groupTitle}>Точная настройка</span>
          <span className={styles.groupHint}>Необязательно. Жёсткие фильтры по силе и свежести найма — пусто значит «без ограничения». Слишком строгие пороги могут оставить радар пустым.</span>
        </div>
        <div className={styles.threeCol}>
          <label className={ppStyles.field}>
            <span className={ppStyles.fieldLabel}>Мин. сила сигнала</span>
            <input
              className={ppStyles.input}
              name="hiringIntentMin"
              type="number"
              min={0}
              max={100}
              step={1}
              // Stored on the internal [0,4] scale; show it as the 0–100 points
              // the lead card uses, so the floor and the card number agree.
              defaultValue={profile.hiringIntentMin != null ? Math.round(profile.hiringIntentMin * 25) : ""}
              placeholder="напр. 75"
            />
            <span className={ppStyles.helperText}>Оценка силы от 0 до 100 (как в карточке лида). Отсекает слабые лиды.</span>
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
        <div className={styles.twoCol}>
          <label className={ppStyles.field}>
            <span className={ppStyles.fieldLabel}>Усиливать фразы</span>
            <textarea
              className={ppStyles.textarea}
              name="includeKeywords"
              rows={4}
              defaultValue={toLines(profile.includeKeywords)}
            />
            <span className={ppStyles.helperText}>По одной фразе на строку. Поднимает компании с этими словами.</span>
          </label>
          <label className={ppStyles.field}>
            <span className={ppStyles.fieldLabel}>Исключать фразы</span>
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

      {/* Group 6 — Volume. How many companies per digest. Lives at the end so
          it reads as a delivery-shape control, not an identity field. Still
          saved by this same action (column is on client_profiles). */}
      <fieldset className={styles.group} id="volume">
        <div className={styles.groupHead}>
          <span className={styles.groupTitle}>Объём подборки</span>
          <span className={styles.groupHint}>Сколько компаний показывать в одном радаре.</span>
        </div>
        <label className={ppStyles.field}>
          <span className={ppStyles.fieldLabel}>Компаний в одной подборке</span>
          <input
            className={ppStyles.input}
            name="dailyDigestLimit"
            type="number"
            min={1}
            max={10}
            defaultValue={profile.dailyDigestLimit}
          />
          <span className={ppStyles.helperText}>От 1 до 10. Больше — шире охват, меньше — фокус на сильнейших.</span>
        </label>
      </fieldset>

      <div className={styles.submitRow}>
        <FormSubmitButton idleLabel="Сохранить профиль" pendingLabel="Сохраняем..." className={ppStyles.primaryAction} />
        <span className={ppStyles.helperText}>Изменения применяются к следующей подборке.</span>
      </div>
    </form>
  );
}
