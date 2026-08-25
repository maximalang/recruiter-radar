import type { CSSProperties } from "react";

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
            <p className={styles.introLabel}>Почему эта компания сейчас · {DEMO_COMPANY.name}</p>
            <h2>Сначала факты — потом решение.</h2>
          </div>
          <p>
            По каждому пункту видно, что произошло, какой источник это опубликовал и когда сигнал зафиксирован. Уверенность помогает отсортировать очередь, а не заменяет ваше решение.
          </p>
        </header>

        <div className={styles.evidenceChain} data-proof-chain="source-fact-conclusion">
          <ol className={styles.timeline} aria-label="Последовательность подтверждающих фактов">
            {DEMO_EVIDENCE_SOURCES.map((event, index) => (
              <li key={event.source} data-proof-event>
                <span className={styles.sourceCell}>
                  {String(index + 1).padStart(2, "0")} · {event.source}
                </span>
                <strong className={styles.factCell}>{event.fact}</strong>
                <span className={styles.statusCell}>
                  {event.eventDate} · {event.confidence}
                </span>
              </li>
            ))}
          </ol>

          <aside className={styles.resolution} data-proof-brief>
            <div className={styles.scoreBlock} aria-label={`Оценка возможности: ${DEMO_COMPANY.score} из 100`}>
              <span className={styles.blockLabel}>Оценка возможности</span>
              <p className={styles.scoreValue}>
                {DEMO_COMPANY.score}
                <small>/100</small>
              </p>
              <div className={styles.scoreScale} aria-hidden="true">
                <i style={{ "--score": DEMO_COMPANY.score } as CSSProperties} />
              </div>
            </div>
            <div className={styles.confidenceBlock}>
              <span className={styles.blockLabel}>Уверенность</span>
              <strong>{capitalize(confidenceText)}</strong>
              <small>Класс {confidenceGrade} · подтверждено {DEMO_COMPANY.freshness}</small>
            </div>
            <div className={styles.action}>
              <span className={styles.blockLabel}>Следующий ход</span>
              <strong>{DEMO_COMPANY.opener}</strong>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
