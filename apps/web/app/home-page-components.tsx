import { formatVacanciesCount } from "../lib/format/plural";

export { formatVacanciesCount };

export function buildFaqItems(paymentConfigured: boolean) {
  return [
    {
      question: "Нужен ли аккаунт, чтобы посмотреть пример?",
      answer: "Нет. Пример открывается сразу, без регистрации и без оплаты."
    },
    {
      question: "Что будет после оплаты?",
      answer: paymentConfigured
        ? "Настройка профиля, подключение Telegram и первый ежедневный радар."
        : "Заказ сохранится. К запуску можно вернуться без повторного ввода профиля."
    }
  ] as const;
}
