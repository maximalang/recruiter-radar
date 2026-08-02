import hpStyles from "./home-page-components.module.css";

const STAGES = [
  {
    name: "Соответствие",
    secondary: "Fit",
    description: "Ниша, роли и география совпадают с профилем агентства.",
  },
  {
    name: "Намерение",
    secondary: "Intent",
    description: "Активный найм подтверждён фактами, а не одним заголовком вакансии.",
  },
  {
    name: "Актуальность",
    secondary: "Urgency",
    description: "Изменение достаточно свежее, чтобы обращение не было запоздалым.",
  },
  {
    name: "Доступность",
    secondary: "Reachability",
    description: "Есть законный корпоративный путь контакта без персональных баз.",
  },
] as const;

export default function LandingMethodology() {
  return (
    <article className={hpStyles.qualityMethodCard} data-testid="landing-methodology">
      <div className={hpStyles.qualityCardTopbar}>
        <span>Контур оценки</span>
        <span>4 независимых измерения</span>
      </div>
      <div className={hpStyles.qualityMethodIntro}>
        <h3>Из чего складывается Radar Score</h3>
        <p>Сильный итоговый балл не скрывает слабые места: каждое измерение остаётся видимым отдельно.</p>
      </div>
      <ol className={hpStyles.qualityChecks}>
        {STAGES.map((stage, index) => (
          <li key={stage.name}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong>{stage.name} <small>{stage.secondary}</small></strong>
              <p>{stage.description}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className={hpStyles.qualityOutcome}>
        Контекст без прямого подтверждения найма остаётся контекстом и не попадает в клиентскую выдачу.
      </p>
    </article>
  );
}
