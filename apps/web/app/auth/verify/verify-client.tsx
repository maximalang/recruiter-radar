"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { BrandLogo } from "../../ui/brand-logo";
import styles from "../../login/login.module.css";

export default function VerifyLoginClient() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const token = window.location.hash.slice(1).trim();
    window.history.replaceState(null, "", "/auth/verify");
    if (!/^[a-f0-9]{64}$/.test(token)) {
      setFailed(true);
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
        window.location.replace(result.next === "/auth/confirm" ? result.next : "/login?error=invalid-link");
      })
      .catch(() => setFailed(true));
  }, []);

  return (
    <main className={styles.shell}>
      <section className={styles.card}>
        <Link href="/" className={styles.brand}><BrandLogo size="small" /></Link>
        <p className={styles.eyebrow}>Защищённый вход</p>
        <h1 className={styles.title}>{failed ? "Не удалось проверить ссылку" : "Проверяем ссылку…"}</h1>
        <p className={styles.lead}>
          {failed ? "Ссылка повреждена, истекла или уже использована. Запросите новую." : "Это займёт несколько секунд. Одноразовый код уже удалён из адресной строки."}
        </p>
        {failed ? <Link className={styles.back} href="/login">Получить новую ссылку →</Link> : null}
      </section>
    </main>
  );
}
