import { DEMO_COMPANY, DEMO_EVIDENCE_SOURCES } from "./landing-copy";
import sceneStyles from "./evidence-scene.module.css";
import styles from "./landing.module.css";

export default function EvidenceScene() {
  return (
    <section id="scene-evidence" className={`${styles.scene} ${styles.evidenceScene} ${sceneStyles.section}`} style={{ scrollMarginTop: "calc(72px + 32px)" }} aria-labelledby="evidence-title" data-header-tone="dark" data-theme="inverse" data-motion-reveal="section" data-proof-story="why-now">
      <div className={sceneStyles.layout}>
        <div className={sceneStyles.intro}>
          <p className={sceneStyles.label}>Почему эта компания сейчас</p>
            <h2 id="evidence-title" className={sceneStyles.heading}>Не один сигнал, а <em>цепочка фактов.</em></h2>
          <p className={sceneStyles.lead}>Радар связывает изменения во времени, показывает источники и отделяет подтверждённый повод от обычного шума вакансий.</p>
        </div>

        <ol className={sceneStyles.timeline} aria-label="Последовательность подтверждающих фактов">
            {DEMO_EVIDENCE_SOURCES.map((row, index) => (
              <li key={row.source} data-proof-event>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <time>{row.eventDate}</time>
                <div><small>{row.source}</small><strong>{row.fact}</strong></div>
                <em>{row.confidence}</em>
              </li>
            ))}
        </ol>

        <aside className={sceneStyles.brief} data-proof-brief>
          <div className={sceneStyles.briefTopline}><span>Компания</span><strong>Приоритет 01</strong></div>
          <h3>{DEMO_COMPANY.name}</h3>
          <p>{DEMO_COMPANY.whyNow}</p>
          <dl>
            <div><dt>Уровень подтверждения</dt><dd>Высокий</dd></div>
            <div><dt>Свежесть</dt><dd>{DEMO_COMPANY.freshness}</dd></div>
            <div><dt>Корпоративный контакт</dt><dd>Карьерная страница</dd></div>
          </dl>
          <div className={sceneStyles.action}>
            <span>Следующий ход</span>
            <strong>Проверить факты и предложить точечный инженерный подбор.</strong>
          </div>
        </aside>
      </div>
    </section>
  );
}
