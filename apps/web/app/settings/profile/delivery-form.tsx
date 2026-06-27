"use client";

import { useActionState, useState } from "react";

import type { DeliveryPreferences } from "../../../lib/deliveryPreferences";
import { FormSubmitButton } from "../../ui/form-submit-button";
import { NoticeBox } from "../../ui/page-primitives";
import ppStyles from "../../ui/page-primitives.module.css";
import { saveDeliveryPreferencesAction, type SaveDeliveryResult } from "./actions";
import styles from "./profile-form.module.css";

/**
 * Delivery-channel preferences — a separate concern (and separate submit) from
 * the ICP/scoring profile. Telegram stays the primary channel and is managed via
 * the connect flow, not here; this section opts into the additive channels:
 * browser push for strong leads, and a daily email digest.
 */
export function DeliveryForm(props: { preferences: DeliveryPreferences }) {
  const { preferences } = props;
  const [state, formAction] = useActionState<SaveDeliveryResult | null, FormData>(
    saveDeliveryPreferencesAction,
    null
  );

  // Local mirror so the email field can react to the toggle without a round-trip.
  const [emailEnabled, setEmailEnabled] = useState(preferences.emailDigestEnabled);

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
