import type { CSSProperties } from "react";

import sceneStyles from "./signal-timeline-scene.module.css";
import styles from "./landing.module.css";

const TIMELINE_EVENTS = [
  { date: "4 авг", fact: "Открыты 8 инженерных позиций", source: "карьерная страница", state: "событие" },
  { date: "6 авг", fact: "Появилась роль руководителя направления", source: "публичные вакансии", state: "подтверждение" },
  { date: "9 авг", fact: "Три роли опубликованы повторно", source: "повторная публикация", state: "усиление" },
  { date: "сегодня", fact: "Изменения подтверждены повторной проверкой", source: "3 типа источников", state: "signal lock" },
] as const;

export default function SignalTimelineScene() {
  return (
    <section
      id="scene-signal-timeline"
      className={`${styles.scene} ${styles.lightScene} ${styles.timelineScene} ${sceneStyles.section}`}
      aria-labelledby="timeline-title"
      data-header-tone="light"
      data-motion-reveal="section"
      data-motion-scene="timeline"
    >
      <div className={sceneStyles.layout}>
        <div className={sceneStyles.intro} data-motion-primitive="editorialReveal">
          <p className={styles.sceneLabel}>Почему сейчас</p>
          <h2 id="timeline-title" className={styles.sceneHeading}>
            Один сигнал — шум. <em>Последовательность — повод.</em>
          </h2>
          <p className={styles.sceneLead}>
            Радар связывает независимые изменения во времени и отмечает момент, когда они начинают подтверждать друг друга.
          </p>
        </div>

        <div className={sceneStyles.timeline} aria-label="Последовательность подтверждающих сигналов">
          <div className={sceneStyles.trajectory} aria-hidden="true"><i /></div>
          <ol className={sceneStyles.events}>
            {TIMELINE_EVENTS.map((event, index) => (
              <li
                key={`${event.date}-${event.fact}`}
                className={sceneStyles.event}
                tabIndex={0}
                data-timeline-event
                style={{ "--event-index": index } as CSSProperties}
              >
                <time>{event.date}</time>
                <span className={sceneStyles.node} aria-hidden="true"><i /></span>
                <div className={sceneStyles.eventCopy}>
                  <strong>{event.fact}</strong>
                  <small>{event.source}</small>
                </div>
                <span className={sceneStyles.eventState}>{event.state}</span>
              </li>
            ))}
          </ol>
          <div className={sceneStyles.lock} data-opportunity-lock="true">
            <span>СИЛЬНАЯ ВОЗМОЖНОСТЬ</span>
            <strong>Сигналы подтверждают друг друга.</strong>
            <small>проверяемый повод для первого контакта</small>
          </div>
        </div>
      </div>
    </section>
  );
}
