import sceneStyles from "./delivery-scene.module.css";

type DeliveryChannelKey = "telegram" | "email" | "vk" | "push" | "webhook";

type DeliveryChannel = {
  key: DeliveryChannelKey;
  title: string;
  text: string;
};

const PRIMARY_ROUTES: ReadonlyArray<DeliveryChannel> = [
  { key: "telegram", title: "Telegram", text: "Короткое уведомление о новом приоритетном сигнале." },
  { key: "email", title: "Email", text: "Подборка новых возможностей на рабочую почту." },
];

const EXTRA_ROUTES: ReadonlyArray<DeliveryChannel> = [
  { key: "vk", title: "VK", text: "Уведомления через рабочее сообщество." },
  { key: "push", title: "Push в браузере", text: "Короткие браузерные уведомления." },
  { key: "webhook", title: "Webhook", text: "Передача события во внешний рабочий процесс." },
];

function DeliveryChannelGlyph({ channel }: { channel: DeliveryChannelKey | "cabinet" }) {
  if (channel === "cabinet") {
    return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="5" width="17" height="12.5" rx="1.5" stroke="currentColor" strokeWidth="1.35" /><path d="M7 20h10M9.5 17.5v2.5m5-2.5V20" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" /></svg>;
  }
  if (channel === "telegram") {
    return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m4 11 15.5-6-3.1 14-4.8-4.1-2.8 2.4.5-4.1L17 7.5 7.8 12" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
  if (channel === "email") {
    return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="6" width="17" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.35" /><path d="m5 8 7 5 7-5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
  if (channel === "vk") {
    return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 7.5c.4 5.9 3.4 9 8.2 9h.7v-3.4c2.2.2 3.8 1.8 4.4 3.4H21c-.8-2.4-2.9-4.1-4.2-4.8 1.3-.8 3.2-2.8 3.7-4.2H18c-.7 1.7-2.4 3.6-4.1 3.8V7.5h-2.5v6.6c-1.8-.5-4-2.6-4.1-6.6z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" /></svg>;
  }
  if (channel === "push") {
    return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7.5 16.5h9l-1.1-1.8v-4a3.4 3.4 0 0 0-6.8 0v4z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" /><path d="M10 18.5a2.2 2.2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" /></svg>;
  }
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8.5 7.5 4 12l4.5 4.5M15.5 7.5 20 12l-4.5 4.5M13.5 5l-3 14" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function ChannelRoute({ channel }: { channel: DeliveryChannel }) {
  return (
    <article className={sceneStyles.channelRoute} data-channel={channel.key}>
      <span className={sceneStyles.channelIcon}><DeliveryChannelGlyph channel={channel.key} /></span>
      <div><strong>{channel.title}</strong><p>{channel.text}</p></div>
    </article>
  );
}

export default function DeliveryScene() {
  return (
    <section
      id="scene-delivery"
      className={sceneStyles.section}
      style={{ scrollMarginTop: "calc(72px + 32px)" }}
      aria-labelledby="delivery-title"
      data-header-tone="light"
      data-motion-reveal="section"
      data-delivery-summary="compact"
    >
      <div className={sceneStyles.layout}>
        <div className={sceneStyles.intro}>
          <p>Как приходят результаты</p>
          <h2 id="delivery-title">Результаты — в веб-кабинете. Уведомления — Telegram / Email. Компании пишете вы.</h2>
        </div>

        <div className={sceneStyles.capabilityBand} aria-label="Поддерживаемые способы доставки">
          <article className={sceneStyles.cabinet} data-channel="cabinet" data-delivery-core="workspace">
            <span className={sceneStyles.channelIcon}><DeliveryChannelGlyph channel="cabinet" /></span>
            <div>
              <small>Основной рабочий экран</small>
              <strong>Веб-кабинет</strong>
              <p>Компания, почему сейчас, факты, confidence и официальный путь контакта.</p>
            </div>
          </article>

          <div className={sceneStyles.deliveryRoutes} data-delivery-routes="connected">
            {PRIMARY_ROUTES.map((channel) => <ChannelRoute key={channel.key} channel={channel} />)}
          </div>
        </div>

        <div className={sceneStyles.boundaryRow}>
          <aside className={sceneStyles.manualBoundary} data-manual-outreach-boundary="true">
            <span>Ручной контроль</span>
            <strong>Сообщения компаниям не отправляются автоматически.</strong>
          </aside>
          <details className={sceneStyles.moreRoutes}>
            <summary>Ещё каналы: VK · Push · Webhook</summary>
            <div className={sceneStyles.extraRoutes}>
              {EXTRA_ROUTES.map((channel) => <ChannelRoute key={channel.key} channel={channel} />)}
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}
