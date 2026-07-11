import type { WebPushPayload } from "./webPush";
import { pluralForm } from "./format/plural";

/**
 * Builds the aggregate "you have new strong leads" push payload.
 *
 * Aggregate, never per-lead: we send one notification summarising the count so
 * the agency is nudged to open the radar, not spammed with N notifications.
 * Pure and dependency-free so it is trivially unit-testable.
 */
export function buildNewLeadsPushPayload(input: {
  count: number;
  url?: string;
}): WebPushPayload {
  const count = Math.max(0, Math.trunc(input.count));
  const url = input.url ?? "/leads";

  return {
    title: "Recruiter Radar",
    body: formatNewLeadsBody(count),
    url,
  };
}

function formatNewLeadsBody(count: number): string {
  if (count <= 0) {
    return "Появились новые лиды в радаре.";
  }
  return `${count} ${pluralizeLeads(count)} в радаре — стоит написать сегодня.`;
}

/** Russian plural for "новый сильный лид" (1 новый сильный лид / 2 новых сильных лида / 5 новых сильных лидов). */
function pluralizeLeads(count: number): string {
  return pluralForm(count, ["новый сильный лид", "новых сильных лида", "новых сильных лидов"]);
}
