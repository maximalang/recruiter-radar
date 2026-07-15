"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import type { DeliveryPreferences } from "../../lib/deliveryPreferences";
import { computeNextDeliveryHint } from "../../lib/delivery/nextDeliveryHint";
import { FormSubmitButton } from "../ui/form-submit-button";
import { NoticeBox } from "../ui/page-primitives";
import { BellIcon, MailIcon } from "../ui/icons";
import ppStyles from "../ui/page-primitives.module.css";
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
 * Schedule and additive browser/email preferences. Provider accounts and concrete
 * Telegram, VK and webhook destinations are managed by NotificationChannels.
 */
export function DeliveryForm(props: { preferences: DeliveryPreferences }) {
  const { preferences } = props;
  const [state, formAction] = useActionState<SaveDeliveryResult | null, FormData>(
    saveDeliveryPreferencesAction,
    null
  );
  const router = useRouter();

  useEffect(() => {
    if (state?.ok === true) {
      router.refresh();
    }
  }, [state, router]);

  const [emailEnabled, setEmailEnabled] = useState(preferences.emailDigestEnabled);
  const [deliveryEnabled, setDeliveryEnabled] = useState(preferences.deliveryEnabled);
  const [timeLocal, setTimeLocal] = useState(preferences.deliveryTimeLocal ?? "");
  const [timezone, setTimezone] = useState(preferences.deliveryTimezone);
  const [frequency, setFrequency] = useState(preferences.deliveryFrequency);

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
          <span className={styles.groupTitle}>
            <BellIcon className={styles.groupTitleIcon} aria-hidden="true" /> Браузерные уведомления
          </span>
          <span className={styles.groupHint}>Короткий пуш, когда появляются сильные компании (A/B). Работает только при активной подписке браузера.</span>
        </div>
        <label className={styles.toggle}>
          <input type="checkbox" name="webPushEnabled" defaultChecked={preferences.webPushEnabled} />
          Присылать браузерные уведомления о сильных лидах
        </label>
      </fieldset>

      <fieldset className={styles.group}>
        <div className={styles.groupHead}>
          <span className={styles.groupTitle}>
            <MailIcon className={styles.groupTitleIcon} aria-hidden="true" /> Email-дайджест
          </span>
          <span className={styles.groupHint}>Раз в день — компании, которым стоит написать сегодня, с доказательствами и «почему сейчас». Работает параллельно с подключёнными каналами.</span>
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
        <span className={ppStyles.helperText}>Настройки применяются ко всем активным каналам профиля.</span>
      </div>
    </form>
  );
}
