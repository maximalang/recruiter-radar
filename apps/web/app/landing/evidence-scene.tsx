import { DEMO_COMPANY, DEMO_EVIDENCE } from "./landing-copy";
import { ArrowGlyph, DocumentGlyph, EvidenceGlyph } from "./brand-glyphs";
import sceneStyles from "./evidence-scene.module.css";
import styles from "./landing.module.css";

const SOURCE_ROWS = [
  {
    source: "CAREER PAGE",
    fact: "8 инженерных позиций",
    discovered: "today 08:42",
    eventDate: "4 aug",
    confidence: "DIRECT SOURCE",
  },
  {
    source: "PUBLIC VACANCIES",
    fact: "руководитель направления",
    discovered: "today 08:45",
    eventDate: "1 aug",
    confidence: "VERIFIED",
  },
  {
    source: "PUBLISHING CHANGE",
    fact: "3 роли обновлены повторно",
    discovered: "today 08:47",
    eventDate: "today",
    confidence: "FRESH SIGNAL",
  },
] as const;

const SOURCE_ROLES = [
  {
    title: "PRIMARY EVIDENCE",
    summary: "Свежий найм может вывести компанию в приоритет.",
    detail: "hh.ru, Работа России и прямые карьерные страницы дают основной сигнал найма. Перед попаданием компании в выдачу Radar проверяет свежесть, надёжность сигнала и корректность связи с организацией.",
    state: "live",
    stateText: "влияет на score",
    sources: ["hh.ru", "Работа России", "Career pages"],
  },
  {
    title: "VERIFICATION",
    summary: "Проверяет юрлицо, домен и официальный маршрут связи.",
    detail: "Сайт компании и реестры ФНС помогают связать сигнал с правильной организацией и найти официальный корпоративный канал. Они подтверждают возможность, но не заменяют сам сигнал найма.",
    state: "support",
    stateText: "подтверждает организацию",
    sources: ["Company site", "ЕГРЮЛ", "ФНС"],
  },
  {
    title: "GATED COVERAGE",
    summary: "Расширяет покрытие только после quality и legal checks.",
    detail: "Для дополнительных площадок уже есть адаптеры. Они начинают влиять на клиентскую выдачу только после проверок качества, правовой доступности и стабильности источника.",
    state: "gated",
    stateText: "подключено, проходит проверки",
    sources: ["Хабр Карьера", "SuperJob", "ATS", "Tech job boards"],
  },
  {
    title: "CONTEXT",
    summary: "Объясняет изменение компании, но не заменяет hiring evidence.",
    detail: "Корпоративные новости, реестровые события и отраслевые публикации помогают понять расширение, инвестиции или изменения бизнеса. Такой контекст дополняет, но не заменяет подтверждённый найм.",
    state: "context",
    stateText: "контекст для объяснения",
    sources: ["Newsroom", "Федресурс", "GDELT", "Industry media"],
  },
] as const;

export default function EvidenceScene() {
  return (
    <section
      id="scene-evidence"
      className={`${styles.scene} ${styles.darkScene} ${styles.evidenceScene}`}
      aria-labelledby="evidence-title"
      data-header-tone="dark"
    >
      <div className={`${styles.evidenceLayout} ${sceneStyles.layout}`}>
        <div className={sceneStyles.top}>
          <div className={`${styles.evidenceIntro} ${sceneStyles.intro}`}>
            <p className={styles.sceneLabel}>04 — Evidence</p>
            <h2 id="evidence-title" className={styles.sceneHeading}>
              Почему этому score <em>можно доверять.</em>
            </h2>
            <p className={styles.sceneLead}>
              Оценка не отделена от доказательств: вклад факторов, события, даты и роль источника остаются рядом с приоритетом компании.
            </p>
          </div>

          <div className={sceneStyles.score} aria-label={`Оценка радара ${DEMO_COMPANY.score} из 100`}>
            <span>RADAR SCORE</span>
            <div className={sceneStyles.scoreValue}>
              <strong>{DEMO_COMPANY.score}</strong>
              <small>/100</small>
            </div>
            <div className={sceneStyles.scoreMeta}>
              <strong>HIGH CONFIDENCE</strong>
              <span>4 FACTORS</span>
            </div>
            <div className={sceneStyles.scale} aria-label="Шкала уверенности">
              <span>weak</span><span>supported</span><span>strong</span>
              <i className={sceneStyles.scaleTrack} aria-hidden="true" />
            </div>
          </div>

          <ol className={sceneStyles.factors} aria-label="Из чего сложилась демонстрационная оценка">
            {DEMO_EVIDENCE.map((item) => (
              <li key={item.label} className={sceneStyles.factor}>
                <EvidenceGlyph size={18} />
                <span>{item.label}</span>
                <strong>{item.points}</strong>
                <p>{item.fact}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className={sceneStyles.ledger}>
          <div className={sceneStyles.ledgerHeading}>
            <div>
              <span>EVIDENCE RECORDS / 03</span>
              <strong>{DEMO_COMPANY.name}</strong>
            </div>
            <p>Три записи показывают не «объяснение модели», а реальные основания: что найдено, когда найдено, когда произошло событие и насколько прямой источник.</p>
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
                  <div><dt>found</dt><dd>{row.discovered}</dd></div>
                  <div><dt>event</dt><dd>{row.eventDate}</dd></div>
                </dl>
                <span className={sceneStyles.recordStatus}>{row.confidence}</span>
                <a className={sceneStyles.recordLink} href="#scene-workspace" aria-label={`Открыть ${row.source} в рабочем радаре`}>
                  <DocumentGlyph size={16} />
                  open evidence <ArrowGlyph size={13} />
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div className={sceneStyles.registry}>
          <div className={sceneStyles.registryIntro}>
            <span>SOURCE REGISTRY</span>
            <strong>Не каждый подключённый источник влияет на score.</strong>
            <p>Primary evidence создаёт приоритет. Verification подтверждает организацию. Gated и context расширяют покрытие только в своей роли.</p>
          </div>
          <div className={sceneStyles.roleList}>
            {SOURCE_ROLES.map((role, index) => (
              <details key={role.title} open={index === 0} data-source-role={role.state}>
                <summary>
                  <span className={sceneStyles.roleIndex}>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{role.title}</strong>
                  <small>{role.summary}</small>
                  <ArrowGlyph className={sceneStyles.registryArrow} size={15} />
                </summary>
                <div className={sceneStyles.roleBody}>
                  <p>{role.detail}</p>
                  <div className={sceneStyles.roleMeta}>
                    <span className={sceneStyles.roleStatus} data-state={role.state}>{role.stateText}</span>
                  </div>
                  <ul className={sceneStyles.sourceTags} aria-label={`Источники: ${role.title}`}>
                    {role.sources.map((source) => <li key={source}>{source}</li>)}
                  </ul>
                </div>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
