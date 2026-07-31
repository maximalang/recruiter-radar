/**
 * Единственный источник публичных реквизитов продавца и оператора сервиса.
 * Полный блок показывается на /legal; продуктовые экраны и footer только
 * ссылаются на юридические страницы, чтобы не перегружать интерфейс.
 */

function readPublicValue(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export const OPERATOR_REQUISITES = {
  fullName: "Головий Наталья Ярославна",
  inn: "622809740837",
  status: "Самозанятый, плательщик НПД (налог на профессиональный доход)",
  ogrnNote: "ОГРН/ОГРНИП отсутствует: оператор зарегистрирован как самозанятый без статуса ИП",
  brandName: "Recruiter Radar",
  website: "https://recruiter-radar.ru",
  service: "Информационно-аналитический онлайн-сервис для рекрутинговых агентств",
  email: readPublicValue(process.env.OPERATOR_PUBLIC_EMAIL) ?? "support@recruiter-radar.ru",
  phone: readPublicValue(process.env.OPERATOR_PUBLIC_PHONE) ?? "+7 900 966-60-92",
  /** Реальный адрес для корреспонденции. Placeholder публично не выводится. */
  postalAddress: readPublicValue(process.env.OPERATOR_PUBLIC_POSTAL_ADDRESS),
} as const;

export type OperatorRequisites = typeof OPERATOR_REQUISITES;
