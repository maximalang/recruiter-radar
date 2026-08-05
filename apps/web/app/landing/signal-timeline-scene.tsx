import { EvidenceGlyph, SignalGlyph } from "./brand-glyphs";
import { DEMO_COMPANY, DEMO_TIMELINE } from "./landing-copy";
import styles from "./landing.module.css";

export default function SignalTimelineScene() {
  return (
    <section
      id="scene-timeline"
      className={`${styles.scene} ${styles.lightScene} ${styles.timelineScene}`}
      aria-labelledby="timeline-title"
      data-landing-scene="timeline"
    >
      <div className={styles.timelineLayout}>
        <div className={styles.timelineIntro}>
          <p className={styles.sceneLabel} data-system-label>02 — Сигнал</p>
          <h2 id="timeline-title" className={styles.sceneHeading}>
            Одна вакансия ничего не доказывает. <em>Последовательность — доказывает.</em>
          </h2>
          <p className={styles.sceneLead}>
            Радар не реагирует на отдельный заголовок. Он собирает изменения одной компании в единую временную линию.
          </p>
        </div>

        <div className={styles.companyCoordinate} aria-label="Сквозная демонстрационная компания">
          <SignalGlyph size={64} />
          <div>
            <span data-system-label>Объект наблюдения</span>
            <strong>{DEMO_COMPANY.name}</strong>
            <small>{DEMO_COMPANY.location} · {DEMO_COMPANY.industry}</small>
          </div>
        </div>

        <ol className={styles.timelineEvents}>
          {DEMO_TIMELINE.map((event, index) => (
            <li key={event.date} className={styles.timelineEvent}>
              <time>{event.date}</time>
              <span className={styles.timelineNode} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{event.title}</strong>
                <span data-system-label>{event.source}</span>
              </div>
            </li>
          ))}
        </ol>

        <div className={styles.timelineConclusion}>
          <EvidenceGlyph size={72} />
          <p>
            Это уже не отдельные вакансии.
            <strong>Это окно для выхода на клиента.</strong>
          </p>
          <span data-system-label>4 события · 3 типа подтверждения · сегодня</span>
        </div>
      </div>
    </section>
  );
}
