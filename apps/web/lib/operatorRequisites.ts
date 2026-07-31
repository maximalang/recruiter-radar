/**
 * Public requisites of the self-employed seller and service operator.
 *
 * Full identifying details are rendered on the dedicated requisites page and
 * referenced by the offer/privacy documents. The shared footer only links to
 * those pages so product surfaces stay visually quiet.
 */

export const OPERATOR_REQUISITES = {
  fullName: "Головий Наталья Ярославна",
  inn: "622809740837",
  status: "Самозанятый, плательщик НПД (налог на профессиональный доход)",
  service: "Recruiter Radar — ежедневный радар по компаниям с активным наймом",
  email: "support@recruiter-radar.ru",
  phone: "+7 900 966-60-92",
} as const;

export type OperatorRequisites = typeof OPERATOR_REQUISITES;
