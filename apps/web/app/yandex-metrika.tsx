"use client";

import Link from "next/link";
import Script from "next/script";
import { useEffect, useMemo, useState } from "react";

const CONSENT_STORAGE_KEY = "rr_analytics_consent_v1";
const CONSENT_TTL_MS = 426 * 24 * 60 * 60 * 1000;

type AnalyticsConsent = "granted" | "denied" | null;

type StoredConsent = {
  value: Exclude<AnalyticsConsent, null>;
  decidedAt: string;
};

function readCounterId(): string | null {
  const value = process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID?.trim() ?? "";
  return /^\d{5,12}$/.test(value) ? value : null;
}

export default function YandexMetrika() {
  const counterId = readCounterId();
  const [consent, setConsent] = useState<AnalyticsConsent>(null);
  const [choiceLoaded, setChoiceLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scriptReady, setScriptReady] = useState(false);

  useEffect(() => {
    setConsent(readStoredConsent());
    setChoiceLoaded(true);
  }, []);

  const initialization = useMemo(() => `
    (function(m,e,t,r,i,k,a){
      m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
      m[i].l=1*new Date();
      k=e.createElement(t);a=e.getElementsByTagName(t)[0];
      k.async=1;k.src=r;a.parentNode.insertBefore(k,a);
    })(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");
    ym(${counterId},"init",{
      defer:true,
      clickmap:false,
      trackLinks:false,
      accurateTrackBounce:true,
      webvisor:false,
      sendTitle:false
    });
  `, [counterId]);

  useEffect(() => {
    if (consent !== "granted" || !counterId || !scriptReady || typeof window.ym !== "function") return;
    window.ym(Number(counterId), "hit", "/", { title: document.title });
  }, [consent, counterId, scriptReady]);

  if (!counterId || !choiceLoaded) return null;

  const showDialog = consent === null || settingsOpen;

  return (
    <>
      {consent === "granted" ? (
        <Script
          id="yandex-metrika-loader"
          strategy="afterInteractive"
          onReady={() => setScriptReady(true)}
        >
          {initialization}
        </Script>
      ) : null}

      {showDialog ? (
        <div
          role="dialog"
          aria-modal="false"
          aria-labelledby="analytics-consent-title"
          style={styles.dialog}
          data-analytics-consent
        >
          <div style={styles.copy}>
            <strong id="analytics-consent-title" style={styles.title}>Необязательная аналитика</strong>
            <span style={styles.text}>
              Мы используем Яндекс Метрику только для обезличенной оценки публичного сайта. Она не загружается без вашего согласия и не работает на checkout или в личном кабинете. Подробнее — в <Link href="/privacy" style={styles.link}>политике обработки данных</Link>.
            </span>
          </div>
          <div style={styles.actions}>
            <button type="button" style={styles.secondaryButton} onClick={() => saveChoice("denied")}>Только необходимые</button>
            <button type="button" style={styles.primaryButton} onClick={() => saveChoice("granted")}>Разрешить аналитику</button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          style={styles.settingsButton}
          onClick={() => setSettingsOpen(true)}
          aria-label="Изменить настройки cookies"
          title="Cookies"
        >
          Cookies
        </button>
      )}
    </>
  );

  function saveChoice(value: Exclude<AnalyticsConsent, null>) {
    const record: StoredConsent = { value, decidedAt: new Date().toISOString() };
    try {
      window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
    } catch {
      // Consent still applies for the current page even when storage is unavailable.
    }
    if (value === "denied") clearYandexCookies();
    setConsent(value);
    setSettingsOpen(false);
    setScriptReady(false);
  }
}

function readStoredConsent(): AnalyticsConsent {
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredConsent>;
    if (parsed.value !== "granted" && parsed.value !== "denied") return null;
    const decidedAt = typeof parsed.decidedAt === "string" ? new Date(parsed.decidedAt).getTime() : Number.NaN;
    if (!Number.isFinite(decidedAt) || Date.now() - decidedAt > CONSENT_TTL_MS) {
      window.localStorage.removeItem(CONSENT_STORAGE_KEY);
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
}

function clearYandexCookies() {
  for (const name of ["_ym_uid", "_ym_d", "_ym_isad", "_ym_visorc"]) {
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
  }
}

const styles = {
  dialog: {
    position: "fixed",
    zIndex: 1000,
    left: "max(16px, env(safe-area-inset-left))",
    right: "max(16px, env(safe-area-inset-right))",
    bottom: "max(16px, env(safe-area-inset-bottom))",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 18,
    maxWidth: 920,
    margin: "0 auto",
    padding: 18,
    border: "1px solid rgba(15, 23, 42, .14)",
    borderRadius: 18,
    background: "rgba(255,255,255,.97)",
    boxShadow: "0 18px 60px rgba(15,23,42,.18)",
    color: "#0f172a",
    backdropFilter: "blur(16px)",
    flexWrap: "wrap",
  },
  copy: { display: "grid", gap: 6, flex: "1 1 480px" },
  title: { fontSize: ".95rem" },
  text: { fontSize: ".82rem", lineHeight: 1.55, color: "#475467" },
  link: {
    display: "inline-flex",
    minHeight: 44,
    alignItems: "center",
    color: "inherit",
    textDecoration: "underline",
    verticalAlign: "middle",
  },
  actions: { display: "flex", gap: 8, flex: "1 1 280px", justifyContent: "flex-end", flexWrap: "wrap" },
  primaryButton: {
    minHeight: 44,
    padding: "0 16px",
    border: 0,
    borderRadius: 11,
    background: "#111827",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
  },
  secondaryButton: {
    minHeight: 44,
    padding: "0 16px",
    border: "1px solid rgba(15,23,42,.16)",
    borderRadius: 11,
    background: "#fff",
    color: "#111827",
    fontWeight: 650,
    cursor: "pointer",
  },
  settingsButton: {
    position: "fixed",
    zIndex: 900,
    right: "max(8px, env(safe-area-inset-right))",
    bottom: "max(8px, env(safe-area-inset-bottom))",
    width: 58,
    minHeight: 44,
    padding: "0 7px",
    border: "1px solid rgba(15,23,42,.14)",
    borderRadius: 999,
    background: "rgba(255,255,255,.92)",
    color: "#475467",
    fontSize: ".62rem",
    cursor: "pointer",
    boxShadow: "0 8px 24px rgba(15,23,42,.1)",
  },
} as const;
