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
    title: "Создают lead evidence сейчас",
    summary: "Только источники, прошедшие promotion gate.",
    detail: "Эти источники могут дать основной hiring signal, из которого компания попадает в клиентскую выдачу. Даже здесь применяются freshness, confidence и entity-resolution проверки.",
    state: "live",
    stateText: "digest-allowed",
    sources: ["hh.ru", "Работа России", "Прямые карьерные страницы"],
  },
  {
    title: "Подтверждают компанию",
    summary: "Юрлицо, домен и корпоративный маршрут.",
    detail: "Supporting и enrichment-источники связывают сигнал с корректной организацией и помогают найти официальный корпоративный путь контакта. Они не должны создавать лид без hiring evidence.",
    state: "support",
    stateText: "support / enrichment",
    sources: ["Сайт компании", "ЕГРЮЛ / ФНС", "Прозрачный бизнес ФНС"],
  },
  {
    title: "Расширяют покрытие после gates",
    summary: "Адаптеры есть, digest-допуск не обещается заранее.",
    detail: "Для secondary hiring sources код уже предусматривает ingestion, но production digest остаётся закрыт до необходимых confidence, legal, robots или provider-проверок. Лендинг показывает эту границу явно, а не выдаёт наличие адаптера за готовый источник лидов.",
    state: "gated",
    stateText: "adapter ready / digest gated",
    sources: ["Хабр Карьера", "SuperJob", "Публичные ATS / tech job boards", "LinkedIn company pages", "Региональные job boards"],
  },
  {
    title: "Добавляют бизнес-контекст",
    summary: "Контекст усиливает объяснение, но не создаёт лид.",
    detail: "Новости, корпоративные события, реестровые и business-сигналы помогают объяснить расширение, инвестиции или изменение компании. Они остаются supporting context и не заменяют прямое подтверждение найма.",
    state: "context",
    stateText: "context only",
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
          <p className={styles.sceneLabel}>04 — Доказательства</p>
          <h2 id="evidence-title" className={styles.sceneHeading}>
            Оценка — не чёрный ящик. <em>Каждый вывод остаётся рядом с evidence.</em>
          </h2>
          <p className={styles.sceneLead}>
            До обращения видно, какие события повлияли на приоритет, когда они произошли и какой источник подтверждает вывод.
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
            <span>Source registry / фактические роли</span>
            <strong>Не все подключённые источники имеют право поднять компанию в выдачу.</strong>
            <p className={sceneStyles.registryNote}><strong>Принцип:</strong> наличие адаптера ≠ production-ready. Lead-originating, supporting, gated и context-only источники показаны отдельно.</p>
          </div>
          <div className={styles.sourceRoleList}>
            {SOURCE_ROLES.map((role, index) => (
              <details key={role.title} open={index === 0}>
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
