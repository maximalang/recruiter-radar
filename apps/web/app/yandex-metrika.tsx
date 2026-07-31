"use client";

import Link from "next/link";
import Script from "next/script";
import { useEffect, useState } from "react";

const ANALYTICS_CONSENT_KEY = "rr_analytics_consent_v1";
type AnalyticsConsent = "pending" | "accepted" | "rejected";

function readCounterId(): string | null {
  const value = process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID?.trim() ?? "";
  return /^\d{5,12}$/.test(value) ? value : null;
}

export default function YandexMetrika() {
  const counterId = readCounterId();
  const [mounted, setMounted] = useState(false);
  const [consent, setConsent] = useState<AnalyticsConsent>("pending");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const stored = window.localStorage.getItem(ANALYTICS_CONSENT_KEY);
      if (stored === "accepted" || stored === "rejected") setConsent(stored);
    } catch {
      // Если localStorage недоступен, необязательная аналитика остаётся выключенной.
    }
  }, []);

  useEffect(() => {
    if (consent !== "accepted" || !counterId || !ready || typeof window.ym !== "function") return;
    window.ym(Number(counterId), "hit", "/", { title: document.title });
  }, [consent, counterId, ready]);

  if (!counterId) return null;

  function decide(next: Exclude<AnalyticsConsent, "pending">) {
    try {
      window.localStorage.setItem(ANALYTICS_CONSENT_KEY, next);
    } catch {
      // Решение всё равно применяется в текущей вкладке.
    }
    setConsent(next);
  }

  if (consent === "accepted") {
    const initialization = `
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
    `;

    return (
      <Script id="yandex-metrika-loader" strategy="afterInteractive" onReady={() => setReady(true)}>
        {initialization}
      </Script>
    );
  }

  if (!mounted || consent === "rejected") return null;

  return (
    <aside
      role="dialog"
      aria-label="Настройки аналитики"
      style={{
        position: "fixed",
        zIndex: 1000,
        left: 16,
        right: 16,
        bottom: 16,
        maxWidth: 720,
        margin: "0 auto",
        padding: "16px 18px",
        borderRadius: 18,
        border: "1px solid rgba(15, 23, 42, 0.12)",
        background: "rgba(255, 255, 255, 0.96)",
        boxShadow: "0 20px 60px rgba(15, 23, 42, 0.18)",
        backdropFilter: "blur(18px)",
        display: "grid",
        gap: 12,
      }}
    >
      <div style={{ display: "grid", gap: 5 }}>
        <strong style={{ fontSize: 15 }}>Необязательная аналитика</strong>
        <span style={{ fontSize: 13, lineHeight: 1.5, color: "#475569" }}>
          Яндекс Метрика включится только после разрешения и только на публичной странице. Личный кабинет, профиль и платёжные данные не передаются. {" "}
          <Link href="/privacy" style={{ color: "inherit", textDecoration: "underline" }}>Подробнее</Link>
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" onClick={() => decide("accepted")} style={{ border: 0, borderRadius: 999, padding: "9px 15px", background: "#0f172a", color: "white", font: "inherit", fontWeight: 650, cursor: "pointer" }}>
          Разрешить аналитику
        </button>
        <button type="button" onClick={() => decide("rejected")} style={{ border: "1px solid rgba(15, 23, 42, 0.16)", borderRadius: 999, padding: "9px 15px", background: "transparent", color: "#334155", font: "inherit", fontWeight: 600, cursor: "pointer" }}>
          Только необходимые cookies
        </button>
      </div>
    </aside>
  );
}
