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
  | 'region'
  | 'contact-policy'
  | 'reachability'
  | 'exclusions';

/** Stable emoji per fit dimension for the UI. Presentation-only. */
export const FIT_DIMENSION_ICON: Record<FitDimension, string> = {
  industry: '🏭',
  role: '🧩',
  region: '📍',
  'contact-policy': '🛡',
  reachability: '📬',
  exclusions: '✅',
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
    lines.push({
      dimension: 'industry',
      text: 'Совпадение с вашей специализацией и ключевыми словами ICP',
      basis: 'fit.icp.match',
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
