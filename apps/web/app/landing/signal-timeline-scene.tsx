import { DocumentGlyph, SignalGlyph } from "./brand-glyphs";
import { DEMO_COMPANY, DEMO_TIMELINE } from "./landing-copy";
import sceneStyles from "./signal-timeline-scene.module.css";
import styles from "./landing.module.css";

const EVENT_STATES = ["новое", "подтверждает", "усиливает", "подтверждает"] as const;

export default function SignalTimelineScene() {
  return (
    <section
      id="scene-timeline"
      className={`${styles.scene} ${styles.lightScene} ${styles.timelineScene}`}
      aria-labelledby="timeline-title"
      data-header-tone="light"
    >
      <div className={`${styles.timelineLayout} ${sceneStyles.layout}`}>
        <div className={`${styles.timelineIntro} ${sceneStyles.intro}`}>
          <p className={styles.sceneLabel}>02 — Почему сейчас</p>
          <h2 id="timeline-title" className={styles.sceneHeading}>
            События, которые объясняют, <em>почему компании стоит написать сейчас.</em>
          </h2>
          <p className={styles.sceneLead}>
            Радар наблюдает компанию во времени: независимые события складываются в последовательность и показывают момент, когда повод для обращения становится проверяемым.
          </p>
        </div>

        <div className={`${styles.companyCoordinate} ${sceneStyles.coordinate}`} aria-label="Сквозная демонстрационная компания">
          <SignalGlyph size={36} />
          <strong>{DEMO_COMPANY.name}</strong>
          <div className={sceneStyles.coordinateMeta}>
            <span>{DEMO_COMPANY.location}</span>
            <span>{DEMO_COMPANY.industry}</span>
            <span>один сквозной разбор</span>
          </div>
        </div>

        <ol className={`${styles.timelineEvents} ${sceneStyles.story}`} data-temporal-axis="signal-story">
          {DEMO_TIMELINE.map((event, index) => (
            <li key={`${event.date}-${event.title}`} className={`${styles.timelineEvent} ${sceneStyles.event}`}>
              <time>{event.date}</time>
              <span className={`${styles.timelineNode} ${sceneStyles.node}`} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <div className={sceneStyles.eventBody}>
                <DocumentGlyph size={18} />
                <strong>{event.title}</strong>
                <small>{event.source}</small>
              </div>
              <span className={sceneStyles.status}>{EVENT_STATES[index] ?? "сигнал"}</span>
            </li>
          ))}
        </ol>

        <div className={sceneStyles.lock} data-opportunity-lock="true">
          <div className={sceneStyles.lockHeader}>
            <span>Сигналы подтверждают друг друга</span>
            <small>4 события / 3 типа источников / сегодня</small>
          </div>
          <strong>Компания системно расширяет инженерную функцию.</strong>
          <span>проверяемый повод для первого контакта</span>
        </div>
      </div>
    </section>
  );
}
