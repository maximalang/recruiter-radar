"use client";

import Script from "next/script";
import { useEffect, useState } from "react";

function readCounterId(): string | null {
  const value = process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID?.trim() ?? "";
  return /^\d{5,12}$/.test(value) ? value : null;
}

export default function YandexMetrika({
  pathname,
}: {
  pathname: "/" | "/checkout" | "/onboarding";
}) {
  const counterId = readCounterId();
  const [ready, setReady] = useState(false);

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
  useEffect(() => {
    if (!counterId || !ready || typeof window.ym !== "function") return;
    window.ym(Number(counterId), "hit", pathname, { title: document.title });
  }, [counterId, pathname, ready]);

  if (!counterId) return null;

  return (
    <Script
      id="yandex-metrika-loader"
      strategy="afterInteractive"
      onReady={() => setReady(true)}
    >
      {initialization}
    </Script>
  );
}
