"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";

import { getAuthWebmailUrl } from "@/lib/auth-v2/webmail";
import { requestLoginAction, type LoginFormState } from "./actions";
import styles from "./login.module.css";

export default function LoginForm(props: { returnTo: string; initialEmail?: string }) {
  const [revision, setRevision] = useState(0);
  const [initialEmail, setInitialEmail] = useState(props.initialEmail ?? "");

  function chooseAnotherEmail() {
    setInitialEmail("");
    setRevision((value) => value + 1);
  }

  return (
    <LoginFormFlow
      key={revision}
      returnTo={props.returnTo}
      initialEmail={initialEmail}
      onChooseAnotherEmail={chooseAnotherEmail}
    />
  );
}

function LoginFormFlow(props: {
  returnTo: string;
  initialEmail: string;
  onChooseAnotherEmail: () => void;
}) {
  const [state, formAction, pending] = useActionState<LoginFormState, FormData>(requestLoginAction, null);

  if (state?.ok) {
    return (
      <EmailSentState
        state={state}
        formAction={formAction}
        pending={pending}
        onChooseAnotherEmail={props.onChooseAnotherEmail}
      />
    );
  }

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="returnTo" value={props.returnTo} />
      <label className={styles.field}>
        <span>Рабочий email</span>
        <input
          className={styles.input}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          defaultValue={props.initialEmail}
          placeholder="you@company.ru"
          maxLength={254}
          required
        />
      </label>
      {state && !state.ok ? <div className={styles.error} role="alert">{state.error}</div> : null}
      <button className={styles.submit} type="submit" disabled={pending}>
        {pending ? "Отправляем…" : "Продолжить"}
      </button>
      <p className={styles.legal}>
        Продолжая, вы принимаете <Link href="/terms">условия использования</Link>
        {" "}и <Link href="/privacy">политику конфиденциальности</Link>.
      </p>
    </form>
  );
}

function EmailSentState(props: {
  state: Extract<LoginFormState, { ok: true }>;
  formAction: (payload: FormData) => void;
  pending: boolean;
  onChooseAnotherEmail: () => void;
}) {
  const [cooldown, setCooldown] = useState(() =>
    getCooldownSeconds(props.state.requestedAt)
  );
  const webmailUrl = getAuthWebmailUrl(props.state.email);

  useEffect(() => {
    const update = () => setCooldown(getCooldownSeconds(props.state.requestedAt));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [props.state.requestedAt]);

  return (
    <div className={styles.sent}>
      <span className={styles.sentIcon} aria-hidden="true">✓</span>
      <p className={styles.eyebrow}>Ссылка отправлена</p>
      <h2 className={styles.sentTitle}>Проверьте почту</h2>
      <div role="status" aria-live="polite">
        <p className={styles.sentLead}>
          Мы отправили письмо на <strong>{props.state.email}</strong>. Ссылка
          действует 15 минут.
        </p>
        <p className={styles.sentHint}>
          Письмо может прийти не сразу. Проверьте папки «Спам» и «Рассылки».
        </p>
      </div>

      <div className={styles.sentActions}>
        {webmailUrl ? (
          <a
            className={styles.submit}
            href={webmailUrl}
            target="_blank"
            rel="noreferrer"
          >
            Открыть почту
          </a>
        ) : (
          <p className={styles.webmailFallback}>
            Откройте корпоративную почту в привычном приложении или браузере.
          </p>
        )}
        <form action={props.formAction}>
          <input type="hidden" name="email" value={props.state.email} />
          <input type="hidden" name="returnTo" value={props.state.returnTo} />
          <button
            className={styles.secondaryAction}
            type="submit"
            disabled={props.pending || cooldown > 0}
          >
            {props.pending
              ? "Отправляем…"
              : cooldown > 0
                ? `Отправить повторно через ${cooldown} с`
                : "Отправить повторно"}
          </button>
        </form>
        <button
          className={styles.tertiaryAction}
          type="button"
          onClick={props.onChooseAnotherEmail}
        >
          Указать другой email
        </button>
        <Link className={styles.supportAction} href="/legal">
          Обратиться в поддержку
        </Link>
      </div>
    </div>
  );
}

function getCooldownSeconds(requestedAt: number): number {
  const elapsed = Math.max(0, Date.now() - requestedAt);
  return Math.max(0, Math.ceil((30_000 - elapsed) / 1000));
}
