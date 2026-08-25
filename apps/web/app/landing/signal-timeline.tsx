import type { CSSProperties } from "react";

import { DEFAULT_LANDING_DEMO_STORY } from "../../lib/landing-demo";
import styles from "./signal-timeline.module.css";
import shared from "./landing.module.css";

/* Canonical demo story is the single source of truth for every dated fact.
 * The sequence reads as an editorial ledger: what opened, what repeated,
 * what was confirmed on re-check — ending in one assembled reason. */
const STORY = DEFAULT_LANDING_DEMO_STORY;

const TIMELINE_EVENTS = [
  {
    date: "6 мая · демо-сценарий",
    fact: `Открыты ${STORY.company.vacanciesCount} инженерных ролей`,
    source: "карьерная страница",
    state: "новый сигнал",
  },
  {
    date: "10 мая · демо-сценарий",
    fact: "Появилась новая редкая инженерная роль",
    source: "публичные вакансии",
    state: "интерес растёт",
  },
  {
    date: "11 мая · демо-сценарий",
    fact: "Найм остаётся активным — публикации обновлены",
    source: "повторная публикация",
    state: "подтверждение",
  },
  {
    date: STORY.company.freshness,
    fact: "Изменения подтверждены повторной проверкой",
    source: `${STORY.evidence.length} подтверждающих факта`,
    state: "приоритет повышен",
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
    >
      <div className={styles.layout}>
        <div className={styles.intro} data-motion-primitive="editorialReveal">
          <p className={shared.sceneLabel}>Сигнал во времени</p>
          <h2 id="timeline-title" className={shared.sceneHeading}>
            Один сигнал — шум. <em>Несколько подряд — повод.</em>
          </h2>
          <p className={shared.sceneLead}>
            Так одна компания поднимается в вашем списке: что открылось, что повторилось и что подтвердилось при следующей проверке.
          </p>
        </div>

        <div className={styles.timeline} aria-label="Последовательность подтверждающих сигналов">
          <div className={styles.trajectory} aria-hidden="true"><i /></div>
          <ol className={styles.events}>
            {TIMELINE_EVENTS.map((event, index) => (
              <li
                key={`${event.date}-${event.fact}`}
                className={styles.event}
                data-timeline-event
                style={{ "--event-index": index } as CSSProperties}
              >
                <time>{event.date}</time>
                <span className={styles.node} aria-hidden="true"><i /></span>
                <div className={styles.eventCopy}>
                  <strong>{event.fact}</strong>
                  <small>{event.source}</small>
                </div>
                <span className={styles.eventState}>{event.state}</span>
              </li>
            ))}
          </ol>
          <div className={styles.lock} data-opportunity-lock="true">
            <span>ПОВОД СОБРАН</span>
            <strong>Можно писать не наугад.</strong>
            <small>компания поднимается в приоритете — с фактами в одной карточке</small>
          </div>
        </div>
      </div>
    </section>
  );
}
