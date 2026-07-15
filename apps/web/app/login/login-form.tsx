"use client";

import { useActionState } from "react";

import { requestLoginAction, type LoginFormState } from "./actions";
import styles from "./login.module.css";

export default function LoginForm(props: { returnTo: string; initialEmail?: string }) {
  const [state, formAction, pending] = useActionState<LoginFormState, FormData>(requestLoginAction, null);

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="returnTo" value={props.returnTo} />
      <label className={styles.field}>
        <span>Email для входа</span>
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
      {state?.ok ? (
        <div className={styles.success} role="status">
          Если адрес указан верно, письмо уже в пути. Ссылка действует 15 минут. Проверьте также папку «Спам».
        </div>
      ) : null}
      {state && !state.ok ? <div className={styles.error}>{state.error}</div> : null}
      <button className={styles.submit} type="submit" disabled={pending}>
        {pending ? "Отправляем…" : "Получить ссылку для входа"}
      </button>
      <p className={styles.helper}>Пароль не нужен. По этому email можно безопасно войти или создать новый аккаунт.</p>
    </form>
  );
}
