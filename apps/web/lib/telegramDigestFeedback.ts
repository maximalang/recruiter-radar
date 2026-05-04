import type { HhDigestItem } from "./hhDigest";

export function buildTelegramDigestAuditItems(items: readonly HhDigestItem[]) {
  return items.map((item) => ({
    orgId: item.orgId,
    rank: item.rank,
    employerName: item.employer_name
  }));
}

export function buildTelegramDigestFeedbackReplyMarkup(input: {
  clientProfileId: string;
  items: readonly HhDigestItem[];
}) {
  void input;
  return null;
}
