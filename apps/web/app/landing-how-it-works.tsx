import hpStyles from "./home-page-components.module.css";

const STEPS = [
  {
    number: "01",
    title: "Собираем сигналы найма",
    description: "Вакансии, карьерные страницы и корпоративные события фиксируются вместе с датой и источником.",
  },
  {
    number: "02",
    title: "Объединяем факты по компании",
    description: "Дубли и разрозненные публикации складываются в одну хронологию клиентской возможности.",
  },
  {
    number: "03",
    title: "Рассчитываем приоритет",
    description: "Соответствие, намерение, актуальность и доступность контакта оцениваются отдельно и объяснимо.",
  },
  {
    number: "04",
    title: "Показываем следующий шаг",
    description: "Команда видит, почему писать сейчас, какой угол выбрать и где находится корпоративный контакт.",
  },
] as const;

export default function LandingHowItWorks() {
  return (
    <ol className={hpStyles.processList} data-testid="how-it-works-flow">
      {STEPS.map((step) => (
        <li key={step.number} className={hpStyles.processStep}>
          <span className={hpStyles.processIndex}>{step.number}</span>
          <div>
            <h3>{step.title}</h3>
            <p>{step.description}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
