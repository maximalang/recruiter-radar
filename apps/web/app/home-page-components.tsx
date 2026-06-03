import styles from "./home-page-components.module.css";

export function MetricRow(props: { label: string; value: string }) {
  return (
    <div className={styles.metricRow}>
      <strong>{props.label}</strong>
      <span>{props.value}</span>
    </div>
  );
}

export function formatVacanciesCount(value: number): string {
  if (value === 1) {
    return "1 вакансия";
  }

  if (value >= 2 && value <= 4) {
    return `${value} вакансии`;
  }

  return `${value} вакансий`;
}

export function buildFaqItems(paymentConfigured: boolean) {
  return [
    {
      question: "Для кого это?",
      answer:
        "Для агентств, рекрутеров и BD-команд, которым нужен не длинный поиск, а короткий список компаний с живым спросом на найм."
    },
    {
      question: "Что я вижу в радаре?",
      answer:
        "Компанию, силу сигнала, короткое объяснение, почему она в фокусе, и лучший угол первого контакта."
    },
    {
      question: "Нужен ли аккаунт, чтобы посмотреть пример?",
      answer: "Нет. Пример открывается сразу, без регистрации и без оплаты."
    },
    {
      question: "Что будет после оплаты?",
      answer: paymentConfigured
        ? "Сразу откроется настройка профиля, подключение Telegram и запуск первого ежедневного радара."
        : "Заказ сохранится. Как только оплата будет доступна, к запуску можно вернуться без повторного ввода профиля."
    }
  ] as const;
}

export { styles as homePageStyles };
