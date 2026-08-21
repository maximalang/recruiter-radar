/**
 * Pure server-side validation of the checkout legal contract. Extracted from
 * the checkout page server action so the rules are unit-testable.
 *
 * Rules (deliberately strict — browser validation can be bypassed):
 * - agencyName is required, non-blank, ≤160 chars;
 * - payerType is "individual" or "business" (default business);
 * - buyerInn: 10 digits for ООО, 12 for ИП, only when payerType=business;
 * - BOTH acceptTerms and acceptPersonalData must be exactly "on".
 */

export type CheckoutLegalErrorCode = "agency" | "inn" | "legal";

export type CheckoutLegalDecision =
  | { ok: true; payerType: "business" | "individual"; buyerInn: string | null }
  | { ok: false; errorCode: CheckoutLegalErrorCode };

const BUYER_INN_PATTERN = /^(?:\d{10}|\d{12})$/;

export function readFormText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Checkbox-level gate: both separate acceptances must be exactly "on". */
export function hasBothLegalAcceptances(acceptTerms: FormDataEntryValue | null, acceptPersonalData: FormDataEntryValue | null): boolean {
  return acceptTerms === "on" && acceptPersonalData === "on";
}

/**
 * Full order-form decision in the same order as the checkout server action:
 * agency name → payer/INN → legal checkboxes.
 */
export function validateCheckoutOrderForm(formData: FormData): CheckoutLegalDecision {
  const agencyName = readFormText(formData, "agencyName");
  if (!agencyName || agencyName.length > 160) {
    return { ok: false, errorCode: "agency" };
  }

  const payerType = readFormText(formData, "payerType") === "individual" ? "individual" : "business";
  const buyerInn = readFormText(formData, "buyerInn").replace(/\D/g, "");
  if (payerType === "business" && !BUYER_INN_PATTERN.test(buyerInn)) {
    return { ok: false, errorCode: "inn" };
  }

  if (!hasBothLegalAcceptances(formData.get("acceptTerms"), formData.get("acceptPersonalData"))) {
    return { ok: false, errorCode: "legal" };
  }

  return { ok: true, payerType, buyerInn: payerType === "business" ? buyerInn : null };
}
