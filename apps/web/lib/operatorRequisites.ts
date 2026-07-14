/**
 * Operator requisites — the single source of truth for the self-employed
 * seller's identifying details (ФИО, ИНН, contact, status, service).
 *
 * Why this exists: these values were previously hardcoded in two places —
 * `app/ui/site-footer.tsx` (the legally-required minimum on every page) and
 * `app/legal/page.tsx` (the full requisites block). That duplication risked the
 * two surfaces drifting (a typo in one would not fix the other). This module is
 * the one place they live; both surfaces import from here.
 *
 * Legal note (why the footer keeps the operator name + ИНН on EVERY page, not
 * just /legal): a self-employed seller in Russia accepting payments online is
 * required by 152-ФЗ / 54-ФЗ and the Rules for remote sales to show identifying
 * information (name + tax ID + contact) on every public page where a service is
 * offered. So the operator's ФИО + ИНН + email MUST stay in the footer on all
 * surfaces — removing them from the footer would be a compliance regression.
 * The full status/service description stays on /legal; the footer carries only
 * the minimum the law requires everywhere plus a link to the full block.
 *
 * The ИНН is the operational key for ЮKassa receipt formation under ФЗ-54.
 * Do not change these values without confirming the seller's registration.
 */

export const OPERATOR_REQUISITES = {
  /** ФИО — the self-employed seller's full name. Shown in the footer + /legal. */
  fullName: "Головий Наталья Ярославна",
  /** ИНН — tax ID, used for ЮKassa receipts (ФЗ-54). Shown in the footer + /legal. */
  inn: "622809740837",
  /** Legal status — shown on /legal (the full block); abbreviated from the footer. */
  status: "Самозанятый, плательщик НПД (налог на профессиональный доход)",
  /** Service description — shown on /legal. */
  service: "Recruiter Radar — ежедневный радар по компаниям с активным наймом",
  /** Contact email — shown in the footer + /legal. */
  email: "6uunn9@gmail.com",
} as const;

export type OperatorRequisites = typeof OPERATOR_REQUISITES;
