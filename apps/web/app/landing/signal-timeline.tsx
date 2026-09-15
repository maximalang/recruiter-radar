import type { CSSProperties } from "react";

import { DEFAULT_LANDING_DEMO_STORY } from "../../lib/landing-demo";
import styles from "./signal-timeline.module.css";
import shared from "./landing.module.css";

/* Canonical demo story is the single source of truth for every dated fact.
 * The scene explains the buyer's workflow; the fixed dates make the signal
 * step concrete without implying live freshness or a delivery cadence. */
const STORY = DEFAULT_LANDING_DEMO_STORY;

const WORKFLOW_STEPS = [
  {
    label: "01 · Профиль",
    title: "Настраиваете профиль агентства",
    detail: "инженерный подбор · Москва и область · производство",
    state: "настроено",
  },
  {
    label: "02 · Сигналы",
    title: "Радар проверяет публичные сигналы найма",
    detail: `6 мая · демо-сценарий · 10 мая · демо-сценарий · ${STORY.company.freshness}`,
    state: "проверено",
  },
  {
    label: "03 · Приоритет",
    title: "Получаете приоритетный список компаний",
    detail: "10 компаний · почему сейчас · источник · уверенность",
    state: "готово",
  },
  {
    label: "04 · Решение",
    title: "Решение остаётся за вами",
    detail: "в работу · отложить · не подходит",
    state: "вы решаете",
  },
] as const;

export default function SignalTimeline() {
  return (
    <section
      id="scene-signal-timeline"
      className={`${shared.scene} ${shared.lightScene} ${styles.section}`}
      aria-labelledby="timeline-title"
      data-header-tone="light"
      data-motion-reveal="section"
      data-motion-scene="timeline"
      data-product-workflow="profile-to-contact"
    >
      <div className={styles.layout}>
        <div className={styles.intro} data-motion-primitive="editorialReveal">
          <p className={shared.sceneLabel}>От профиля к первому контакту</p>
          <h2 id="timeline-title" className={shared.sceneHeading}>
            От профиля до первого контакта — четыре понятных шага.
          </h2>
          <p className={shared.sceneLead}>
            Вы задаёте практику и географию. Радар собирает публичные сигналы, расставляет компании по приоритету и оставляет решение за вами.
          </p>
        </div>

        <div className={styles.timeline} aria-label="Рабочий цикл Recruiter Radar">
          <div className={styles.trajectory} aria-hidden="true"><i /></div>
          <ol className={styles.events}>
            {WORKFLOW_STEPS.map((step, index) => (
              <li
                key={step.label}
                className={styles.event}
                data-workflow-step={step.label.slice(0, 2)}
                style={{ "--event-index": index } as CSSProperties}
              >
                <span className={styles.stepLabel}>{step.label}</span>
                <span className={styles.node} aria-hidden="true"><i /></span>
                <div className={styles.eventCopy}>
                  <strong>{step.title}</strong>
                  <small>{step.detail}</small>
                </div>
                <span className={styles.eventState}>{step.state}</span>
              </li>
            ))}
          </ol>
          <div className={styles.lock} data-manual-decision="true">
            <span>КОНТАКТ ПОД ВАШИМ КОНТРОЛЕМ</span>
            <strong>Радар даёт повод и факты. Сообщение отправляете вы.</strong>
            <small>никакой автоматической массовой рассылки</small>
          </div>
        </div>
      </div>
    </section>
  );
}
