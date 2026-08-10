import { ArrowGlyph, RouteGlyph, SignalGlyph } from "./brand-glyphs";
import sceneStyles from "./delivery-scene.module.css";
import { DEMO_COMPANY } from "./landing-copy";
import styles from "./landing.module.css";

const DELIVERY_STEPS = [
  { title: "Настроили профиль", text: "Специализация и рынок задают границы поиска." },
  { title: "Radar следит", text: "Сигналы связываются с компаниями и проверяемыми источниками." },
  { title: "Получили возможности", text: "Короткая выдача объясняет, кому стоит написать и почему." },
] as const;

type DeliveryChannelKey = "cabinet" | "telegram" | "email" | "integration";

const DELIVERY_CHANNELS: ReadonlyArray<{
  key: DeliveryChannelKey;
  title: string;
  status: string;
  text: string;
  note: string;
}> = [
  {
    key: "cabinet",
    title: "Web",
    status: "базовый",
    text: "Карточки возможностей и доказательства остаются в рабочем кабинете.",
    note: "основная поверхность",
  },
  {
    key: "telegram",
    title: "Telegram",
    status: "подключаемый",
    text: "Ежедневная выдача приходит через подключённого бота.",
    note: "после проверки подключения",
  },
  {
    key: "email",
    title: "Email",
    status: "подключаемый",
    text: "Агрегированная выдача приходит на рабочий адрес профиля.",
    note: "после согласия в профиле",
  },
  {
    key: "integration",
    title: "+ интеграции",
    status: "интеграция",
    text: "Подключаемые маршруты передают события в ваш рабочий процесс.",
    note: "настраиваются отдельно",
  },
] as const;

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
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8.5 7.5 4 12l4.5 4.5M15.5 7.5 20 12l-4.5 4.5M13.5 5l-3 14" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export default function DeliveryScene() {
  const coreChannel = DELIVERY_CHANNELS[0];

  return (
    <section
      id="scene-delivery"
      className={`${styles.scene} ${styles.lightScene} ${styles.deliveryScene}`}
      aria-labelledby="delivery-title"
      data-header-tone="light"
      data-motion-reveal="section"
    >
      <div className={styles.deliveryLayout}>
        <div className={styles.deliveryIntro}>
          <p className={styles.sceneLabel}>Рабочий процесс</p>
          <h2 id="delivery-title" className={styles.sceneHeading}>
            Как радар попадает <em>в ваш рабочий процесс.</em>
          </h2>
          <p className={styles.sceneLead}>
            Настройте профиль один раз: Radar следит за изменениями и приносит короткую выдачу с доказательствами.
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
              <strong>Возможности приходят туда, где вы работаете.</strong>
            </div>
            <p>Web доступен всегда. Остальные каналы включаются после настройки и проверки подключения.</p>
          </div>
          <div className={sceneStyles.channelHierarchy}>
            <article className={sceneStyles.coreChannel} data-channel={coreChannel.key} data-delivery-core="workspace">
              <div className={sceneStyles.channelTopline}>
                <span className={sceneStyles.channelIcon}><DeliveryChannelGlyph channel={coreChannel.key} /></span>
                <span className={sceneStyles.channelStatus}>{coreChannel.status}</span>
              </div>
              <span className={sceneStyles.groupLabel}>Core / Radar workspace</span>
              <h3>{coreChannel.title}</h3>
              <p>{coreChannel.text}</p>
              <small>{coreChannel.note}</small>
            </article>
            <div className={sceneStyles.deliveryRoutes} data-delivery-routes="connected">
              <span className={sceneStyles.groupLabel}>Delivery / подключаемые маршруты</span>
              {DELIVERY_CHANNELS.slice(1).map((channel) => (
                <article key={channel.key} className={sceneStyles.channelRoute} data-channel={channel.key}>
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
              ))}
            </div>
          </div>
        </div>

        <div className={styles.deliveryDemo}>
          <div className={styles.deliveryChannel}>
            <div><SignalGlyph size={48} /><span>Пример канала / утренняя выдача</span></div>
            <strong>{DEMO_COMPANY.name}</strong>
            <p>{DEMO_COMPANY.signal}</p>
            <dl>
              <div><dt>Почему сейчас</dt><dd>{DEMO_COMPANY.whyNow}</dd></div>
              <div><dt>Достоверность</dt><dd>{DEMO_COMPANY.confidence}</dd></div>
              <div><dt>Следующий шаг</dt><dd>Открыть журнал доказательств и выбрать корпоративный путь контакта.</dd></div>
            </dl>
          </div>
          <aside className={styles.deliveryBoundary}>
            <span>Граница автоматизации</span>
            <strong>Обращение компаниям всегда отправляете вы.</strong>
          </aside>
        </div>
      </div>
    </section>
  );
}
