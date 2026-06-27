/**
 * AI integration boundary — the contract every AI-assist layer must obey.
 *
 * Recruiter Radar is evidence-first. Trust comes from a deterministic core:
 * FIUR score (additive contract), confidence gates, and raw evidence are
 * computed without AI and MUST stay that way. AI is a *secondary assist layer*
 * that sits ON TOP of that core — it may summarize, explain, classify, or flag
 * missing data, but it may never become the source of a score, a gate, or a
 * fact.
 *
 * This file is intentionally dependency-free and model-free. No LLM is wired in
 * Stage 1; this is the seam a future model plugs into without being able to
 * violate the product's trust contract. See
 * docs/specs/2026-06-27-stage1-ai-assist-deterministic.md and §D of
 * 2026-06-27-delivery-paths-and-ai-roadmap.md.
 */

// ─── Capability / Prohibition contract ──────────────────────────────────────

/**
 * What an AI-assist layer is permitted to do. Each capability operates on
 * *already-computed* lead data and writes only to auxiliary / draft fields that
 * are visually attributed as AI and are optional (the product degrades to the
 * deterministic output when no model is available).
 */
export const AI_CAPABILITIES = [
  'summarize', // restate existing evidence in fewer words
  'explain-fit', // articulate why an already-scored lead matches the profile
  'draft-opener', // propose an editable outreach draft (human always confirms)
  'highlight-missing-info', // point out structured gaps worth enriching
  'classify-intent', // (future) suggest a hiring-intent label as a hint, not a gate input
  'extract-weak-signal', // (future) surface a candidate signal for human/deterministic review
] as const;

export type AiCapability = (typeof AI_CAPABILITIES)[number];

/**
 * What an AI-assist layer is NEVER permitted to do — the hard trust boundary.
 * These are enforced in code (see `assertNoOverride`) and in review, not left to
 * prompt discipline.
 */
export const AI_PROHIBITIONS = [
  'change-gate', // confidence gate stays deterministic — AI text is not an evidence layer
  'change-score', // FIUR additive contract stays deterministic
  'invent-evidence', // no company / role / industry / contact not present in evidence
  'bypass-contact-policy', // corporate_only / no_personal are hard filters AI must respect
  'auto-send', // nothing leaves the product without explicit human confirmation
  'mutate-suppression', // feedback / suppression state is owned by the deterministic core
] as const;

export type AiProhibition = (typeof AI_PROHIBITIONS)[number];

/**
 * Fields an AI layer must treat as READ-ONLY. If any future assist code is given
 * a lead-shaped object, these keys are the deterministic-core surface it may read
 * but never write. Used by `assertNoOverride` to catch accidental mutation.
 */
export const PROTECTED_LEAD_FIELDS = [
  'score',
  'confidenceGate',
  'evidenceTitles',
  'reasons',
  'structuredReasons',
  'negativeSignals',
  'lawfulContactPath',
] as const;

export type ProtectedLeadField = (typeof PROTECTED_LEAD_FIELDS)[number];

// ─── Runtime guard ───────────────────────────────────────────────────────────

export class AiBoundaryViolation extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = 'AiBoundaryViolation';
  }
}

/**
 * Assert that an AI-produced object did not overwrite any protected
 * deterministic-core field. Compares the proposed object against the original
 * lead snapshot; throws `AiBoundaryViolation` on the first divergence.
 *
 * Use this whenever an AI layer returns an object that *extends* a lead with
 * draft / explanation fields — it guarantees the core fields came through
 * untouched. It is deep-equality on the protected fields only; everything else
 * (drafts, summaries) is free to differ.
 *
 * @param original deterministic lead snapshot (source of truth)
 * @param proposed object returned by an AI layer
 */
export function assertNoOverride<
  T extends Partial<Record<ProtectedLeadField, unknown>>,
>(original: T, proposed: Partial<Record<ProtectedLeadField, unknown>>): void {
  for (const field of PROTECTED_LEAD_FIELDS) {
    if (!(field in proposed)) continue;
    const before = original[field];
    const after = proposed[field];
    if (!deepEqual(before, after)) {
      throw new AiBoundaryViolation(
        `AI layer attempted to override protected field "${field}". ` +
          `Score, gate, and evidence are deterministic and read-only to AI.`,
        field,
      );
    }
  }
}

/**
 * Whether a proposed capability is allowed. A typo or a future capability not
 * yet in the contract returns false rather than silently passing.
 */
export function isAllowedCapability(capability: string): capability is AiCapability {
  return (AI_CAPABILITIES as readonly string[]).includes(capability);
}

// ─── Internal ────────────────────────────────────────────────────────────────

/**
 * Minimal structural deep-equality for the JSON-shaped values protected fields
 * hold (primitives, arrays, plain objects). Kept local so the boundary stays
 * dependency-free.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) =>
      deepEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      ),
    );
  }

  return false;
}
