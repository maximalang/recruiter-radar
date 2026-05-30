export const CUSTOMER_CHECKOUT_COPY = {
  orderNotFound: "Заказ не найден.",
  pilotOnly: "Эта операция доступна только для pilot.",
  paidOnly: "Сначала нужна успешная оплата.",
  connectTelegramFirst: "Сначала подключите Telegram.",
  telegramNotConfigured: "Telegram пока не настроен.",
  invalidOrderId: "Некорректный номер заказа.",
  updateOrderFailed: "Не удалось обновить заказ.",
  invalidLinkedId: "Некорректная связанная запись.",
  invalidTelegramTokenId: "Некорректный Telegram token id."
} as const;

export const TELEGRAM_CONNECT_RESULT_COPY = {
  connected: "Telegram подключён.",
  expired: "Ссылка устарела. Откройте новую из онбординга.",
  used: "Эта ссылка уже использована.",
  failed: "Не удалось завершить подключение Telegram.",
  inactive: "Ссылка недействительна."
} as const;

export function humanizeCustomerDeliveryIssue(message: string | null | undefined): string | null {
  if (typeof message !== "string") {
    return null;
  }

  const normalizedMessage = message.trim();
  return normalizedMessage === "" ? null : normalizedMessage;
}
