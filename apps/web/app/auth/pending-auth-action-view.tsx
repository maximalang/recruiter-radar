"use client";

import { useEffect, useRef, useState } from "react";

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
  // Fragment consumption must be idempotent: next 16.3 router re-renders
  // replay mount effects after cleanup (vercel/next.js issue 62561), and a
  // replay observes the already-cleared hash. The captured token and the
  // prepare outcome live in per-mount refs only — never in storage, logs,
  // analytics or the URL after consumption — so a replay reuses them instead
  // of downgrading a successful prepare to a fail-closed error.
  const tokenRef = useRef<string | null>(null);
  const prepareRef = useRef<"idle" | "sent" | "ready" | "failed">("idle");

  useEffect(() => {
    const fragment = window.location.hash.slice(1);
    if (fragment) {
      tokenRef.current = fragment;
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    }
    const token = tokenRef.current;
    if (!token) {
      if (!props.hasPending) {
        setErrorCode("invalid");
        setPhase("error");
      }
      return;
    }

    if (!TOKEN_PATTERN.test(token)) {
      setErrorCode("invalid");
      setPhase("error");
      return;
    }

    if (prepareRef.current === "ready") {
      setPhase("ready");
      return;
    }
    if (prepareRef.current === "failed") {
      setErrorCode("invalid");
      setPhase("error");
      return;
    }
    if (prepareRef.current === "sent") {
      // Prepare is in flight; its handlers below are authoritative for the
      // phase, so the replay simply keeps the current "checking" state.
      return;
    }

    prepareRef.current = "sent";
    void fetch(copy.prepareUrl, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((response) => {
        if (!response.ok) throw new Error("prepare_failed");
        prepareRef.current = "ready";
        setPhase("ready");
      })
      .catch(() => {
        prepareRef.current = "failed";
        setErrorCode("invalid");
        setPhase("error");
      });
    // Intentionally no cleanup invalidation: the prepare result must survive
    // effect cleanup/replay on the same mount. Fail-closed is preserved —
    // missing, malformed or server-rejected tokens still render the error
    // phase, and a fresh mount starts from empty refs.
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
