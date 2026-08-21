export const LEGAL_DOCUMENTS = {
  legal: {
    revision: "2026-08-05",
    displayDate: "5 августа 2026 года",
  },
  terms: {
    revision: "2026-08-21",
    displayDate: "21 августа 2026 года",
  },
  paymentAndRefund: {
    revision: "2026-08-21",
    displayDate: "21 августа 2026 года",
  },
  privacy: {
    revision: "2026-08-21",
    displayDate: "21 августа 2026 года",
  },
  personalDataConsent: {
    revision: "2026-08-05",
    displayDate: "5 августа 2026 года",
  },
  cookies: {
    revision: "2026-08-21",
    displayDate: "21 августа 2026 года",
  },
  acceptableUse: {
    revision: "2026-08-21",
    displayDate: "21 августа 2026 года",
  },
  dataPolicy: {
    revision: "2026-08-21",
    displayDate: "21 августа 2026 года",
  },
} as const;

export type LegalDocumentKey = keyof typeof LEGAL_DOCUMENTS;

/**
 * Version of the checkout-facing document SET semantics. Bump only when the
 * set of documents captured at checkout (or the meaning of a recorded
 * acceptance) changes — not for editorial revisions of individual documents.
 */
export const LEGAL_SET_REVISION = "2026-08-21";

/**
 * Immutable snapshot of the checkout-captured document set. Historical orders
 * resolve their recorded per-document revisions against these frozen texts.
 * See apps/web/lib/legal/archive/README.md.
 */
export const CHECKOUT_LEGAL_ARCHIVE_SET = {
  legalSetRevision: LEGAL_SET_REVISION,
  documents: ["terms", "paymentAndRefund", "privacy", "personalDataConsent"],
} as const;

export type LegalAcceptanceAudit = {
  acceptedAt: string;
  legalSetRevision?: string;
  termsRevision: string;
  paymentAndRefundRevision: string;
  privacyRevision: string;
  personalDataConsentRevision: string;
};

/** Documents whose acceptance must be proven at checkout, with current revisions. */
export function buildLegalAcceptanceAudit(acceptedAt = new Date().toISOString()): LegalAcceptanceAudit {
  return {
    acceptedAt: new Date(acceptedAt).toISOString(),
    legalSetRevision: LEGAL_SET_REVISION,
    termsRevision: LEGAL_DOCUMENTS.terms.revision,
    paymentAndRefundRevision: LEGAL_DOCUMENTS.paymentAndRefund.revision,
    privacyRevision: LEGAL_DOCUMENTS.privacy.revision,
    personalDataConsentRevision: LEGAL_DOCUMENTS.personalDataConsent.revision,
  };
}
