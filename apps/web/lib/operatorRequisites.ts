/**
 * Operator requisites — the single source of truth for the self-employed
 * seller's identifying details (ФИО, ИНН, contact, status, service).
 *
 * The same values are rendered in the site footer and on the full requisites
 * page so public information cannot drift between surfaces.
 *
 * NPD note: the operator is exempt from using cash-register equipment while
 * applying the professional income tax regime. A receipt for each payment is
 * formed in the «Мой налог» application (or through an authorised operator)
 * and delivered to the customer. YooKassa processes the payment, but its
 * «Чеки от ЮKassa» 54-ФЗ product is not used for this NPD setup.
 */

function readPublicRequisite(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export const OPERATOR_REQUISITES = {
  /** ФИО — the self-employed seller's full name. Shown in the footer + /legal. */
  fullName: "Головий Наталья Ярославна",
  /** ИНН — tax ID of the NPD taxpayer. Shown in the footer + /legal. */
  inn: "622809740837",
  /** Legal status — shown on /legal (the full block); abbreviated from the footer. */
  status: "Самозанятый, плательщик НПД (налог на профессиональный доход)",
  /** Service description — shown on /legal. */
  service: "Recruiter Radar — ежедневный радар по компаниям с активным наймом",
  /** Public customer-support email created for recruiter-radar.ru. */
  email: "support@recruiter-radar.ru",
  /** Public support phone required for merchant moderation; never invent a value. */
  phone: readPublicRequisite(process.env.OPERATOR_PUBLIC_PHONE),
  /** Public postal/contact address required for merchant moderation. */
  postalAddress: readPublicRequisite(process.env.OPERATOR_PUBLIC_POSTAL_ADDRESS),
};

export type OperatorRequisites = typeof OPERATOR_REQUISITES;
