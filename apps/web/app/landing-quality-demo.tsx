"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import hpStyles from "./home-page-components.module.css";

const PIPELINE = [
  ["Сигнал найма", "Радар фиксирует изменение найма и сохраняет исходную дату и источник."],
  ["Проверка компании", "Сигнал связывается с подтверждённым юрлицом, доменом и корпоративным каналом."],
  ["Контекст момента", "Свежесть, динамика и официальные события объясняют, почему обращаться уместно сейчас."],
  ["Порог доверия", "Сигнал допускается только при достаточном качестве доказательств и чистом совпадении компании."],
  ["Клиентская выдача", "Агентство получает факты, ограничения и следующий шаг — без автоматической рассылки."],
] as const;

export function MethodPipeline() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const interactedRef = useRef(false);
  const [active, setActive] = useState(0);
  const [enhanced, setEnhanced] = useState(false);

  useEffect(() => {
    setEnhanced(true);
    const root = rootRef.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setActive(PIPELINE.length - 1);
      return;
    }
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || interactedRef.current || timerRef.current) return;
      let index = 0;
      timerRef.current = setInterval(() => {
        index += 1;
        setActive(Math.min(index, PIPELINE.length - 1));
        if (index >= PIPELINE.length - 1 && timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }, 720);
      observer.disconnect();
    }, { threshold: 0.35 });
    observer.observe(root);
    return () => {
      observer.disconnect();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const choose = (index: number) => {
    interactedRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setActive(index);
  };

  return (
    <div ref={rootRef} className={hpStyles.methodInteractive} data-enhanced={enhanced ? "true" : "false"}>
      <div className={hpStyles.methodPipeline} aria-label="Путь сигнала до клиентской выдачи" style={{ "--pipeline-progress": active / (PIPELINE.length - 1) } as React.CSSProperties}>
        {PIPELINE.map(([label], index) => (
          <button key={label} type="button" aria-label={label} aria-pressed={active === index} onClick={() => choose(index)}><span aria-hidden="true">{index + 1}</span>{label}</button>
        ))}
      </div>
      <div className={hpStyles.pipelineExplanations} aria-live="polite">
        {PIPELINE.map(([label, copy], index) => (
          <p key={label} data-active={active === index ? "true" : "false"}><strong>{label}.</strong> {copy}</p>
        ))}
      </div>
    </div>
  );
}

const FIUR_TERMS = [
  ["Соответствие · Fit", "Насколько отрасль, роли и география совпадают с профилем агентства."],
  ["Намерение · Intent", "Насколько уверенно несколько фактов подтверждают реальный спрос на найм."],
  ["Актуальность · Urgency", "Насколько свежо изменение и остаётся ли окно для уместного обращения."],
  ["Доступность · Reachability", "Есть ли законный корпоративный путь контакта без сбора личных данных."],
] as const;

export function FiurGlossary() {
  const [active, setActive] = useState<number | null>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setActive(null);
  };

  return (
    <div className={hpStyles.methodFiurLine} aria-label="Состав приоритета FIUR">
      {FIUR_TERMS.map(([label, description], index) => {
        const expanded = active === index;
        const tooltipId = `fiur-tooltip-${index}`;
        return (
          <span
            key={label}
            className={hpStyles.fiurTerm}
            onMouseLeave={() => setActive((current) => current === index ? null : current)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setActive(null);
            }}
          >
            <button
              type="button"
              aria-expanded={expanded}
              aria-describedby={expanded ? tooltipId : undefined}
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              onClick={() => setActive(index)}
              onKeyDown={onKeyDown}
            >
              {label}<span aria-hidden="true">?</span>
            </button>
            {expanded ? <small id={tooltipId} role="tooltip">{description}</small> : null}
          </span>
        );
      })}
    </div>
  );
}

const FEEDBACK = [
  ["Беру в работу", "Сигнал добавлен в работу"],
  ["Позже", "Радар напомнит позже"],
  ["Не подходит", "Похожие сигналы будут понижены"],
] as const;

const DELIVERY_CHANNELS = [
  ["telegram", "Telegram", "Карточка приходит в рабочий чат по расписанию профиля."],
  ["email", "Email", "Короткий дайджест приходит на подключённый корпоративный адрес."],
  ["web-push", "Web push", "Браузер показывает короткое уведомление и ведёт к доказательствам."],
  ["vk", "VK", "Уведомление приходит в подключённое рабочее сообщество."],
  ["webhook", "Webhook", "Структурированное событие уходит в вашу CRM или внутренний процесс."],
] as const;

export function TelegramDeliveryDemo() {
  const [choice, setChoice] = useState<number | null>(null);
  const [channelIndex, setChannelIndex] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const channel = DELIVERY_CHANNELS[channelIndex];

  const chooseChannel = (index: number, focus = false) => {
    setChannelIndex(index);
    setChoice(null);
    if (focus) tabRefs.current[index]?.focus();
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % DELIVERY_CHANNELS.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + DELIVERY_CHANNELS.length) % DELIVERY_CHANNELS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = DELIVERY_CHANNELS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    chooseChannel(nextIndex, true);
  };

  return (
    <div className={hpStyles.deliveryDemo}>
      <span className={hpStyles.interactiveExample}>Интерактивный пример</span>
      <div className={hpStyles.deliveryTabs} role="tablist" aria-label="Канал доставки радара">
        {DELIVERY_CHANNELS.map(([, label], index) => (
          <button
            key={label}
            ref={(node) => { tabRefs.current[index] = node; }}
            id={`delivery-tab-${index}`}
            type="button"
            role="tab"
            aria-selected={channelIndex === index}
            aria-controls="delivery-channel-panel"
            tabIndex={channelIndex === index ? 0 : -1}
            onClick={() => chooseChannel(index)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        id="delivery-channel-panel"
        className={hpStyles.deliveryMessage}
        role="tabpanel"
        aria-labelledby={`delivery-tab-${channelIndex}`}
        tabIndex={0}
      >
        <span className={hpStyles.deliveryKicker}>{channel[1]} · утренний радар · 5 компаний</span>
        <h3>Начните с этого сигнала</h3>
        <p><strong>Компания из вашего списка</strong> усилила инженерный найм. {channel[2]}</p>
        <div className={hpStyles.feedbackChoices} aria-label={`Пример обратной связи в ${channel[1]}`}>
          {FEEDBACK.map(([label], index) => (
            <button key={label} type="button" aria-pressed={choice === index} onClick={() => setChoice(index)}>{label}</button>
          ))}
        </div>
        <p className={hpStyles.feedbackConfirmation} role="status" aria-live="polite">
          {choice === null ? "Выберите действие — это демонстрация, данные не сохраняются." : FEEDBACK[choice][1]}
        </p>
        <button type="button" className={hpStyles.feedbackReset} disabled={choice === null} onClick={() => setChoice(null)}>Сбросить выбор</button>
      </div>
      <div className={hpStyles.feedbackFlow} data-active={choice !== null ? "true" : "false"} aria-label="Ваш выбор улучшает следующую выдачу">
        <span>Ваш выбор</span><i aria-hidden="true" /><span>профиль радара</span><i aria-hidden="true" /><span>следующая выдача</span>
      </div>
      <p className={hpStyles.feedbackLoopNote}><strong>Контур обратной связи.</strong> Это локальная демонстрация: выбор не сохраняется и не запускает автоматическую отправку.</p>
    </div>
  );
}
