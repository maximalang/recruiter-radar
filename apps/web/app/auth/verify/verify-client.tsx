"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { AuthShell } from "../../login/auth-shell";
import styles from "../../login/login.module.css";

const LOGIN_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export default function VerifyLoginClient() {
  const tokenRef = useRef("");
  const [networkFailed, setNetworkFailed] = useState(false);
  const [verifying, setVerifying] = useState(true);

  const verifyToken = useCallback(async (token: string) => {
    setNetworkFailed(false);
    setVerifying(true);
    try {
      const response = await fetch("/api/auth/login/verify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const result = await response.json() as { next?: string };
      const next = result.next === "/auth/confirm"
        || result.next === "/auth/confirm?status=invalid"
          ? result.next
          : "/auth/confirm?status=invalid";
      window.location.replace(next);
    } catch {
      setNetworkFailed(true);
      setVerifying(false);
    }
  }, []);

  useEffect(() => {
    const token = window.location.hash.slice(1).trim();
    window.history.replaceState(null, "", "/auth/verify");
    if (!LOGIN_TOKEN_PATTERN.test(token)) {
      window.location.replace("/auth/confirm?status=invalid");
      return;
    }
    tokenRef.current = token;
    void verifyToken(token);
  }, [verifyToken]);

  const retry = () => {
    const token = tokenRef.current;
    if (!LOGIN_TOKEN_PATTERN.test(token)) {
      window.location.replace("/login?error=invalid-link");
      return;
    }
    void verifyToken(token);
  };

  return (
    <AuthShell>
      <p className={styles.eyebrow}>Защищённый вход</p>
      <h1 className={styles.title}>
        {networkFailed ? "Не удалось связаться с сервисом" : "Проверяем ссылку…"}
      </h1>
      <p className={styles.lead} aria-live="polite">
        {networkFailed
          ? "Проверьте подключение к интернету и повторите проверку. Одноразовый код сохранён в этой вкладке и ещё не был отправлен повторно."
          : "Это займёт несколько секунд. Одноразовый код уже удалён из адресной строки."}
      </p>
      {networkFailed ? (
        <>
          <button
            className={styles.submit}
            type="button"
            onClick={retry}
            disabled={verifying}
          >
            {verifying ? "Проверяем…" : "Повторить проверку"}
          </button>
          <Link className={styles.back} href="/login">
            Получить новую ссылку →
          </Link>
        </>
      ) : null}
    </AuthShell>
  );
}
