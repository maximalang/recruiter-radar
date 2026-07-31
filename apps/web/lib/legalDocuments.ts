export const LEGAL_DOCUMENTS = {
  terms: {
    revision: "2026-07-31",
    displayDate: "31 июля 2026 года",
  },
  privacy: {
    revision: "2026-07-31",
    displayDate: "31 июля 2026 года",
  },
  personalDataConsent: {
    revision: "2026-07-31",
    displayDate: "31 июля 2026 года",
  },
} as const;

export type LegalAcceptanceAudit = {
  acceptedAt: string;
  termsRevision: string;
  privacyRevision: string;
  personalDataConsentRevision: string;
};

export function buildLegalAcceptanceAudit(acceptedAt = new Date().toISOString()): LegalAcceptanceAudit {
  return {
    acceptedAt: new Date(acceptedAt).toISOString(),
    termsRevision: LEGAL_DOCUMENTS.terms.revision,
    privacyRevision: LEGAL_DOCUMENTS.privacy.revision,
    personalDataConsentRevision: LEGAL_DOCUMENTS.personalDataConsent.revision,
  };
}
