/**
 * "Why this match" — the 2–3 concrete filter criteria a lead satisfies for an
 * agency's profile. Shown on the Telegram card (and reusable in the app) so a
 * recruiter sees, in one glance, WHY this company was surfaced for them.
 *
 * Pure + deterministic: compares the lead's facts against the saved profile
 * filters using the SAME signals the digest gate uses (industry/role keywords,
 * region, freshness, open-role count, intent). It states only what is actually
 * true of the lead — never an invented reason. Returns at most `limit` lines,
 * highest-signal first; empty when nothing concrete matches.
 */

import type { ClientProfile } from "../clientProfiles";
import { INDUSTRY_KEYWORDS } from "../clientProfiles";
import { ROLE_HABR_KEYWORDS } from "../lead-discovery/habr-keywords";
import { INDUSTRY_OPTIONS, ROLE_OPTIONS } from "../clientProfileOptions";

export interface WhyMatchLead {
  orgName: string;
  evidenceTitles: string[];
  locationNames: string[];
  vacanciesCount: number | null;
  score: number | null;
  /** ISO date of the latest hiring signal, for the freshness line. */
  latestSignalAt?: string | null;
}

/**
 * The subset of profile filters why-match reads. Accepting a narrow shape (not
 * the full ClientProfile) lets the Telegram delivery path pass just these fields
 * without reconstructing a whole profile.
 */
export type WhyMatchProfile = Pick<
  ClientProfile,
  "roles" | "industries" | "targetCity" | "minOpenRoles" | "hiringIntentMin"
>;

const INDUSTRY_LABEL = new Map(INDUSTRY_OPTIONS.map((o) => [o.key, o.label]));
const ROLE_LABEL = new Map(ROLE_OPTIONS.map((o) => [o.key, o.label]));

function haystackOf(lead: WhyMatchLead): string {
  return [lead.orgName, ...lead.evidenceTitles, ...lead.locationNames]
    .join(" ")
    .toLocaleLowerCase("ru-RU");
}

/**
 * Build the why-this-match lines. `limit` caps how many are returned (default 3,
 * keeping the card scannable). Order = strongest signal first: role → industry →
 * region → open roles → freshness → intent.
 */
export function buildWhyMatch(
  lead: WhyMatchLead,
  profile: WhyMatchProfile,
  limit = 3,
): string[] {
  const haystack = haystackOf(lead);
  const lines: string[] = [];

  // Role match — the agency's specialisation showing up in the hiring signal.
  const matchedRole = profile.roles.find((key) => {
    const kws = ROLE_HABR_KEYWORDS[key];
    return kws && kws.some((kw) => haystack.includes(kw.toLocaleLowerCase("ru-RU")));
  });
  if (matchedRole) {
    lines.push(`Нанимают по вашему профилю: ${ROLE_LABEL.get(matchedRole) ?? matchedRole}`);
  }

  // Industry match.
  const matchedIndustry = profile.industries.find((key) => {
    const kws = INDUSTRY_KEYWORDS.get(key);
    return kws && kws.some((kw) => haystack.includes(kw));
  });
  if (matchedIndustry) {
    lines.push(`Отрасль: ${INDUSTRY_LABEL.get(matchedIndustry) ?? matchedIndustry}`);
  }

  // Region match — the agency's target city appears in the lead's locations.
  if (profile.targetCity && profile.targetCity.trim()) {
    const needle = profile.targetCity.trim().toLocaleLowerCase("ru-RU");
    if (lead.locationNames.some((loc) => loc.toLocaleLowerCase("ru-RU").includes(needle))) {
      lines.push(`Регион: ${profile.targetCity.trim()}`);
    }
  }

  // Open-role volume — only when the agency set a minimum and the lead clears it.
  if (profile.minOpenRoles != null && (lead.vacanciesCount ?? 0) >= profile.minOpenRoles) {
    lines.push(`Открыто ролей: ${lead.vacanciesCount}`);
  }

  // Intent strength — only when the agency set an intent floor and the lead clears it.
  if (profile.hiringIntentMin != null && lead.score != null && lead.score >= profile.hiringIntentMin) {
    lines.push(`Сила сигнала найма выше вашего порога`);
  }

  return lines.slice(0, limit);
}
