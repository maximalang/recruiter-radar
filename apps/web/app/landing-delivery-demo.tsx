"use client";

import { useId, useRef, useState } from "react";

import {
  LANDING_ANALYTICS_CONTEXT,
  LANDING_ANALYTICS_DOM_EVENT,
  LANDING_ANALYTICS_EVENT,
  type LandingAnalyticsEventName,
} from "../lib/landing-analytics-contract";
import hpStyles from "./home-page-components.module.css";

const CHANNELS = [
  { id: "telegram", label: "Telegram" },
  { id: "email", label: "Email" },
  { id: "web-push", label: "Web push" },
  { id: "vk", label: "VK" },
  { id: "webhook", label: "Webhook" },
] as const;

const FEEDBACK = [
  {
    id: "take",
    label: "Беру в работу",
    confirmation: "Будущая выдача усилит похожие подтверждённые сигналы.",
  },
  {
    id: "later",
    label: "Позже",
    confirmation: "Будущая выдача сохранит сигнал, но снизит его срочность.",
  },
  {
    id: "reject",
    label: "Не подходит",
    confirmation: "Будущая выдача будет реже показывать похожие компании.",
  },
] as const;

type ChannelId = (typeof CHANNELS)[number]["id"];
type FeedbackId = (typeof FEEDBACK)[number]["id"];

function emitAnalytics(name: LandingAnalyticsEventName) {
  window.dispatchEvent(new CustomEvent(LANDING_ANALYTICS_DOM_EVENT, {
    detail: { name, context: LANDING_ANALYTICS_CONTEXT.deliveryDemo },
  }));
}

export default function LandingDeliveryDemo() {
  const groupId = useId().replace(/:/g, "");
  const [channel, setChannel] = useState<ChannelId>("telegram");
  const [feedback, setFeedback] = useState<FeedbackId | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectChannel = (index: number, focus = false) => {
    const next = CHANNELS[index];
    setChannel(next.id);
    emitAnalytics(LANDING_ANALYTICS_EVENT.deliveryChannelSelected);
    if (focus) tabRefs.current[index]?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % CHANNELS.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + CHANNELS.length) % CHANNELS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = CHANNELS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    selectChannel(nextIndex, true);
  };

  const selectedChannel = CHANNELS.find((item) => item.id === channel) ?? CHANNELS[0];
  const confirmation = FEEDBACK.find((item) => item.id === feedback)?.confirmation ?? "";

  return (
    <article className={`${hpStyles.deliveryCard} ${hpStyles.deliveryDemo}`}>
      <div className={hpStyles.deliveryTopbar}>
        <span className={hpStyles.deliveryMark} aria-hidden="true">RR</span>
        <div>
          <strong>Каналы доставки</strong>
          <span>демонстрация интерфейса</span>
        </div>
      </div>

      <div
        className={hpStyles.deliveryTabs}
        role="tablist"
        aria-label="Канал доставки примера"
      >
        {CHANNELS.map((item, index) => {
          const selected = item.id === channel;
          return (
            <button
              key={item.id}
              ref={(node) => { tabRefs.current[index] = node; }}
              id={`${groupId}-${item.id}-tab`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${groupId}-${item.id}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectChannel(index)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div
        id={`${groupId}-${selectedChannel.id}-panel`}
        className={hpStyles.deliveryPanel}
        role="tabpanel"
        aria-labelledby={`${groupId}-${selectedChannel.id}-tab`}
        tabIndex={0}
      >
        <ChannelPreview channel={channel} />
      </div>

      <div className={hpStyles.feedbackDemo}>
        <span className={hpStyles.feedbackLabel}>Как этот сигнал вам?</span>
        <div className={hpStyles.feedbackChoices} aria-label="Обратная связь по демонстрации">
          {FEEDBACK.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={feedback === item.id}
              onClick={() => {
                setFeedback(item.id);
                emitAnalytics(LANDING_ANALYTICS_EVENT.deliveryFeedbackSelected);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className={hpStyles.feedbackStatus} role="status" aria-live="polite">
          {confirmation}
        </p>
        <button
          type="button"
          className={hpStyles.feedbackReset}
          onClick={() => setFeedback(null)}
        >
          Сбросить пример
        </button>
      </div>

      <p className={hpStyles.deliveryNote}>
        Это демонстрация интерфейса: выбор остаётся локальным и не отправляется в настоящий профиль. Продукт не пишет компаниям автоматически.
      </p>
    </article>
  );
}

function ChannelPreview({ channel }: { channel: ChannelId }) {
  if (channel === "email") {
    return (
      <div className={hpStyles.emailPreview}>
        <span>Тема: инженерный найм усилился — сигнал уровня A</span>
        <h3>Компания для сегодняшнего контакта</h3>
        <p>14 новых вакансий за 6 дней, включая редкую инженерную роль. Доступна корпоративная HR-форма.</p>
        <strong>Открыть карточку лида</strong>
      </div>
    );
  }
  if (channel === "web-push") {
    return (
      <div className={hpStyles.pushPreview}>
        <span>Recruiter Radar · сейчас</span>
        <h3>Новый подтверждённый сигнал</h3>
        <p>Производственная компания усилила инженерный найм.</p>
      </div>
    );
  }
  if (channel === "vk") {
    return (
      <div className={hpStyles.botPreview}>
        <span>VK-бот Recruiter Radar</span>
        <h3>Начните с этого сигнала</h3>
        <p>Найм подтверждён карьерной страницей и вакансией. Корпоративный контакт найден.</p>
      </div>
    );
  }
  if (channel === "webhook") {
    return (
      <pre className={hpStyles.webhookPreview} aria-label="Пример JSON webhook">
{`{
  "company": "Производственная компания",
  "confidence_gate": "A",
  "why_now": "14 вакансий за 6 дней",
  "contact_path": "corporate_hr_form"
}`}
      </pre>
    );
  }
  return (
    <div className={hpStyles.botPreview}>
      <span>Утренний радар · 5 компаний</span>
      <h3>Начните с этого сигнала</h3>
      <p><strong>Производственная компания</strong> усилила инженерный найм. Уровень доверия A, доступна корпоративная HR-форма.</p>
    </div>
  );
}
