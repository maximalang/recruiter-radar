/**
 * Public requisites of the self-employed seller and service operator.
 *
 * These values are rendered in the footer, offer, privacy policy, payment
 * information and requisites page. Keep one source of truth so the merchant
 * storefront cannot show contradictory details during YooKassa moderation.
 *
 * NPD note: the operator is exempt from cash-register equipment while applying
 * the professional income tax regime. A receipt for every payment is formed in
 * «Мой налог» (or through an authorised NPD operator) and delivered to the
 * customer. YooKassa processes the payment and does not replace the NPD receipt.
 */

function readPublicRequisite(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export const OPERATOR_REQUISITES = {
  fullName: "Головий Наталья Ярославна",
  inn: "622809740837",
  status: "Самозанятый, плательщик НПД (налог на профессиональный доход)",
  ogrnNote: "Не применяется: оператор зарегистрирован как самозанятый без статуса ИП",
  brandName: "Recruiter Radar",
  website: "https://recruiter-radar.ru",
  service: "Информационно-аналитический онлайн-сервис для рекрутинговых агентств",
  email: "support@recruiter-radar.ru",
  /** Must contain a real public support number before live merchant moderation. */
  phone: readPublicRequisite(process.env.OPERATOR_PUBLIC_PHONE),
  /** Real address for correspondence; no placeholder is ever rendered publicly. */
  postalAddress: readPublicRequisite(process.env.OPERATOR_PUBLIC_POSTAL_ADDRESS),
} as const;

export type OperatorRequisites = typeof OPERATOR_REQUISITES;
