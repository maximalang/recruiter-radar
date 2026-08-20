import { DEMO_COMPANY, DEMO_EVIDENCE_SOURCES } from "./landing-copy";
import styles from "./evidence-scene.module.css";

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}

export default function EvidenceScene() {
  const [confidenceGrade = "A", confidenceText = "высокая"] = DEMO_COMPANY.confidence
    .split("/")
    .map((part) => part.trim());

  return (
    <section
      id="scene-evidence"
      className={styles.section}
      aria-label="Почему эта компания сейчас"
      data-header-tone="dark"
      data-proof-story="why-now"
    >
      <div className={styles.layout}>
        <header className={styles.intro}>
          <div>
            <p>Почему рекомендацию можно проверить</p>
            <h2>Факт усиливает факт — пока сигнал не становится решением.</h2>
          </div>
          <p>
            Мы показываем подтверждения к рекомендации, а не прячем решение за непрозрачным score.
          </p>
        </header>

        <div className={styles.evidenceChain}>
          <ol className={styles.timeline} aria-label="Последовательность подтверждающих фактов">
            {DEMO_EVIDENCE_SOURCES.map((event, index) => (
              <li key={event.source} data-proof-event>
                <span className={styles.index}>{String(index + 1).padStart(2, "0")}</span>
                <small>{event.eventDate}</small>
                <strong>{event.fact}</strong>
                <span>{event.source}</span>
              </li>
            ))}
          </ol>

          <aside className={styles.resolution} data-proof-brief>
            <span className={styles.resolutionLabel}>Вывод</span>
            <div className={styles.confidenceBlock} aria-label="Уровень подтверждения">
              <span>Уверенность</span>
              <strong>{capitalize(confidenceText)}</strong>
              <small>Класс {confidenceGrade} · {DEMO_COMPANY.freshness} · {DEMO_COMPANY.score} / 100</small>
            </div>
            <div className={styles.action}>
              <span>Следующий ход</span>
              <strong>{DEMO_COMPANY.opener}</strong>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
