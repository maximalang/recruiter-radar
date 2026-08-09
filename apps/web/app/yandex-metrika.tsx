"use client";

import Link from "next/link";
import Script from "next/script";
import { useEffect, useMemo, useState } from "react";

import styles from "./yandex-metrika.module.css";
import {
  ANALYTICS_SETTINGS_OPEN_EVENT,
  clearAnalyticsConsent,
  readAnalyticsConsent,
  storeAnalyticsConsent,
} from "../lib/analytics-consent";

const CONSENT_TTL_MS = 426 * 24 * 60 * 60 * 1000;

type AnalyticsConsent = "granted" | "denied" | null;

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

  useEffect(() => {
    const openSettings = () => setSettingsOpen(true);
    window.addEventListener(ANALYTICS_SETTINGS_OPEN_EVENT, openSettings);
    return () => window.removeEventListener(ANALYTICS_SETTINGS_OPEN_EVENT, openSettings);
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

  if (!choiceLoaded) return null;

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
            <button type="button" className={styles.secondaryButton} onClick={() => saveChoice("denied")}>Отклонить</button>
            <button type="button" className={styles.primaryButton} onClick={() => saveChoice("granted")}>Разрешить</button>
          </div>
        </div>
      ) : null}
    </>
  );

  function saveChoice(value: Exclude<AnalyticsConsent, null>) {
    storeAnalyticsConsent(value === "granted");
    if (value === "denied" && counterId) disableYandexCounter(counterId);
    else if (counterId) delete (window as unknown as Record<string, unknown>)[`disableYaCounter${counterId}`];
    setConsent(value);
    setSettingsOpen(false);
    setScriptReady(false);
  }
}

function readStoredConsent(): AnalyticsConsent {
  const consent = readAnalyticsConsent();
  if (consent === null) return null;
  try {
    const raw = window.localStorage.getItem("rr_analytics_consent");
    const updatedAt = raw ? (JSON.parse(raw) as { updatedAt?: string }).updatedAt : undefined;
    const timestamp = typeof updatedAt === "string" ? new Date(updatedAt).getTime() : Number.NaN;
    if (!Number.isFinite(timestamp) || Date.now() - timestamp > CONSENT_TTL_MS) {
      clearAnalyticsConsent();
      return null;
    }
  } catch {
    // Volatile consent remains valid for the current page.
  }
  return consent ? "granted" : "denied";
}

function disableYandexCounter(counterId: string) {
  (window as unknown as Record<string, unknown>)[`disableYaCounter${counterId}`] = true;
  document.getElementById("yandex-metrika-loader")?.remove();
  document.querySelector<HTMLScriptElement>('script[src^="https://mc.yandex.ru/metrika/"]')?.remove();
  clearYandexCookies();
}

function clearYandexCookies() {
  for (const name of ["_ym_uid", "_ym_d", "_ym_isad", "_ym_visorc"]) {
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
  }
}
