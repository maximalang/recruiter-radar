import { DEMO_COMPANY, DEMO_EVIDENCE_SOURCES } from "./landing-copy";
import styles from "./landing.module.css";
import sceneStyles from "./radar-scene.module.css";

export default function RadarScene() {
  return (
    <section
      id="scene-radar"
      className={`${styles.scene} ${sceneStyles.section}`}
      aria-labelledby="radar-title"
      data-theme="inverse"
      data-header-tone="dark"
      data-motion-reveal="section"
      data-motion-scene="radar"
      data-landing-radar-scene
    >
      <div className={sceneStyles.layout}>
        <div className={sceneStyles.intro}>
          <p className={sceneStyles.label}>Радар</p>
          <h2 id="radar-title" className={sceneStyles.heading}>
            Свежесть и подтверждения <em>видны в одном поле.</em>
          </h2>
          <p className={sceneStyles.lead}>
            По горизонтали — насколько свежий сигнал. По вертикали — насколько хорошо он подтверждён. География остаётся фильтром и контекстом, а не определяет положение компании.
          </p>
        </div>

        <ol className={sceneStyles.semanticList} data-radar-semantic-list aria-label="Сильные сигналы в примере радара">
          <li>
            <span>01</span>
            <div>
              <strong>{DEMO_COMPANY.name}</strong>
              <small>сегодня · высокий уровень подтверждения</small>
              <p>{DEMO_COMPANY.whyNow}</p>
            </div>
          </li>
        </ol>

        <div className={sceneStyles.stage} data-radar-spatial-model="recency-confidence">
          <div className={sceneStyles.plot} data-radar-plot aria-label={`Радар: ${DEMO_COMPANY.name}, свежий сигнал с высоким уровнем подтверждения`}>
            <span className={`${sceneStyles.axisLabel} ${sceneStyles.axisTop}`}>сильнее подтверждение</span>
            <span className={`${sceneStyles.axisLabel} ${sceneStyles.axisBottom}`}>слабее</span>
            <span className={`${sceneStyles.axisLabel} ${sceneStyles.axisLeft}`}>30 дней</span>
            <span className={`${sceneStyles.axisLabel} ${sceneStyles.axisRight}`}>сейчас</span>
            <i className={sceneStyles.axisY} aria-hidden="true" />
            <i className={sceneStyles.axisX} aria-hidden="true" />

            <svg className={sceneStyles.relationships} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <line x1="65" y1="39" x2="76" y2="26" />
              <line x1="72" y1="49" x2="76" y2="26" />
              <line x1="84" y1="42" x2="76" y2="26" />
            </svg>

            <span className={`${sceneStyles.evidenceNode} ${sceneStyles.evidenceOne}`} aria-hidden="true" />
            <span className={`${sceneStyles.evidenceNode} ${sceneStyles.evidenceTwo}`} aria-hidden="true" />
            <span className={`${sceneStyles.evidenceNode} ${sceneStyles.evidenceThree}`} aria-hidden="true" />

            <div className={sceneStyles.companyAnchor} data-radar-company-anchor>
              <span className={sceneStyles.companyNode} aria-hidden="true" />
              <strong>{DEMO_COMPANY.name}</strong>
              <small>свежо · подтверждено</small>
            </div>
          </div>

          <aside className={sceneStyles.context} aria-label="Контекст выбранной компании">
            <span className={sceneStyles.contextLabel}>Выбранная компания</span>
            <h3>{DEMO_COMPANY.name}</h3>
            <p>{DEMO_COMPANY.whyNow}</p>
            <dl>
              <div><dt>Уровень подтверждения</dt><dd>Высокий</dd></div>
              <div><dt>Свежесть</dt><dd>{DEMO_COMPANY.freshness}</dd></div>
            </dl>
            <div className={sceneStyles.evidenceList}>
              <span>Подтверждения</span>
              {DEMO_EVIDENCE_SOURCES.map((row) => (
                <p key={row.source}>{row.source} · {row.eventDate}</p>
              ))}
            </div>
            <div className={sceneStyles.nextMove}>
              <span>Следующий ход</span>
              <strong>Проверить факты и написать по текущему расширению команды.</strong>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
