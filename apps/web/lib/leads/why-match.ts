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
 *
 * Mode-aware (2026-07-06): the resolved hiring mode reorders the strongest
 * signal so the card leads with the cue that defines the agency type:
 *   executive — a senior role title in the evidence is the defining cue and
 *               is surfaced first (stated only when a senior title is actually
 *               present — never invented).
 *   volume    — open-role volume is surfaced as a hiring-scale line when the
 *               lead has a meaningful number of open roles.
 *   specialist — the pre-mode order below (role → industry → region → …).
 * The mode only changes emphasis/order; it never drops a real signal or adds
 * one the lead doesn't support.
 */

import type { ClientProfile } from "../clientProfiles";
import { INDUSTRY_KEYWORDS } from "../clientProfiles";
import { ROLE_HABR_KEYWORDS } from "../lead-discovery/habr-keywords";
import { INDUSTRY_OPTIONS, ROLE_OPTIONS } from "../clientProfileOptions";
import { hasSeniorRole } from "../scoring/role-category";

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
 * without reconstructing a whole profile. `hiringMode` is the RESOLVED mode
 * (never 'auto' — resolve upstream) and is optional for backward compatibility.
 */
export type WhyMatchProfile = Pick<
  ClientProfile,
  "roles" | "industries" | "targetCity" | "minOpenRoles" | "hiringIntentMin" | "remoteFriendly"
> & {
  /** Resolved hiring mode (never 'auto'). Optional; defaults to specialist. */
  hiringMode?: 'specialist' | 'executive' | 'volume';
};

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
 * region → open roles → freshness → intent, with the mode reshaping which cue
 * leads (seniority for executive, hiring-scale for volume).
 */
export function buildWhyMatch(
  lead: WhyMatchLead,
  profile: WhyMatchProfile,
  limit = 3,
): string[] {
  const haystack = haystackOf(lead);
  const mode = profile.hiringMode ?? 'specialist';
  const lines: string[] = [];

  // Executive mode: seniority is the defining cue. Surface it FIRST and only
  // when a senior title is actually present in the evidence — never invent a
  // C-level claim. This is the line an executive agency scans for; without it
  // the card would read as a generic volume/specialist match.
  if (mode === 'executive' && lead.evidenceTitles.length > 0 && hasSeniorRole(lead.evidenceTitles)) {
    lines.push('Нанимают руководителя / C-level — совпадает с executive-практикой');
  }

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

  // Region — confirm a match, or flag a mismatch so a narrow-region agency is
  // not misled. A mismatch is only asserted when the lead HAS location data that
  // fails to include the target city (absence of location can't prove mismatch),
  // and never for a remote-friendly agency (geography is not a constraint there).
  if (profile.targetCity && profile.targetCity.trim()) {
    const needle = profile.targetCity.trim().toLocaleLowerCase("ru-RU");
    const matches = lead.locationNames.some((loc) =>
      loc.toLocaleLowerCase("ru-RU").includes(needle),
    );
    if (matches) {
      lines.push(`Регион: ${profile.targetCity.trim()}`);
    } else if (lead.locationNames.length > 0 && !profile.remoteFriendly) {
      lines.push(`Регион не ваш: ${lead.locationNames.slice(0, 2).join(", ")}`);
    }
  }

  // Open-role volume. In volume mode this is the defining cue — surface it as a
  // hiring-scale line whenever there is a meaningful number of open roles (not
  // only when the agency set an explicit minimum), because volume agencies win
  // mandates on throughput. Stated only with the real count — no inflation.
  if (mode === 'volume' && (lead.vacanciesCount ?? 0) >= 3) {
    lines.push(`Масштаб найма: ${lead.vacanciesCount} открытых ролей`);
  } else if (profile.minOpenRoles != null && (lead.vacanciesCount ?? 0) >= profile.minOpenRoles) {
    lines.push(`Открыто ролей: ${lead.vacanciesCount}`);
  }

  // Intent strength — only when the agency set an intent floor and the lead clears it.
  if (profile.hiringIntentMin != null && lead.score != null && lead.score >= profile.hiringIntentMin) {
    lines.push(`Сила сигнала найма выше вашего порога`);
  }

  return lines.slice(0, limit);
}
