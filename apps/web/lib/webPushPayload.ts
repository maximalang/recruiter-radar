import type { WebPushPayload } from "./webPush";

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

/** Russian plural for "сильный лид" (1 сильный лид / 2 сильных лида / 5 сильных лидов). */
function pluralizeLeads(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;

  if (mod100 >= 11 && mod100 <= 14) {
    return "новых сильных лидов";
  }
  if (mod10 === 1) {
    return "новый сильный лид";
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return "новых сильных лида";
  }
  return "новых сильных лидов";
}
