"use client";

import { useEffect, useState } from "react";

import styles from "./pending-auth-action.module.css";

type PendingActionKind = "email_change" | "workspace_invite";
type Phase = "checking" | "ready" | "submitting" | "success" | "error" | "login";

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

const COPY = {
  email_change: {
    eyebrow: "Защищённое изменение",
    title: "Подтвердить новый email",
    description:
      "После подтверждения новый адрес станет основным. Все остальные активные сессии будут завершены.",
    button: "Подтвердить смену email",
    prepareUrl: "/api/auth/email-change/prepare",
    confirmUrl: "/api/auth/email-change/confirm",
  },
  workspace_invite: {
    eyebrow: "Доступ к рабочему пространству",
    title: "Принять приглашение",
    description:
      "Приглашение привязано к вашему подтверждённому email и действует только один раз.",
    button: "Принять приглашение",
    prepareUrl: "/api/auth/invite/prepare",
    confirmUrl: "/api/auth/invite/accept",
  },
} as const;

function safeDestination(value: unknown): string | null {
  return (
    typeof value === "string"
    && value.startsWith("/")
    && !value.startsWith("//")
    && !value.includes("\\")
  )
    ? value
    : null;
}

export function PendingAuthActionView(props: {
  kind: PendingActionKind;
  authenticated: boolean;
  hasPending: boolean;
}) {
  const copy = COPY[props.kind];
  const [phase, setPhase] = useState<Phase>(
    props.hasPending ? "ready" : "checking",
  );
  const [destination, setDestination] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    const fragment = window.location.hash.slice(1);
    if (!fragment) {
      if (!props.hasPending) {
        setErrorCode("invalid");
        setPhase("error");
      }
      return;
    }

    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
    if (!TOKEN_PATTERN.test(fragment)) {
      setErrorCode("invalid");
      setPhase("error");
      return;
    }

    let active = true;
    void fetch(copy.prepareUrl, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: fragment }),
    })
      .then((response) => {
        if (!response.ok) throw new Error("prepare_failed");
        if (active) setPhase("ready");
      })
      .catch(() => {
        if (active) {
          setErrorCode("invalid");
          setPhase("error");
        }
      });
    return () => {
      active = false;
    };
  }, [copy.prepareUrl, props.hasPending]);

  async function confirm() {
    setPhase("submitting");
    setErrorCode(null);
    try {
      const response = await fetch(copy.confirmUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
      });
      const result = await response.json().catch(() => null) as {
        ok?: unknown;
        code?: unknown;
        destination?: unknown;
        loginUrl?: unknown;
      } | null;
      const loginUrl = safeDestination(result?.loginUrl);
      if (response.status === 401 && loginUrl) {
        setDestination(loginUrl);
        setPhase("login");
        return;
      }
      const nextDestination = safeDestination(result?.destination);
      if (!response.ok || result?.ok !== true || !nextDestination) {
        setErrorCode(
          typeof result?.code === "string" ? result.code : "unavailable",
        );
        setPhase("error");
        return;
      }
      setDestination(nextDestination);
      setPhase("success");
    } catch {
      setErrorCode("unavailable");
      setPhase("error");
    }
  }

  const needsLogin = props.kind === "workspace_invite" && !props.authenticated;
  const loginHref = destination ?? "/login?returnTo=/auth/invite";

  return (
    <section className={styles.card} aria-labelledby="pending-action-title">
      <div className={styles.icon} aria-hidden="true">
        <span />
      </div>
      <span className={styles.eyebrow}>{copy.eyebrow}</span>
      <h1 id="pending-action-title">{copy.title}</h1>
      <p>{copy.description}</p>

      {phase === "checking" ? (
        <div className={styles.status} role="status" aria-live="polite">
          Проверяем ссылку…
        </div>
      ) : null}

      {phase === "ready" && needsLogin ? (
        <a className={styles.primary} href={loginHref}>
          Войти и продолжить
        </a>
      ) : null}

      {phase === "ready" && !needsLogin ? (
        <button className={styles.primary} type="button" onClick={confirm}>
          {copy.button}
        </button>
      ) : null}

      {phase === "submitting" ? (
        <button className={styles.primary} type="button" disabled>
          Подтверждаем…
        </button>
      ) : null}

      {phase === "login" && destination ? (
        <div className={styles.result} role="status">
          <strong>Нужен вход</strong>
          <span>Ссылка сохранена. Войдите тем email, на который пришло приглашение.</span>
          <a className={styles.primary} href={destination}>
            Войти и продолжить
          </a>
        </div>
      ) : null}

      {phase === "success" && destination ? (
        <div className={styles.result} role="status">
          <strong>
            {props.kind === "email_change"
              ? "Email изменён"
              : "Приглашение принято"}
          </strong>
          <span>Изменение сохранено безопасно.</span>
          <a className={styles.primary} href={destination}>
            Продолжить
          </a>
        </div>
      ) : null}

      {phase === "error" ? (
        <div className={styles.error} role="alert">
          <strong>
            {errorCode === "email_mismatch"
              ? "Войдите с приглашённым email"
              : "Ссылка недействительна"}
          </strong>
          <span>
            {errorCode === "email_mismatch"
              ? "Это приглашение нельзя принять из другого аккаунта."
              : errorCode === "conflict"
                ? "Изменение уже выполнено или конфликтует с текущими данными."
                : errorCode === "unavailable"
                  ? "Сервис временно недоступен. Попробуйте ещё раз."
                  : "Ссылка истекла, уже использована или повреждена."}
          </span>
          {errorCode === "unavailable" && props.hasPending ? (
            <button className={styles.secondary} type="button" onClick={confirm}>
              Повторить
            </button>
          ) : (
            <a className={styles.secondary} href="/login">
              Вернуться ко входу
            </a>
          )}
        </div>
      ) : null}

      <small>
        Секрет из письма удалён из адресной строки и не передаётся в аналитику.
      </small>
    </section>
  );
}
