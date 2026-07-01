"use client";

import { useActionState, useState } from "react";

import type { DeliveryPreferences } from "../../../lib/deliveryPreferences";
import { computeNextDeliveryHint } from "../../../lib/delivery/nextDeliveryHint";
import { FormSubmitButton } from "../../ui/form-submit-button";
import { NoticeBox } from "../../ui/page-primitives";
import ppStyles from "../../ui/page-primitives.module.css";
import { saveDeliveryPreferencesAction, type SaveDeliveryResult } from "./actions";
import styles from "./profile-form.module.css";

const TIMEZONES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "Europe/Kaliningrad", label: "Калининград (UTC+2)" },
  { value: "Europe/Moscow", label: "Москва (UTC+3)" },
  { value: "Europe/Samara", label: "Самара (UTC+4)" },
  { value: "Asia/Yekaterinburg", label: "Екатеринбург (UTC+5)" },
  { value: "Asia/Omsk", label: "Омск (UTC+6)" },
  { value: "Asia/Novosibirsk", label: "Новосибирск (UTC+7)" },
  { value: "Asia/Krasnoyarsk", label: "Красноярск (UTC+7)" },
  { value: "Asia/Irkutsk", label: "Иркутск (UTC+8)" },
  { value: "Asia/Yakutsk", label: "Якутск (UTC+9)" },
  { value: "Asia/Vladivostok", label: "Владивосток (UTC+10)" },
];

const FREQUENCIES: ReadonlyArray<{ value: "daily" | "weekly"; label: string }> = [
  { value: "daily", label: "Каждый день" },
  { value: "weekly", label: "Раз в неделю (по понедельникам)" },
];

/**
 * Delivery-channel preferences — a separate concern (and separate submit) from
 * the ICP/scoring profile. Telegram stays the primary channel and is managed via
 * the connect flow, not here; this section opts into the additive channels
 * (browser push, email digest) AND the delivery-time preferences (when to send).
 */
export function DeliveryForm(props: { preferences: DeliveryPreferences }) {
  const { preferences } = props;
  const [state, formAction] = useActionState<SaveDeliveryResult | null, FormData>(
    saveDeliveryPreferencesAction,
    null
  );

  // Local mirror so the email field can react to the toggle without a round-trip.
  const [emailEnabled, setEmailEnabled] = useState(preferences.emailDigestEnabled);
  // Local mirror so the time/frequency hint can update without a round-trip.
  const [deliveryEnabled, setDeliveryEnabled] = useState(preferences.deliveryEnabled);
  const [timeLocal, setTimeLocal] = useState(preferences.deliveryTimeLocal ?? "");
  const [timezone, setTimezone] = useState(preferences.deliveryTimezone);
  const [frequency, setFrequency] = useState(preferences.deliveryFrequency);

  // Hint is computed from the live mirror so it reflects edits before save.
  const hint = deliveryEnabled
    ? computeNextDeliveryHint({
        deliveryTimezone: timezone || "Europe/Moscow",
        deliveryFrequency: frequency,
        deliveryTimeLocal: timeLocal ? timeLocal : null,
      })
    : null;

  return (
    <form action={formAction} className={styles.form}>
      {state?.ok === true ? (
        <NoticeBox tone="success" title="Настройки доставки сохранены" description="Изменения применятся со следующей подборки." />
      ) : null}
      {state?.ok === false ? (
        <NoticeBox tone="danger" title="Не удалось сохранить" description={state.error} />
      ) : null}

      <fieldset className={styles.group}>
        <div className={styles.groupHead}>
          <span className={styles.groupTitle}>Когда присылать лиды</span>
          <span className={styles.groupHint}>Основной переключатель доставки. Когда выключено — подборка не приходит ни в один канал, пока вы не включите снова.</span>
        </div>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            name="deliveryEnabled"
            defaultChecked={preferences.deliveryEnabled}
            onChange={(e) => setDeliveryEnabled(e.currentTarget.checked)}
          />
          Включить доставку радара
        </label>

        {deliveryEnabled ? (
          <>
            <div className={ppStyles.row}>
              <label className={ppStyles.field}>
                <span className={ppStyles.fieldLabel}>Желаемое время (местное)</span>
                <input
                  className={ppStyles.input}
                  name="deliveryTimeLocal"
                  type="time"
                  value={timeLocal}
                  onChange={(e) => setTimeLocal(e.currentTarget.value)}
                />
                <span className={ppStyles.helperText}>Ориентир. Сейчас радар собирается одним запуском около 06:00 МСК — точное время по каждому профилю появится позже.</span>
              </label>
              <label className={ppStyles.field}>
                <span className={ppStyles.fieldLabel}>Часовой пояс</span>
                <select
                  className={ppStyles.input}
                  name="deliveryTimezone"
                  value={timezone}
                  onChange={(e) => setTimezone(e.currentTarget.value)}
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>{tz.label}</option>
                  ))}
                </select>
                <span className={ppStyles.helperText}>По умолчанию — Москва.</span>
              </label>
            </div>
            <label className={ppStyles.field}>
              <span className={ppStyles.fieldLabel}>Частота</span>
              <select
                className={ppStyles.input}
                name="deliveryFrequency"
                value={frequency}
                onChange={(e) => setFrequency(e.currentTarget.value as "daily" | "weekly")}
              >
                {FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </label>
            {hint ? (
              <p className={ppStyles.helperText} aria-live="polite">
                Следующая отправка: <strong>{hint.label}</strong>
              </p>
            ) : null}
          </>
        ) : null}
      </fieldset>

      <fieldset className={styles.group}>
        <div className={styles.groupHead}>
          <span className={styles.groupTitle}>Браузерные уведомления</span>
          <span className={styles.groupHint}>Короткий пуш, когда появляются сильные компании (A/B). Работает только при активной подписке браузера.</span>
        </div>
        <label className={styles.toggle}>
          <input type="checkbox" name="webPushEnabled" defaultChecked={preferences.webPushEnabled} />
          Присылать браузерные уведомления о сильных лидах
        </label>
      </fieldset>

      <fieldset className={styles.group}>
        <div className={styles.groupHead}>
          <span className={styles.groupTitle}>Email-дайджест</span>
          <span className={styles.groupHint}>Раз в день — компании, которым стоит написать сегодня, с доказательствами и «почему сейчас». Telegram остаётся основным каналом.</span>
        </div>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            name="emailDigestEnabled"
            defaultChecked={preferences.emailDigestEnabled}
            onChange={(e) => setEmailEnabled(e.currentTarget.checked)}
          />
          Присылать ежедневный email-дайджест
        </label>
        <label className={ppStyles.field}>
          <span className={ppStyles.fieldLabel}>Адрес для дайджеста</span>
          <input
            className={ppStyles.input}
            name="digestEmail"
            type="email"
            defaultValue={preferences.digestEmail ?? ""}
            placeholder="agency@example.com"
            required={emailEnabled}
          />
          <span className={ppStyles.helperText}>Один адрес. Чтобы включить дайджест, поле обязательно.</span>
        </label>
      </fieldset>

      <div className={styles.submitRow}>
        <FormSubmitButton idleLabel="Сохранить доставку" pendingLabel="Сохраняем..." className={ppStyles.primaryAction} />
        <span className={ppStyles.helperText}>Одно письмо в день на профиль.</span>
      </div>
    </form>
  );
}
