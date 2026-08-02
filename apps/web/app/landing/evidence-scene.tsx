import { DEMO_COMPANY, DEMO_EVIDENCE } from "./landing-copy";
import { EvidenceGlyph } from "./brand-glyphs";
import styles from "./landing.module.css";

const SOURCE_ROWS = [
  {
    source: "Карьерная страница",
    fact: "8 инженерных позиций",
    discovered: "сегодня · 08:42",
    eventDate: "18 августа",
    confidence: "прямой источник",
  },
  {
    source: "Публичные вакансии",
    fact: "руководитель направления",
    discovered: "сегодня · 08:45",
    eventDate: "15 августа",
    confidence: "подтверждено",
  },
  {
    source: "Изменение публикаций",
    fact: "3 роли обновлены повторно",
    discovered: "сегодня · 08:47",
    eventDate: "сегодня",
    confidence: "свежий сигнал",
  },
] as const;

export default function EvidenceScene() {
  return (
    <section id="scene-evidence" className={`${styles.scene} ${styles.darkScene} ${styles.evidenceScene}`} aria-labelledby="evidence-title">
      <div className={styles.evidenceLayout}>
        <div className={styles.evidenceIntro}>
          <p className={styles.sceneLabel}>03 — Доказательство</p>
          <h2 id="evidence-title" className={styles.sceneHeading}>
            Радар не просит верить оценке. <em>Он показывает, из чего она собрана.</em>
          </h2>
        </div>

        <div className={styles.scoreAssembly}>
          <div className={styles.scoreIdentity}>
            <span>RADAR SCORE</span>
            <strong>{DEMO_COMPANY.score}</strong>
            <small>/100 · подтверждено</small>
          </div>
          <div className={styles.scoreOrbit} aria-hidden="true">
            <EvidenceGlyph size={220} />
          </div>
          <ol className={styles.scoreFacts} aria-label="Из чего сложилась оценка">
            {DEMO_EVIDENCE.map((item) => (
              <li key={item.label}>
                <span>{item.label}</span>
                <strong>{item.points}</strong>
                <p>{item.fact}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className={styles.evidenceLedger}>
          <div className={styles.ledgerHeading}>
            <span>EVIDENCE STACK / 03</span>
            <strong>{DEMO_COMPANY.name}</strong>
            <p>Источники, даты обнаружения и сами события остаются рядом с оценкой.</p>
          </div>
          <div className={styles.ledgerHeader} aria-hidden="true">
            <span>Источник / факт</span><span>Найдено</span><span>Событие</span><span>Уверенность</span>
          </div>
          <ul className={styles.evidenceStack}>
            {SOURCE_ROWS.map((row, index) => (
              <li key={row.source}>
                <span className={styles.ledgerIndex}>{String(index + 1).padStart(2, "0")}</span>
                <span className={styles.ledgerFact}><strong>{row.source}</strong><small>{row.fact}</small></span>
                <span>{row.discovered}</span>
                <span>{row.eventDate}</span>
                <span className={styles.ledgerConfidence}>{row.confidence}</span>
                <a href="#scene-workspace" aria-label={`Открыть ${row.source} в рабочем радаре`}>↗</a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
