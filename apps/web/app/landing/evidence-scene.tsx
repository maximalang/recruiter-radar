import { DEMO_COMPANY, DEMO_EVIDENCE } from "./landing-copy";
import { ArrowGlyph, DocumentGlyph, EvidenceGlyph } from "./brand-glyphs";
import sceneStyles from "./evidence-scene.module.css";
import styles from "./landing.module.css";

const SOURCE_ROWS = [
  {
    source: "Карьерная страница",
    fact: "8 инженерных позиций",
    discovered: "сегодня · 08:42",
    eventDate: "4 августа",
    confidence: "прямой источник",
  },
  {
    source: "Публичные вакансии",
    fact: "руководитель направления",
    discovered: "сегодня · 08:45",
    eventDate: "1 августа",
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

const SOURCE_ROLES = [
  {
    title: "Дают основной сигнал найма",
    summary: "Свежий сигнал может вывести компанию в приоритетную выдачу.",
    detail: "hh.ru, Работа России и прямые карьерные страницы дают основной сигнал найма. Перед попаданием компании в выдачу Radar проверяет свежесть, надёжность сигнала и корректность связи с организацией.",
    state: "live",
    stateText: "Влияет на основную выдачу",
    sources: ["hh.ru", "Работа России", "Прямые карьерные страницы"],
  },
  {
    title: "Подтверждают компанию",
    summary: "Помогают проверить юрлицо, домен и официальный маршрут связи.",
    detail: "Сайт компании и реестры ФНС помогают связать сигнал с правильной организацией и найти официальный корпоративный канал. Они подтверждают возможность, но не заменяют сам сигнал найма.",
    state: "support",
    stateText: "Подтверждает компанию",
    sources: ["Сайт компании", "ЕГРЮЛ / ФНС", "Прозрачный бизнес ФНС"],
  },
  {
    title: "Расширяют покрытие после проверки",
    summary: "Адаптеры подключены, но пока не влияют на основную выдачу.",
    detail: "Для дополнительных площадок уже есть адаптеры. Они начинают влиять на клиентскую выдачу только после проверок качества, правовой доступности и стабильности источника.",
    state: "gated",
    stateText: "Подключено, проходит проверки",
    sources: ["Хабр Карьера", "SuperJob", "Публичные ATS / tech job boards", "LinkedIn company pages", "Региональные job boards"],
  },
  {
    title: "Добавляют бизнес-контекст",
    summary: "Помогают объяснить изменение компании и усилить первый контакт.",
    detail: "Корпоративные новости, реестровые события и отраслевые публикации помогают понять расширение, инвестиции или изменения бизнеса. Такой контекст дополняет, но не заменяет подтверждённый найм.",
    state: "context",
    stateText: "Контекст для объяснения",
    sources: ["Корпоративные newsroom-страницы", "GDELT / funding & business signals", "Федресурс", "Отраслевые медиа"],
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
      <div className={styles.evidenceLayout}>
        <div className={styles.evidenceIntro}>
          <p className={styles.sceneLabel}>04 — Основание приоритета</p>
          <h2 id="evidence-title" className={styles.sceneHeading}>
            На каких фактах <em>основан вывод.</em>
          </h2>
          <p className={styles.sceneLead}>
            До обращения видно, какие события повлияли на приоритет, когда они произошли и какой источник подтверждает каждый факт.
          </p>
        </div>

        <div className={styles.scoreAssembly}>
          <div className={styles.scoreIdentity}>
            <span>ОЦЕНКА РАДАРА</span>
            <strong>{DEMO_COMPANY.score}</strong>
            <small>/100 · уровень уверенности {DEMO_COMPANY.confidence}</small>
          </div>
          <div className={styles.scoreOrbit} aria-hidden="true">
            <EvidenceGlyph size={210} />
          </div>
          <ol className={styles.scoreFacts} aria-label="Из чего сложилась демонстрационная оценка">
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
            <span>ДОКАЗАТЕЛЬНАЯ БАЗА / 03</span>
            <strong>{DEMO_COMPANY.name}</strong>
            <p>Факт, источник, дата обнаружения и дата события остаются рядом — вывод можно перепроверить за минуту.</p>
          </div>
          <div className={styles.ledgerHeader} aria-hidden="true">
            <span>Источник / факт</span><span>Найдено</span><span>Событие</span><span>Достоверность</span>
          </div>
          <ul className={styles.evidenceStack}>
            {SOURCE_ROWS.map((row, index) => (
              <li key={row.source}>
                <span className={styles.ledgerIndex}>{String(index + 1).padStart(2, "0")}</span>
                <span className={styles.ledgerFact}><strong>{row.source}</strong><small>{row.fact}</small></span>
                <span>{row.discovered}</span>
                <span>{row.eventDate}</span>
                <span className={styles.ledgerConfidence}>{row.confidence}</span>
                <a href="#scene-workspace" aria-label={`Открыть ${row.source} в рабочем радаре`}>
                  <DocumentGlyph size={16} />
                  <ArrowGlyph size={14} />
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.sourceRoles}>
          <div className={styles.sourceRolesIntro}>
            <span>Как источники участвуют в выдаче</span>
            <strong>У каждого источника своя роль в приоритизации.</strong>
            <p className={sceneStyles.registryNote}><strong>Принцип:</strong> основной сигнал найма выводит компанию в радар, а остальные источники подтверждают организацию, расширяют покрытие или добавляют контекст.</p>
          </div>
          <div className={styles.sourceRoleList}>
            {SOURCE_ROLES.map((role, index) => (
              <details key={role.title} open={index === 0} data-source-role={role.state}>
                <summary>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{role.title}</strong>
                  <small>{role.summary}</small>
                  <i aria-hidden="true">+</i>
                </summary>
                <p>{role.detail}</p>
                <div className={sceneStyles.roleMeta}>
                  <span className={sceneStyles.roleStatus} data-state={role.state}>{role.stateText}</span>
                </div>
                <ul className={sceneStyles.sourceTags} aria-label={`Источники: ${role.title}`}>
                  {role.sources.map((source) => <li key={source}>{source}</li>)}
                </ul>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
