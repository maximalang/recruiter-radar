import Script from "next/script";

function readCounterId(): string | null {
  const value = process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID?.trim() ?? "";
  return /^\d{5,12}$/.test(value) ? value : null;
}

export default function YandexMetrika() {
  const counterId = readCounterId();
  if (!counterId) return null;

  const initialization = `
    (function(m,e,t,r,i,k,a){
      m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
      m[i].l=1*new Date();
      k=e.createElement(t);a=e.getElementsByTagName(t)[0];
      k.async=1;k.src=r;a.parentNode.insertBefore(k,a);
    })(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");
    ym(${counterId},"init",{
      clickmap:true,
      trackLinks:true,
      accurateTrackBounce:true,
      webvisor:false,
      sendTitle:false
    });
  `;

  return (
    <Script id="yandex-metrika" strategy="afterInteractive">
      {initialization}
    </Script>
  );
}
