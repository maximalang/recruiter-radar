import { DEMO_COMPANY, DEMO_EVIDENCE } from "./landing-copy";
import { ArrowGlyph, DocumentGlyph, EvidenceGlyph } from "./brand-glyphs";
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

const SOURCE_ROLES = [
  {
    title: "Создают hiring signal",
    summary: "hh.ru, Работа России и прямые карьерные страницы.",
    detail: "Именно здесь радар фиксирует новые роли, повторные публикации, расширение географии и изменение темпа найма.",
  },
  {
    title: "Подтверждают компанию и событие",
    summary: "Сайт компании, ЕГРЮЛ и данные ФНС.",
    detail: "Они помогают связать событие с корректным юрлицом, доменом и официальным корпоративным маршрутом контакта.",
  },
  {
    title: "Добавляют контекст",
    summary: "Корпоративные новости и отраслевые публикации.",
    detail: "Контекст объясняет расширение, запуск направления или изменение команды, но не заменяет проверяемый hiring signal.",
  },
  {
    title: "Сами по себе лид не создают",
    summary: "Реестры, каталоги и единичные упоминания без найма.",
    detail: "Такие данные могут подтвердить компанию или дополнить картину, но не поднимают её в выдачу без основного сигнала.",
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
          <p className={styles.sceneLabel}>04 — Как собирается доказательство</p>
          <h2 id="evidence-title" className={styles.sceneHeading}>
            Радар не просит верить оценке. <em>Он показывает, из чего она собрана.</em>
          </h2>
          <p className={styles.sceneLead}>
            Оценка остаётся рядом с исходными фактами, датами и ролью каждого источника — вывод можно перепроверить до обращения.
          </p>
        </div>

        <div className={styles.scoreAssembly}>
          <div className={styles.scoreIdentity}>
            <span>RADAR SCORE</span>
            <strong>{DEMO_COMPANY.score}</strong>
            <small>/100 · confidence {DEMO_COMPANY.confidence}</small>
          </div>
          <div className={styles.scoreOrbit} aria-hidden="true">
            <EvidenceGlyph size={210} />
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
            <p>Источники, даты обнаружения и даты самих событий не растворяются внутри score.</p>
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
            <span>Роли источников</span>
            <strong>Не все данные имеют одинаковый вес.</strong>
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
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
