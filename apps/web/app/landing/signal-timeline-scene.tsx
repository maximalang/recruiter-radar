import { EvidenceGlyph, SignalGlyph } from "./brand-glyphs";
import { DEMO_COMPANY, DEMO_TIMELINE } from "./landing-copy";
import styles from "./landing.module.css";

export default function SignalTimelineScene() {
  return (
    <section
      id="scene-timeline"
      className={`${styles.scene} ${styles.lightScene} ${styles.timelineScene}`}
      aria-labelledby="timeline-title"
      data-header-tone="light"
    >
      <div className={styles.timelineLayout}>
        <div className={styles.timelineIntro}>
          <p className={styles.sceneLabel}>02 — Паттерн сигнала</p>
          <h2 id="timeline-title" className={styles.sceneHeading}>
            Одна вакансия ничего не доказывает. <em>Последовательность — доказывает.</em>
          </h2>
          <p className={styles.sceneLead}>
            Радар связывает события одной компании, сохраняет источники и даты, а затем объясняет, когда набор превращается в клиентскую возможность.
          </p>
        </div>

        <div className={styles.companyCoordinate} aria-label="Сквозная демонстрационная компания">
          <SignalGlyph size={52} />
          <div>
            <span>Одна компания на всём лендинге</span>
            <strong>{DEMO_COMPANY.name}</strong>
            <small>{DEMO_COMPANY.location} · {DEMO_COMPANY.industry}</small>
          </div>
        </div>

        <ol className={styles.timelineEvents}>
          {DEMO_TIMELINE.map((event, index) => (
            <li key={`${event.date}-${event.title}`} className={styles.timelineEvent}>
              <time>{event.date}</time>
              <span className={styles.timelineNode} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{event.title}</strong>
                <span>Источник: {event.source}</span>
              </div>
            </li>
          ))}
        </ol>

        <div className={styles.timelineConclusion}>
          <EvidenceGlyph size={58} />
          <p>
            Четыре изменения складываются в один вывод:
            <strong>компания расширяет инженерную функцию — сейчас есть обоснованный повод для разговора.</strong>
          </p>
          <span>4 события · 3 типа источников · последнее изменение сегодня</span>
        </div>
      </div>
    </section>
  );
}
