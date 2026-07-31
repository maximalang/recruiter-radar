import hpStyles from "./home-page-components.module.css";

const STEPS = [
  {
    eyebrow: "01 · Профиль",
    title: "Задаёте свою специализацию",
    description: "Роли, отрасли, география и исключения определяют, какие компании подходят именно вашему агентству.",
    result: "Результат: одна настройка вместо ежедневного ручного поиска по десяткам источников.",
  },
  {
    eyebrow: "02 · Радар",
    title: "Система проверяет изменения в найме",
    description: "Сигналы сопоставляются по свежести, силе, соответствию профилю и доступности корпоративного контакта.",
    result: "Результат: наверх поднимаются компании с объяснимым приоритетом, а не случайные вакансии.",
  },
  {
    eyebrow: "03 · Работа",
    title: "Команда получает короткий список действий",
    description: "В каждой карточке есть причина, факты, ограничения и безопасный путь для первого обращения.",
    result: "Результат: BD начинает утро с 3–7 компаний, которые уже разобраны и расставлены по приоритету.",
  },
] as const;

export default function LandingHowItWorks() {
  return (
    <div className={hpStyles.steps} data-testid="how-it-works-flow">
      {STEPS.map((step) => (
        <article
          key={step.title}
          className={`${hpStyles.step} ${hpStyles.revealCard}`}
        >
          <div className={hpStyles.stepButton} style={{ cursor: "default" }}>
            <span className={hpStyles.stepIndex}>{step.eyebrow}</span>
            <strong className={hpStyles.stepTitle}>{step.title}</strong>
            <span className={hpStyles.stepDescription}>{step.description}</span>
            <span className={hpStyles.stepResult}>{step.result}</span>
          </div>
        </article>
      ))}
    </div>
  );
}
