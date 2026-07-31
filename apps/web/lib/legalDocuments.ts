export const LEGAL_DOCUMENTS = {
  terms: {
    revision: "2026-07-31",
    displayDate: "31 июля 2026 года",
  },
  privacy: {
    revision: "2026-07-31",
    displayDate: "31 июля 2026 года",
  },
} as const;

export function buildLegalAcceptanceAudit(acceptedAt: string): string {
  const normalizedAcceptedAt = new Date(acceptedAt).toISOString();
  return [
    "legal_acceptance:v1",
    `accepted_at=${normalizedAcceptedAt}`,
    `terms=${LEGAL_DOCUMENTS.terms.revision}`,
    `privacy=${LEGAL_DOCUMENTS.privacy.revision}`,
  ].join(";");
}
