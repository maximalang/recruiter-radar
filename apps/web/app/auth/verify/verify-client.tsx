"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { AuthShell } from "../../login/auth-shell";
import styles from "../../login/login.module.css";

export default function VerifyLoginClient() {
  const [networkFailed, setNetworkFailed] = useState(false);

  useEffect(() => {
    const token = window.location.hash.slice(1).trim();
    window.history.replaceState(null, "", "/auth/verify");
    if (!/^[a-f0-9]{64}$/.test(token)) {
      window.location.replace("/auth/confirm?status=invalid");
      return;
    }
    void fetch("/api/auth/login/verify", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => response.json() as Promise<{ next?: string }>)
      .then((result) => {
        const next = result.next === "/auth/confirm"
          || result.next === "/auth/confirm?status=invalid"
          ? result.next
          : "/auth/confirm?status=invalid";
        window.location.replace(next);
      })
      .catch(() => setNetworkFailed(true));
  }, []);

  return (
    <AuthShell>
      <p className={styles.eyebrow}>Защищённый вход</p>
      <h1 className={styles.title}>
        {networkFailed ? "Не удалось связаться с сервисом" : "Проверяем ссылку…"}
      </h1>
      <p className={styles.lead} aria-live="polite">
        {networkFailed
          ? "Проверьте подключение к интернету и повторите попытку. Ссылка не была использована."
          : "Это займёт несколько секунд. Одноразовый код уже удалён из адресной строки."}
      </p>
      {networkFailed ? (
        <>
          <button
            className={styles.submit}
            type="button"
            onClick={() => window.location.reload()}
          >
            Повторить проверку
          </button>
          <Link className={styles.back} href="/login">
            Получить новую ссылку →
          </Link>
        </>
      ) : null}
    </AuthShell>
  );
}
