import { ArrowGlyph, RouteGlyph, SignalGlyph } from "./brand-glyphs";
import sceneStyles from "./delivery-scene.module.css";
import { DEMO_COMPANY } from "./landing-copy";
import styles from "./landing.module.css";

const DELIVERY_STEPS = [
  { title: "Профиль агентства", text: "Специализация, география, ключевые слова, исключения и ограничения задают профиль поиска." },
  { title: "Сбор evidence", text: "Hiring-сигналы и supporting-источники связываются с одной компанией и сохраняют provenance." },
  { title: "Проверка и оценка", text: "Радар проверяет свежесть, силу сигнала, соответствие профилю и достижимость корпоративного контакта." },
  { title: "Короткая выдача", text: "Вместо потока вакансий — приоритетные компании с «почему сейчас», evidence и следующим безопасным шагом." },
  { title: "Маршруты доставки", text: "Выдача остаётся в веб-кабинете и может дублироваться в настроенные Telegram, VK, email, browser push или signed webhook." },
  { title: "Решение пользователя", text: "Вы перепроверяете факты, выбираете компанию и сами решаете, обращаться ли к ней." },
] as const;

type DeliveryChannelKey = "cabinet" | "telegram" | "vk" | "email" | "push" | "webhook";

const DELIVERY_CHANNELS: ReadonlyArray<{
  key: DeliveryChannelKey;
  title: string;
  status: string;
  text: string;
  note: string;
}> = [
  {
    key: "cabinet",
    title: "Веб-кабинет",
    status: "базовый",
    text: "Карточки возможностей, evidence, приоритет и обратная связь остаются внутри продукта.",
    note: "рабочая поверхность продукта",
  },
  {
    key: "telegram",
    title: "Telegram",
    status: "подключаемый",
    text: "Клиентский bot может доставлять digest и hot-lead события в личный чат, группу или канал.",
    note: "customer-managed bot / endpoint",
  },
  {
    key: "vk",
    title: "VK",
    status: "подключаемый",
    text: "Notification platform умеет доставлять события через подключённое VK-сообщество.",
    note: "community token / verified peer",
  },
  {
    key: "email",
    title: "Email digest",
    status: "подключаемый",
    text: "Ежедневная агрегированная выдача может приходить на рабочий email профиля.",
    note: "SMTP + profile opt-in",
  },
  {
    key: "push",
    title: "Browser push",
    status: "по подписке",
    text: "Браузерные уведомления используются для новых сильных лидов при активной push-подписке.",
    note: "VAPID / active subscription",
  },
  {
    key: "webhook",
    title: "Signed webhook",
    status: "интеграция",
    text: "Подписанный HTTPS webhook позволяет передавать события в собственный n8n, CRM или внутренний workflow.",
    note: "HMAC / customer endpoint",
  },
] as const;

function DeliveryChannelGlyph({ channel }: { channel: DeliveryChannelKey }) {
  if (channel === "cabinet") {
    return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="5" width="17" height="12.5" rx="1.5" stroke="currentColor" strokeWidth="1.35" /><path d="M7 20h10M9.5 17.5v2.5m5-2.5V20" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" /><circle cx="7" cy="9" r="1" fill="currentColor" /><path d="M10 9h6M7 13h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity=".58" /></svg>;
  }
  if (channel === "telegram") {
    return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m4 11 15.5-6-3.1 14-4.8-4.1-2.8 2.4.5-4.1L17 7.5 7.8 12" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
  if (channel === "vk") {
    return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 7.5c.4 5.9 3.4 9 8.2 9h.7v-3.4c2.2.2 3.8 1.8 4.4 3.4H21c-.8-2.4-2.9-4.1-4.2-4.8 1.3-.8 3.2-2.8 3.7-4.2h-2.5c-.7 1.7-2.4 3.6-4.1 3.8V7.5h-2.5v6.6c-1.8-.5-4-2.6-4.1-6.6z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" /></svg>;
  }
  if (channel === "email") {
    return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="6" width="17" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.35" /><path d="m5 8 7 5 7-5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
  if (channel === "push") {
    return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7.5 16.5h9l-1.1-1.8v-4a3.4 3.4 0 0 0-6.8 0v4z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" /><path d="M10 18.5a2.2 2.2 0 0 0 4 0M18.5 7.5c.7.8 1 1.7 1 2.7M5.5 7.5c-.7.8-1 1.7-1 2.7" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" /></svg>;
  }
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8.5 7.5 4 12l4.5 4.5M15.5 7.5 20 12l-4.5 4.5M13.5 5l-3 14" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export default function DeliveryScene() {
  return (
    <section
      id="scene-delivery"
      className={`${styles.scene} ${styles.lightScene} ${styles.deliveryScene}`}
      aria-labelledby="delivery-title"
      data-header-tone="light"
    >
      <div className={styles.deliveryLayout}>
        <div className={styles.deliveryIntro}>
          <p className={styles.sceneLabel}>05 — Как работает доставка</p>
          <h2 id="delivery-title" className={styles.sceneHeading}>
            От профиля агентства до <em>короткой выдачи в нужном канале.</em>
          </h2>
          <p className={styles.sceneLead}>
            Система автоматизирует исследование, приоритизацию и доставку рекомендации. Она не подменяет решение пользователя и не рассылает обращения компаниям.
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
              <span>Delivery platform / 06 surfaces</span>
              <strong>Не один мессенджер. Один радар — несколько маршрутов доставки.</strong>
            </div>
            <p>Каналы активируются только после настройки соответствующего endpoint. Наличие адаптера не подменяет проверку credentials и доступности провайдера.</p>
          </div>
          <div className={sceneStyles.channelGrid}>
            {DELIVERY_CHANNELS.map((channel) => (
              <article key={channel.key} className={sceneStyles.channelCard} data-channel={channel.key}>
                <div className={sceneStyles.channelTopline}>
                  <span className={sceneStyles.channelIcon}><DeliveryChannelGlyph channel={channel.key} /></span>
                  <span className={sceneStyles.channelStatus}>{channel.status}</span>
                </div>
                <h3>{channel.title}</h3>
                <p>{channel.text}</p>
                <small>{channel.note}</small>
              </article>
            ))}
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
            <strong>Recruiter Radar доставляет рекомендацию, но не отправляет сообщение компании.</strong>
            <p>Черновик, финальная проверка и отправка остаются в руках пользователя.</p>
          </aside>
        </div>
      </div>
    </section>
  );
}
