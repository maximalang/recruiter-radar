import { ArrowGlyph, RouteGlyph } from "./brand-glyphs";
import sceneStyles from "./delivery-scene.module.css";
import styles from "./landing.module.css";

const DELIVERY_STEPS = [
  { title: "Задайте нишу", text: "Укажите специализацию и географию агентства." },
  { title: "Радар следит за рынком", text: "Свежие изменения в найме связываются с компаниями и проверяются по источникам." },
  { title: "Получайте компании с поводом", text: "В выдаче видно, кому написать, почему сейчас и на каких фактах это основано." },
] as const;

type DeliveryChannelKey = "cabinet" | "telegram" | "email" | "vk" | "push" | "webhook";

type DeliveryChannel = {
  key: DeliveryChannelKey;
  title: string;
  status: string;
  text: string;
  note: string;
};

const CORE_CHANNEL: DeliveryChannel = {
  key: "cabinet",
  title: "Веб-кабинет",
  status: "Всегда доступен",
  text: "Полная карточка компании, причины приоритета, факты и история сигнала.",
  note: "основной рабочий экран",
};

const PRIMARY_ROUTES: ReadonlyArray<DeliveryChannel> = [
  {
    key: "telegram",
    title: "Telegram",
    status: "Можно подключить",
    text: "Короткая подборка новых возможностей.",
    note: "дополнительные уведомления",
  },
  {
    key: "email",
    title: "Email",
    status: "Можно подключить",
    text: "Регулярная подборка на рабочую почту.",
    note: "дополнительные уведомления",
  },
];

const EXTRA_ROUTES: ReadonlyArray<DeliveryChannel> = [
  {
    key: "vk",
    title: "VK",
    status: "Можно подключить",
    text: "Уведомления через рабочее сообщество.",
    note: "после настройки",
  },
  {
    key: "push",
    title: "Push в браузере",
    status: "Можно подключить",
    text: "Уведомления в браузере.",
    note: "после настройки",
  },
  {
    key: "webhook",
    title: "Webhook",
    status: "Можно подключить",
    text: "Передача событий во внешний рабочий процесс.",
    note: "после отдельной настройки",
  },
];

function DeliveryChannelGlyph({ channel }: { channel: DeliveryChannelKey }) {
  if (channel === "cabinet") {
    return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="5" width="17" height="12.5" rx="1.5" stroke="currentColor" strokeWidth="1.35" /><path d="M7 20h10M9.5 17.5v2.5m5-2.5V20" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" /><circle cx="7" cy="9" r="1" fill="currentColor" /><path d="M10 9h6M7 13h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity=".58" /></svg>;
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
    return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7.5 16.5h9l-1.1-1.8v-4a3.4 3.4 0 0 0-6.8 0v4z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" /><path d="M10 18.5a2.2 2.2 0 0 0 4 0M18.5 7.5c.7.8 1 1.7 1 2.7M5.5 7.5c-.7.8-1 1.7-1 2.7" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" /></svg>;
  }
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8.5 7.5 4 12l4.5 4.5M15.5 7.5 20 12l-4.5 4.5M13.5 5l-3 14" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function ChannelRoute({ channel }: { channel: DeliveryChannel }) {
  return (
    <article className={sceneStyles.channelRoute} data-channel={channel.key}>
      <span className={sceneStyles.channelIcon}><DeliveryChannelGlyph channel={channel.key} /></span>
      <div>
        <div className={sceneStyles.routeHeading}>
          <h3>{channel.title}</h3>
          <span className={sceneStyles.channelStatus}>{channel.status}</span>
        </div>
        <p>{channel.text}</p>
      </div>
      <small>{channel.note}</small>
    </article>
  );
}

export default function DeliveryScene() {
  return (
    <section
      id="scene-delivery"
      className={`${styles.scene} ${styles.lightScene} ${styles.deliveryScene} ${sceneStyles.section}`}
      style={{ scrollMarginTop: "calc(72px + 32px)" }}
      aria-labelledby="delivery-title"
      data-header-tone="light"
      data-motion-reveal="section"
      data-delivery-summary="compact"
    >
      <div className={styles.deliveryLayout}>
        <div className={styles.deliveryIntro}>
          <p className={styles.sceneLabel}>От сигнала к контакту</p>
          <h2 id="delivery-title" className={styles.sceneHeading}>
            Радар находит повод. <em>Пишете вы.</em>
          </h2>
          <p className={styles.sceneLead}>
            Задайте нишу, получите подтверждённый повод и выберите корпоративный путь контакта. Финальное решение всегда остаётся за вами.
          </p>
        </div>

        <ol className={styles.deliveryFlow}>
          {DELIVERY_STEPS.map((step, index) => (
            <li key={step.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div><strong>{step.title}</strong><p>{step.text}</p></div>
              {index < DELIVERY_STEPS.length - 1 ? <ArrowGlyph size={16} /> : <RouteGlyph size={18} />}
            </li>
          ))}
        </ol>

        <div className={sceneStyles.capabilityPanel} aria-label="Поддерживаемые способы доставки">
          <div className={sceneStyles.capabilityHeader}>
            <div>
              <span>Доставка</span>
              <strong>Работайте в кабинете. Уведомления приходят туда, где удобно.</strong>
            </div>
            <p>Полная карточка и доказательства остаются в веб-кабинете; остальные каналы сообщают о новом сигнале.</p>
          </div>
          <div className={sceneStyles.channelHierarchy}>
            <article className={sceneStyles.coreChannel} data-channel={CORE_CHANNEL.key} data-delivery-core="workspace">
              <div className={sceneStyles.channelTopline}>
                <span className={sceneStyles.channelIcon}><DeliveryChannelGlyph channel={CORE_CHANNEL.key} /></span>
                <span className={sceneStyles.channelStatus}>{CORE_CHANNEL.status}</span>
              </div>
              <span className={sceneStyles.groupLabel}>Рабочий кабинет</span>
              <h3>{CORE_CHANNEL.title}</h3>
              <p>{CORE_CHANNEL.text}</p>
              <small>{CORE_CHANNEL.note}</small>
            </article>
            <div className={sceneStyles.deliveryRoutes} data-delivery-routes="connected">
              <span className={sceneStyles.groupLabel}>Дополнительные каналы</span>
              {PRIMARY_ROUTES.map((channel) => <ChannelRoute key={channel.key} channel={channel} />)}
              <details className={sceneStyles.moreRoutes}>
                <summary><span>+ ещё 3 канала</span><small>VK · Push · Webhook</small></summary>
                <div className={sceneStyles.extraRoutes}>
                  {EXTRA_ROUTES.map((channel) => <ChannelRoute key={channel.key} channel={channel} />)}
                </div>
              </details>
            </div>
          </div>
        </div>

        <aside className={styles.deliveryBoundary} data-manual-outreach-boundary="true">
          <span>Контроль остаётся у вас</span>
          <strong>Сообщения компаниям не отправляются автоматически.</strong>
        </aside>
      </div>
    </section>
  );
}
