"use client";

import Link from "next/link";
import Script from "next/script";
import { useEffect, useMemo, useState } from "react";

import styles from "./yandex-metrika.module.css";

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
          className={styles.dialog}
          data-analytics-consent
        >
          <div className={styles.copy}>
            <strong id="analytics-consent-title" className={styles.title}>Необязательная аналитика</strong>
            <span className={styles.text}>
              Мы используем Яндекс Метрику только для обезличенной оценки публичного сайта. Она не загружается без вашего согласия и не работает на checkout или в личном кабинете. Подробнее — в <Link href="/privacy" className={styles.link}>политике обработки данных</Link>.
            </span>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.secondaryButton} onClick={() => saveChoice("denied")}>Только необходимые</button>
            <button type="button" className={styles.primaryButton} onClick={() => saveChoice("granted")}>Разрешить аналитику</button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={styles.settingsButton}
          onClick={() => setSettingsOpen(true)}
          aria-label="Изменить настройки cookies"
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
