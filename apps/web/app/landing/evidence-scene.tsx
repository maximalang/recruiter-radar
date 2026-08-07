import { DEMO_COMPANY, DEMO_EVIDENCE } from "./landing-copy";
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

const SOURCE_ROLES = [
  {
    title: "Основные сигналы",
    summary: "Свежий найм может вывести компанию в приоритет.",
    detail: "hh.ru, Работа России и прямые карьерные страницы дают основной сигнал найма. Перед попаданием компании в выдачу Radar проверяет свежесть, надёжность сигнала и корректность связи с организацией.",
    state: "live",
    stateText: "влияет на приоритет",
    sources: ["hh.ru", "Работа России", "Карьерные страницы"],
  },
  {
    title: "Подтверждение",
    summary: "Проверяет юрлицо, домен и официальный маршрут связи.",
    detail: "Сайт компании и реестры ФНС помогают связать сигнал с правильной организацией и найти официальный корпоративный канал. Они подтверждают возможность, но не заменяют сам сигнал найма.",
    state: "support",
    stateText: "подтверждает организацию",
    sources: ["Сайт компании", "ЕГРЮЛ", "ФНС"],
  },
  {
    title: "Дополнительные источники",
    summary: "Расширяют покрытие после проверки качества и доступности.",
    detail: "Для дополнительных площадок уже есть адаптеры. Они начинают влиять на клиентскую выдачу только после проверок качества, правовой доступности и стабильности источника.",
    state: "gated",
    stateText: "проходит проверку",
    sources: ["Хабр Карьера", "SuperJob", "ATS", "Профильные площадки"],
  },
  {
    title: "Контекст компании",
    summary: "Помогает понять изменение бизнеса, не подменяя сигнал найма.",
    detail: "Корпоративные новости, реестровые события и отраслевые публикации помогают понять расширение, инвестиции или изменения бизнеса. Такой контекст дополняет, но не заменяет подтверждённый найм.",
    state: "context",
    stateText: "добавляет контекст",
    sources: ["Новости компании", "Федресурс", "GDELT", "Отраслевые медиа"],
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
            <p className={styles.sceneLabel}>04 — На чём основан вывод</p>
            <h2 id="evidence-title" className={styles.sceneHeading}>
              Почему этому приоритету <em>можно доверять.</em>
            </h2>
            <p className={styles.sceneLead}>
              Приоритет не отделён от фактов: рядом остаются вклад каждого сигнала, сами события, даты и роль источника.
            </p>
          </div>

          <div className={sceneStyles.score} aria-label={`Приоритет компании ${DEMO_COMPANY.score} из 100`}>
            <span>Приоритет компании</span>
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

          <ol className={sceneStyles.factors} aria-label="Из чего сложился демонстрационный приоритет">
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
              <span>Факты и источники / 03</span>
              <strong>{DEMO_COMPANY.name}</strong>
            </div>
            <p>Три записи показывают основание приоритета: что найдено, когда событие произошло, когда оно было обнаружено и насколько прямой источник.</p>
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

        <div className={sceneStyles.registry}>
          <div className={sceneStyles.registryIntro}>
            <span>Роль источников</span>
            <strong>Каждый источник выполняет свою задачу.</strong>
            <p>Основные сигналы создают приоритет. Подтверждение связывает событие с компанией. Дополнительные источники и контекст расширяют картину только в своей роли.</p>
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
