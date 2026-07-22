"use client";

import { useEffect, useRef, useState } from "react";

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

const FEEDBACK = [
  ["Беру в работу", "Сигнал добавлен в работу"],
  ["Позже", "Радар напомнит позже"],
  ["Не подходит", "Похожие сигналы будут понижены"],
] as const;

export function TelegramDeliveryDemo() {
  const [choice, setChoice] = useState<number | null>(null);
  return (
    <div className={hpStyles.deliveryDemo}>
      <span className={hpStyles.interactiveExample}>Интерактивный пример</span>
      <div className={hpStyles.deliveryMessage}>
        <span className={hpStyles.deliveryKicker}>Утренний радар · 5 компаний</span>
        <h3>Начните с этого сигнала</h3>
        <p><strong>Компания из вашего списка</strong> усилила инженерный найм. Уверенность высокая, доступен корпоративный путь контакта.</p>
        <div className={hpStyles.feedbackChoices} aria-label="Пример обратной связи в Telegram">
          {FEEDBACK.map(([label], index) => (
            <button key={label} type="button" aria-pressed={choice === index} onClick={() => setChoice(index)}>{label}</button>
          ))}
        </div>
        <p className={hpStyles.feedbackConfirmation} role="status" aria-live="polite">
          {choice === null ? "Выберите действие — это демонстрация, данные не сохраняются." : FEEDBACK[choice][1]}
        </p>
      </div>
      <div className={hpStyles.feedbackFlow} data-active={choice !== null ? "true" : "false"} aria-label="Ваш выбор улучшает следующую выдачу">
        <span>Ваш выбор</span><i aria-hidden="true" /><span>профиль радара</span><i aria-hidden="true" /><span>следующая выдача</span>
      </div>
    </div>
  );
}
