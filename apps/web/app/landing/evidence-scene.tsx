import { DEMO_COMPANY } from "./landing-copy";
import { ArrowGlyph, DocumentGlyph, EvidenceGlyph } from "./brand-glyphs";
import sceneStyles from "./evidence-scene.module.css";
import styles from "./landing.module.css";

const SOURCE_ROWS = [
  {
    source: "Карьерная страница",
    fact: "8 инженерных позиций",
    discovered: "сегодня 08:42",
    eventDate: "4 авг",
    confidence: "Прямой источник",
  },
  {
    source: "Публичные вакансии",
    fact: "руководитель направления",
    discovered: "сегодня 08:45",
    eventDate: "1 авг",
    confidence: "Подтверждено",
  },
  {
    source: "Повторная публикация",
    fact: "3 роли обновлены повторно",
    discovered: "сегодня 08:47",
    eventDate: "сегодня",
    confidence: "Свежий сигнал",
  },
] as const;

const WORKFLOW_STEPS = [
  { title: "Настройте профиль", text: "Укажите специализацию, географию и исключения агентства." },
  { title: "Радар работает ежедневно", text: "Собирает сигналы найма, связывает их с компанией и проверяет источники." },
  { title: "Получайте возможности", text: "Короткая выдача объясняет, кому стоит написать сейчас и почему." },
] as const;

export default function EvidenceScene() {
  return (
    <section
      id="scene-evidence"
      className={`${styles.scene} ${styles.darkScene} ${styles.evidenceScene}`}
      aria-labelledby="evidence-title"
      data-header-tone="dark"
    >
      <div className={sceneStyles.layout}>
        <div className={sceneStyles.top}>
          <div className={sceneStyles.intro}>
            <p className={styles.sceneLabel}>03 — От сигнала к возможности</p>
            <h2 id="evidence-title" className={styles.sceneHeading}>
              Сигнал найма → доказательство → <em>коммерческая возможность.</em>
            </h2>
            <p className={styles.sceneLead}>
              Радар не выдаёт список вакансий. Он показывает компании, которым стоит написать сейчас, и факты, на которые можно опереться.
            </p>
          </div>

          <div className={sceneStyles.score} aria-label={`Приоритет компании ${DEMO_COMPANY.score} из 100`}>
            <span>ОЦЕНКА РАДАРА</span>
            <div className={sceneStyles.scoreValue}>
              <strong>{DEMO_COMPANY.score}</strong>
              <small>/100</small>
            </div>
            <div className={sceneStyles.scoreMeta}>
              <strong>Высокая уверенность</strong>
              <span>4 фактора</span>
            </div>
            <div className={sceneStyles.scale} aria-label="Шкала уверенности">
              <span>низкая</span><span>подтверждённая</span><span>высокая</span>
              <i className={sceneStyles.scaleTrack} aria-hidden="true" />
            </div>
          </div>

          <ol className={sceneStyles.factors} aria-label="Как работает Recruiter Radar">
            {WORKFLOW_STEPS.map((item, index) => (
              <li key={item.title} className={sceneStyles.factor}>
                <EvidenceGlyph size={18} />
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{item.title}</strong>
                <p>{item.text}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className={sceneStyles.ledger}>
          <div className={sceneStyles.ledgerHeading}>
            <div>
              <span>ДОКАЗАТЕЛЬНАЯ БАЗА / 03</span>
              <strong>{DEMO_COMPANY.name}</strong>
            </div>
            <p>Три записи показывают, что произошло, когда сигнал появился и насколько прямой источник его подтверждает.</p>
          </div>

          <ul className={sceneStyles.records}>
            {SOURCE_ROWS.map((row, index) => (
              <li key={row.source} className={sceneStyles.record}>
                <span className={sceneStyles.recordIndex}>{String(index + 1).padStart(2, "0")}</span>
                <div className={sceneStyles.recordFact}>
                  <span>{row.source}</span>
                  <strong>{row.fact}</strong>
                </div>
                <dl className={sceneStyles.recordMeta}>
                  <div><dt>найдено</dt><dd>{row.discovered}</dd></div>
                  <div><dt>событие</dt><dd>{row.eventDate}</dd></div>
                </dl>
                <span className={sceneStyles.recordStatus}>{row.confidence}</span>
                <a className={sceneStyles.recordLink} href="#scene-workspace" aria-label={`Открыть подтверждение: ${row.source}`}>
                  <DocumentGlyph size={16} />
                  открыть факт <ArrowGlyph size={13} />
                </a>
              </li>
            ))}
          </ul>
        </div>

      </div>
    </section>
  );
}
