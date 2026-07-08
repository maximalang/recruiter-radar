/**
 * Deterministic "Почему этот лид вам подходит" builder.
 *
 * Produces a profile-aware fit explanation for a lead using ONLY data that
 * already exists: the lead's structured scoring reasons and the agency's
 * ClientProfile. Every emitted line traces to a concrete input via its `basis`
 * tag — no line is produced without supporting evidence, and nothing is invented.
 *
 * This is the deterministic baseline a future AI layer may *reword* (via the
 * ExplanationEnhance hook) but never *add reasons to*. It reads the
 * deterministic core read-only; it changes no score, gate, or evidence.
 *
 * docs/specs/2026-06-27-stage1-ai-assist-deterministic.md
 */

import type { ScoringReason } from '../scoring/scoring-reasons';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Which fit dimension a line speaks to — used for ordering and icons in the UI. */
export type FitDimension =
  | 'industry'
  | 'role'
  | 'seniority'
  | 'region'
  | 'contact-policy'
  | 'reachability'
  | 'exclusions';

/**
 * Stable icon key per fit dimension for the UI. Presentation-only.
 *
 * Each value is a stable string key the UI layer maps to an inline-SVG icon
 * component (see app/ui/icons + the FIT_DIMENSION_ICON_COMPONENT map in
 * internal-page.tsx). Keeping a string here preserves the lib→app boundary
 * (lib never imports presentation) while the dimension→glyph mapping stays
 * co-located with the dimension type. Consumers render the mapped component.
 */
export const FIT_DIMENSION_ICON: Record<FitDimension, string> = {
  industry: 'industry',
  role: 'role',
  seniority: 'target',
  region: 'pin',
  'contact-policy': 'shield',
  reachability: 'mail',
  exclusions: 'check',
};

export interface FitLine {
  dimension: FitDimension;
  /** User-facing Russian text. Concise, premium, specific. */
  text: string;
  /**
   * Trace tag for where this line came from (a scoring key or a profile↔lead
   * match). Asserted in tests so no line can appear without a basis.
   */
  basis: string;
}

export interface FitExplanation {
  lines: FitLine[];
  /** True when no positive fit dimension could be supported by evidence. */
  isEmpty: boolean;
}

/** The lead fields the builder reads. Subset of LeadItem — kept narrow on purpose. */
export interface FitLeadInput {
  structuredReasons: ScoringReason[];
  locationNames: string[];
  lawfulContactPath: string | null;
  sourceFamilies: string[];
  careerPageUrl?: string | null;
  orgDomain?: string | null;
  /**
   * Free-text haystack for ICP term re-derivation: org name + evidence titles
   * (+ role names on the detail page). When the scorer emitted fit.icp.match,
   * the builder re-derives WHICH specialization/include term actually hit this
   * haystack so the explanation names the concrete niche, not a generic label.
   * Optional — when absent the builder falls back to the generic line.
   */
  icpHaystack?: string | null;
  /** Org name — folded into the ICP haystack when present. */
  orgName?: string | null;
  /** Evidence titles — folded into the ICP haystack when present. */
  evidenceTitles?: string[];
}

/** The profile fields the builder reads. Subset of ClientProfile. */
export interface FitProfileInput {
  industries: string[];
  roles: string[];
  excludedIndustries: string[];
  excludedLocations: string[];
  contactPolicy: 'corporate_only' | 'no_personal' | 'unrestricted';
  remoteFriendly: boolean;
  targetCity: string | null;
  /**
   * Free-text ICP specialization (e.g. "IT-рекрутмент, дата-инженеры").
   * When the scorer emitted fit.icp.match and a term from this field appears
   * in the lead haystack, the explanation names it — the single most useful
   * line for a narrow/specialized agency. Optional for backward compat.
   */
  specialization?: string | null;
  /** Extra ICP keywords (industries / niches) — same re-derivation path. */
  includeKeywords?: string[];
}

// ─── Builder ─────────────────────────────────────────────────────────────────

/**
 * Build the deterministic fit explanation. Order of lines is stable
 * (industry → role → region → contact-policy → reachability → exclusions) so the
 * UI reads consistently.
 */
export function buildFitExplanation(
  lead: FitLeadInput,
  profile: FitProfileInput,
): FitExplanation {
  const reasons = lead.structuredReasons ?? [];
  const keys = new Set(reasons.map((r) => r.key));
  const paramsByKey = indexParams(reasons);
  const lines: FitLine[] = [];

  // 1. Industry — only positive fit (match / partial). Exclusions handled below.
  if (keys.has('fit.industry.match') || keys.has('fit.industry.match.reweighted')) {
    const industry = paramsByKey['fit.industry.match']?.industry
      ?? paramsByKey['fit.industry.match.reweighted']?.industry;
    lines.push({
      dimension: 'industry',
      text: industry
        ? `Индустрия «${industry}» совпадает с вашим ICP`
        : 'Индустрия совпадает с вашим ICP',
      basis: 'fit.industry.match',
    });
  } else if (keys.has('fit.industry.partial')) {
    const industry = paramsByKey['fit.industry.partial']?.industry;
    lines.push({
      dimension: 'industry',
      text: industry
        ? `Индустрия «${industry}» частично совпадает с вашим ICP`
        : 'Индустрия частично совпадает с вашим ICP',
      basis: 'fit.industry.partial',
    });
  } else if (keys.has('fit.icp.match')) {
    // Narrow-agency clarity: re-derive WHICH specialization / include term
    // actually matched the lead's own text and name it. The scorer already
    // asserted the match (fit.icp.match) against company + vacancy text; here
    // we re-check against the lead's org name + evidence titles (the fields
    // available on the list/detail surface) so the term we surface is one the
    // recruiter can literally see in the lead. If no term re-derives (the
    // vacancy text that matched isn't exposed on this surface), fall back to
    // the honest generic label — never invent a term.
    const matchedTerm = findMatchedIcpTerm(lead, profile);
    lines.push({
      dimension: 'industry',
      text: matchedTerm
        ? `Специализация «${matchedTerm}» совпадает с вашим ICP`
        : 'Совпадение с вашей специализацией и ключевыми словами ICP',
      basis: matchedTerm ? 'fit.icp.match.named' : 'fit.icp.match',
    });
  }

  // 2. Role / hiring signal — matched role patterns.
  if (keys.has('fit.role.match')) {
    const count = paramsByKey['fit.role.match']?.count;
    lines.push({
      dimension: 'role',
      text: count
        ? `${count} ролей совпадает с вашим профилем`
        : 'Роли совпадают с вашим профилем',
      basis: 'fit.role.match',
    });
  } else if (keys.has('intent.multiple-roles')) {
    const count = paramsByKey['intent.multiple-roles']?.count;
    lines.push({
      dimension: 'role',
      text: count
        ? `Несколько открытых ролей (${count}) — активный найм`
        : 'Несколько открытых ролей — активный найм',
      basis: 'intent.multiple-roles',
    });
  }

  // 2b. Seniority — the defining fit cue for executive-search agencies.
  // Latches onto the FIUR fit.seniority.match reason (only emitted in
  // executive mode when a senior role is detected). States only what the
  // scorer asserted: a senior hire is present. Never invents seniority.
  if (keys.has('fit.seniority.match')) {
    lines.push({
      dimension: 'seniority',
      text: 'Нанимают руководителя / C-level — совпадает с executive-практикой',
      basis: 'fit.seniority.match',
    });
  }

  // 3. Region / remote fit.
  if (keys.has('fit.location.match')) {
    lines.push({
      dimension: 'region',
      text: profile.targetCity
        ? `Регион совпадает с вашим ICP (${profile.targetCity})`
        : 'Регион совпадает с вашим ICP',
      basis: 'fit.location.match',
    });
  } else if (profile.remoteFriendly && lead.locationNames.length > 0) {
    // Remote-friendly agency can serve regardless of the company's location —
    // a real fit even when the region itself is not an explicit ICP match.
    lines.push({
      dimension: 'region',
      text: 'Вы работаете удалённо — география компании не ограничивает',
      basis: 'profile.remoteFriendly',
    });
  }

  // 4. Contact-policy fit — only assert when a lawful path exists AND it is
  //    compatible with the agency's policy. Never imply a personal channel.
  const policyLine = contactPolicyLine(lead.lawfulContactPath, profile.contactPolicy);
  if (policyLine) lines.push(policyLine);

  // 5. Reachability / corporate surface — a direct company surface to reach HR.
  if (keys.has('reachability.career-page') || lead.careerPageUrl) {
    lines.push({
      dimension: 'reachability',
      text: 'Есть карьерная страница — прямой путь к HR',
      basis: keys.has('reachability.career-page')
        ? 'reachability.career-page'
        : 'lead.careerPageUrl',
    });
  } else if (keys.has('reachability.corporate-contact')) {
    lines.push({
      dimension: 'reachability',
      text: 'Доступен корпоративный HR-контакт',
      basis: 'reachability.corporate-contact',
    });
  } else if (keys.has('reachability.direct-surface') || lead.orgDomain) {
    lines.push({
      dimension: 'reachability',
      text: 'Есть прямая корпоративная поверхность для контакта',
      basis: keys.has('reachability.direct-surface')
        ? 'reachability.direct-surface'
        : 'lead.orgDomain',
    });
  }

  // 6. Exclusions avoided — only claim this when the agency actually HAS
  //    exclusions and this lead violated none of them. A profile with no
  //    exclusions gets no (vacuous) line.
  const exclusionLine = exclusionsAvoidedLine(lead, profile, keys);
  if (exclusionLine) lines.push(exclusionLine);

  return { lines, isEmpty: lines.length === 0 };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function indexParams(
  reasons: ScoringReason[],
): Record<string, Record<string, string | number> | undefined> {
  const out: Record<string, Record<string, string | number> | undefined> = {};
  for (const r of reasons) {
    // First occurrence wins; reasons rarely duplicate a key.
    if (!(r.key in out)) out[r.key] = r.params;
  }
  return out;
}

/**
 * Split a comma-separated free-text ICP field into normalised lowercased terms.
 * Mirrors lib/preview-relevance.ts and lib/scoring/fiur.ts splitTerms so the
 * explanation re-derivation agrees with how the scorer tokenised the field.
 */
function splitIcpTerms(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim().toLocaleLowerCase('ru-RU'))
    .filter((item) => item !== '');
}

/**
 * Build the lowercased haystack the ICP re-derivation scans. Combines the
 * explicit icpHaystack (if the caller built one) with the org name and
 * evidence titles — the free-text fields the recruiter can see on the lead
 * surface. Location names are NOT folded in (they drive the region line).
 */
function buildIcpHaystack(lead: FitLeadInput): string {
  if (lead.icpHaystack && lead.icpHaystack.trim() !== '') {
    return lead.icpHaystack.toLocaleLowerCase('ru-RU');
  }
  const parts: string[] = [];
  if (lead.orgName) parts.push(lead.orgName);
  if (lead.evidenceTitles) parts.push(...lead.evidenceTitles);
  return parts.join(' ').toLocaleLowerCase('ru-RU');
}

/**
 * Re-derive the single specialization / include term that appears in the lead's
 * visible text. Returns the FIRST hit (stable order: specialization terms in
 * declared order, then include keywords) so the explanation is deterministic.
 * Returns null when no term re-derives from the visible haystack — the scorer
 * matched against vacancy text that isn't exposed on this surface, so we refuse
 * to name a term we can't evidence here.
 */
function findMatchedIcpTerm(
  lead: FitLeadInput,
  profile: FitProfileInput,
): string | null {
  const haystack = buildIcpHaystack(lead);
  if (!haystack) return null;

  const specializationTerms = splitIcpTerms(profile.specialization);
  for (const term of specializationTerms) {
    if (haystack.includes(term)) return term;
  }

  const includeTerms = (profile.includeKeywords ?? [])
    .map((v) => v.trim().toLocaleLowerCase('ru-RU'))
    .filter((v) => v !== '');
  for (const term of includeTerms) {
    if (haystack.includes(term)) return term;
  }

  return null;
}

function contactPolicyLine(
  lawfulContactPath: string | null,
  policy: FitProfileInput['contactPolicy'],
): FitLine | null {
  if (!lawfulContactPath) return null;

  // corporate_only / no_personal: a lawful path here is by construction a
  // non-personal corporate route (deriveLawfulContactPath only returns
  // career-page / corporate-contact / registry / direct-surface), so it is
  // compatible with the strict policies.
  if (policy === 'corporate_only') {
    return {
      dimension: 'contact-policy',
      text: 'Безопасный корпоративный путь контакта — совпадает с вашей политикой «только корпоративные каналы»',
      basis: 'contactPolicy.corporate_only',
    };
  }
  if (policy === 'no_personal') {
    return {
      dimension: 'contact-policy',
      text: 'Контакт через неличный корпоративный канал — совпадает с вашей политикой',
      basis: 'contactPolicy.no_personal',
    };
  }
  return null; // unrestricted — no policy claim to make
}

function exclusionsAvoidedLine(
  lead: FitLeadInput,
  profile: FitProfileInput,
  keys: Set<string>,
): FitLine | null {
  const hasExclusions =
    profile.excludedIndustries.length > 0 || profile.excludedLocations.length > 0;
  if (!hasExclusions) return null;

  // If the scorer flagged an exclusion or competitor, this is NOT a clean lead —
  // do not claim exclusions were avoided.
  if (
    keys.has('fit.industry.excluded') ||
    keys.has('fit.competitor.excluded') ||
    keys.has('fit.location.outside')
  ) {
    return null;
  }

  // Lead location must not intersect the agency's excluded locations.
  const excludedSet = new Set(
    profile.excludedLocations.map((l) => l.trim().toLowerCase()),
  );
  const hitsExcludedLocation = lead.locationNames.some((l) =>
    excludedSet.has(l.trim().toLowerCase()),
  );
  if (hitsExcludedLocation) return null;

  return {
    dimension: 'exclusions',
    text: 'Лид не попадает в ваши исключения по индустрии и географии',
    basis: 'profile.exclusions.cleared',
  };
}
