import { DEMO_COMPANY } from "./landing-copy";
import sceneStyles from "./evidence-scene.module.css";
import styles from "./landing.module.css";

const SOURCE_ROWS = [
  { source: "Карьерная страница", fact: "8 инженерных позиций", eventDate: "4 августа", confidence: "Прямой источник" },
  { source: "Публичные вакансии", fact: "Новая руководящая роль", eventDate: "1 августа", confidence: "Подтверждено" },
  { source: "Повторная публикация", fact: "3 роли появились снова", eventDate: "сегодня", confidence: "Свежий сигнал" },
] as const;

export default function EvidenceScene() {
  return (
    <section id="scene-evidence" className={`${styles.scene} ${styles.lightScene} ${styles.evidenceScene} ${sceneStyles.section}`} style={{ scrollMarginTop: "calc(72px + 32px)" }} aria-labelledby="evidence-title" data-header-tone="light" data-motion-reveal="section">
      <div className={sceneStyles.layout}>
        <div className={sceneStyles.intro}>
          <p className={styles.sceneLabel}>Подтверждения</p>
          <h2 id="evidence-title" className={styles.sceneHeading}>По каждой компании видно, <em>на чём основана рекомендация.</em></h2>
          <p className={styles.sceneLead}>Радар показывает, что изменилось в найме, когда это произошло и где найдено. Факты можно проверить до первого сообщения.</p>
        </div>

        <div className={sceneStyles.proofSummary} aria-label="Уровень подтверждения компании">
          <span>Уровень подтверждения</span>
          <strong>Высокий</strong>
          <p>Несколько независимых фактов подтверждают активное расширение команды.</p>
        </div>

        <div className={sceneStyles.ledger}>
          <header className={sceneStyles.ledgerHeading}>
            <div><span>Компания</span><strong>{DEMO_COMPANY.name}</strong></div>
            <p>Источник · факт · дата · статус</p>
          </header>
          <ul className={sceneStyles.records}>
            {SOURCE_ROWS.map((row, index) => (
              <li key={row.source} className={sceneStyles.record} tabIndex={0} data-evidence-row aria-label={`${row.source}: ${row.fact}. ${row.confidence}`}>
                <span className={sceneStyles.recordIndex}>{String(index + 1).padStart(2, "0")}</span>
                <div className={sceneStyles.recordFact}><span>{row.source}</span><strong>{row.fact}</strong></div>
                <span className={sceneStyles.recordDate}>{row.eventDate}</span>
                <span className={sceneStyles.recordStatus}>{row.confidence}</span>
              </li>
            ))}
          </ul>
          <div className={sceneStyles.conclusion} data-evidence-conclusion="source-fact-conclusion">
            <div><span>Источник</span><i aria-hidden="true">→</i><span>Факт</span><i aria-hidden="true">→</i><strong>Вывод</strong></div>
            <p>Подтверждения объясняют «почему сейчас»; сила сигнала помогает сортировать, но не заменяет факты.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
