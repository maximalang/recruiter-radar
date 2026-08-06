import { ArrowGlyph, RouteGlyph, SignalGlyph } from "./brand-glyphs";
import { DEMO_COMPANY } from "./landing-copy";
import styles from "./landing.module.css";

const DELIVERY_STEPS = [
  { title: "Профиль агентства", text: "Специализация, география, ключевые и исключающие слова." },
  { title: "Сбор сигналов", text: "Вакансии, карьерные страницы и изменения публикаций объединяются по компании." },
  { title: "Проверка и оценка", text: "Радар проверяет свежесть, динамику, соответствие и доступность корпоративного контакта; scoring остаётся техническим слоем." },
  { title: "Короткая выдача", text: "Вместо потока вакансий — несколько компаний с объяснением приоритета." },
  { title: "Подключённый канал", text: "В пилоте радар приходит в Telegram; электронная почта подключается по запросу." },
  { title: "Решение пользователя", text: "Вы проверяете факты, выбираете компанию и решаете, обращаться ли к ней." },
] as const;

export default function DeliveryScene() {
  return (
    <section
      id="scene-delivery"
      className={`${styles.scene} ${styles.lightScene} ${styles.deliveryScene}`}
      aria-labelledby="delivery-title"
      data-header-tone="light"
    >
      <div className={styles.deliveryLayout}>
        <div className={styles.deliveryIntro}>
          <p className={styles.sceneLabel}>05 — Как работает доставка</p>
          <h2 id="delivery-title" className={styles.sceneHeading}>
            От профиля агентства до <em>короткой утренней выдачи.</em>
          </h2>
          <p className={styles.sceneLead}>
            Система автоматизирует исследование и приоритизацию, но не подменяет решение пользователя и не рассылает обращения компаниям.
          </p>
        </div>

        <ol className={styles.deliveryFlow}>
          {DELIVERY_STEPS.map((step, index) => (
            <li key={step.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div><strong>{step.title}</strong><p>{step.text}</p></div>
              {index < DELIVERY_STEPS.length - 1 ? <ArrowGlyph size={16} /> : <RouteGlyph size={18} />}
            </li>
          ))}
        </ol>

        <div className={styles.deliveryDemo}>
          <div className={styles.deliveryChannel}>
            <div><SignalGlyph size={48} /><span>Telegram / утренняя выдача</span></div>
            <strong>{DEMO_COMPANY.name}</strong>
            <p>{DEMO_COMPANY.signal}</p>
            <dl>
              <div><dt>Почему сейчас</dt><dd>{DEMO_COMPANY.whyNow}</dd></div>
              <div><dt>Достоверность</dt><dd>{DEMO_COMPANY.confidence}</dd></div>
              <div><dt>Следующий шаг</dt><dd>Открыть журнал доказательств и выбрать корпоративный путь контакта.</dd></div>
            </dl>
          </div>
          <aside className={styles.deliveryBoundary}>
            <span>Граница автоматизации</span>
            <strong>Recruiter Radar доставляет рекомендацию, но не отправляет сообщение компании.</strong>
            <p>Черновик, финальная проверка и отправка остаются в руках пользователя.</p>
          </aside>
        </div>
      </div>
    </section>
  );
}
