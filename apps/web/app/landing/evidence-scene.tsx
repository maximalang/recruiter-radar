import { DEMO_COMPANY, DEMO_EVIDENCE_SOURCES } from "./landing-copy";
import sceneStyles from "./evidence-scene.module.css";

export default function EvidenceScene() {
  return (
    <section
      id="scene-evidence"
      className={sceneStyles.section}
      style={{ scrollMarginTop: "calc(72px + 32px)" }}
      aria-labelledby="evidence-title"
      data-header-tone="dark"
      data-theme="inverse"
      data-motion-reveal="section"
      data-proof-story="why-now"
    >
      <div className={sceneStyles.layout}>
        <div className={sceneStyles.intro}>
          <p className={sceneStyles.label}>Почему рекомендации можно доверять</p>
          <h2 id="evidence-title" className={sceneStyles.heading}>Факт усиливает факт — пока сигнал не становится решением.</h2>
          <p className={sceneStyles.lead}>Мы показываем последовательность подтверждений, а не прячем рекомендацию за непрозрачным score.</p>
        </div>

        <div className={sceneStyles.evidenceChain} data-proof-object="evidence-resolution">
          <ol className={sceneStyles.timeline} aria-label="Последовательность подтверждающих фактов">
            {DEMO_EVIDENCE_SOURCES.map((row) => (
              <li key={row.source} data-proof-event>
                <time>{row.eventDate}</time>
                <small>{row.source}</small>
                <strong>{row.fact}</strong>
              </li>
            ))}
          </ol>

          <div className={sceneStyles.resolution} data-proof-brief>
            <div className={sceneStyles.confidenceBlock}>
              <span>Уровень подтверждения</span>
              <strong>HIGH CONFIDENCE</strong>
              <small>Свежесть: {DEMO_COMPANY.freshness} · {DEMO_COMPANY.score} / 100</small>
            </div>
            <div className={sceneStyles.action}>
              <span>Следующий ход</span>
              <strong>{DEMO_COMPANY.opener}</strong>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
