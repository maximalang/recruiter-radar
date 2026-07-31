import hpStyles from "./home-page-components.module.css";

const SOURCE_LAYERS = [
  {
    role: "origin",
    label: "01 · Сигнал",
    badge: "проверяемый факт",
    title: "Находим реальное изменение в найме",
    description: "Новые роли, ускорение публикаций и изменения на карьерных страницах становятся кандидатом в радар.",
    result: "Пользователь видит не просто вакансию, а конкретное изменение, которое создаёт повод для контакта.",
  },
  {
    role: "verification",
    label: "02 · Проверка",
    badge: "несколько источников",
    title: "Подтверждаем компанию и силу сигнала",
    description: "Радар сопоставляет факты, свежесть, профиль агентства и данные самой компании.",
    result: "Слабые и противоречивые сигналы не поднимаются в верх выдачи без объяснения ограничений.",
  },
  {
    role: "context",
    label: "03 · Действие",
    badge: "готово для BD",
    title: "Формируем понятный следующий шаг",
    description: "В карточке остаются причина приоритета, доказательства и корпоративный путь контакта.",
    result: "Команда получает короткий порядок действий, а решение об обращении всегда остаётся за человеком.",
  },
] as const;

export default function LandingSourceArchitecture() {
  return (
    <aside className={hpStyles.sourceArchitecture} aria-labelledby="source-architecture-title">
      <div className={hpStyles.sourceArchitectureHeader}>
        <div>
          <span className={hpStyles.sourceArchitectureEyebrow}>От факта к действию</span>
          <h3 id="source-architecture-title">Почему рекомендация заслуживает внимания</h3>
        </div>
        <p>Компания не попадает в приоритет по одной вакансии: радар отделяет сигнал, проверку и следующий шаг.</p>
      </div>

      <ol className={hpStyles.sourceLayers} data-testid="source-flow">
        {SOURCE_LAYERS.map((layer) => (
          <li
            key={layer.role}
            className={hpStyles.sourceLayer}
            data-source-role={layer.role}
          >
            <div className={hpStyles.sourceLayerButton}>
              <span className={hpStyles.sourceLayerMeta}>
                <span>{layer.label}</span>
                <em>{layer.badge}</em>
              </span>
              <strong className={hpStyles.sourceLayerTitle}>{layer.title}</strong>
              <span className={hpStyles.sourceLayerDescription}>{layer.description}</span>
              <span className={hpStyles.sourceLayerResult}>{layer.result}</span>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}
