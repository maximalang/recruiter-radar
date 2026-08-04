/**
 * Единственный источник публичных реквизитов продавца и оператора сервиса.
 * Полный блок показывается на /legal; footer содержит минимум, необходимый
 * покупателю и модерации платёжного оператора.
 */

function readPublicValue(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export const OPERATOR_REQUISITES = {
  fullName: "Головий Наталья Ярославна",
  inn: "622809740837",
  status: "Самозанятый, плательщик НПД (налог на профессиональный доход)",
  ogrnNote: "ОГРН/ОГРНИП отсутствует: продавец зарегистрирован как самозанятый без статуса ИП",
  brandName: "Recruiter Radar",
  website: "https://recruiter-radar.ru",
  service: "Информационно-аналитический онлайн-сервис для рекрутинговых агентств",
  /** Подтверждённый рабочий публичный адрес. Не переопределяется deployment-env. */
  email: "support@recruiter-radar.ru",
  /** Подтверждённый публичный телефон. */
  phone: "+7 900 966-60-92",
  /** Для самозанятого Robokassa допускает указание города вместо полного адреса. */
  city: readPublicValue(process.env.OPERATOR_PUBLIC_CITY),
  /** Необязательный фактический адрес для корреспонденции, если продавец решит его раскрывать. */
  postalAddress: readPublicValue(process.env.OPERATOR_PUBLIC_POSTAL_ADDRESS),
} as const;

export type OperatorRequisites = typeof OPERATOR_REQUISITES;
