/**
 * Typed hooks for the FUTURE AI-assist phase. No implementation, no model, no
 * network — these interfaces define the shape a model will plug into later so
 * the seam is designed before any provider is chosen.
 *
 * Product direction (per session 2026-06-27): the next real AI phase targets
 * **lead quality & quantity** — better signal interpretation, filling structured
 * data gaps, recovering good leads from weak evidence, and supporting ranking —
 * NOT recruiter message copywriting. The hooks below reflect that ordering: the
 * quality-improving hooks are primary; opener drafting is deliberately last and
 * minimal.
 *
 * Every hook is:
 *   - READ-ONLY over the deterministic core (score / gate / evidence).
 *   - OPTIONAL — callers must degrade to deterministic output when unavailable.
 *   - ATTRIBUTED — its output is labelled as AI, never mixed into evidence.
 *
 * See boundary.ts for the enforced contract (AI_CAPABILITIES / AI_PROHIBITIONS).
 */

import type { AiCapability } from './boundary';

// ─── Shared envelope ─────────────────────────────────────────────────────────

/**
 * Confidence the assist layer has in its OWN output. This is the AI's
 * self-assessment of its suggestion — it is NOT, and must never be fed into, the
 * product's confidence gate (which is a deterministic evidence contract).
 */
export type AssistConfidence = 'low' | 'medium' | 'high';

/**
 * Uniform result envelope for every assist hook. `provider: 'deterministic'`
 * marks output produced without a model (the Stage 1 default); a real model sets
 * its own identifier later. `available: false` is the graceful-degradation
 * signal — the UI shows the deterministic baseline instead.
 */
export interface AssistResult<T> {
  available: boolean;
  capability: AiCapability;
  provider: 'deterministic' | (string & {});
  confidence: AssistConfidence;
  /** The payload; null when `available` is false. */
  data: T | null;
  /** Optional human-readable note (e.g. why unavailable). */
  note?: string;
}

// ─── Hook 1 (primary): lead-explanation enhancement ──────────────────────────

/**
 * Improve the WORDING of an already-built deterministic explanation. Input is
 * the structured facts; output is nicer prose over the SAME facts — it may not
 * add a reason that has no basis. This is the lightest hook and the only one
 * that touches user-facing text directly.
 */
export interface ExplanationEnhanceInput {
  /** Deterministic fit lines already computed, each with its basis tag. */
  factLines: ReadonlyArray<{ text: string; basis: string }>;
  agencySpecialization: string | null;
}

export interface ExplanationEnhanceOutput {
  /** Reworded prose strictly derived from `factLines`; no new claims. */
  prose: string;
}

export type ExplanationEnhanceHook = (
  input: ExplanationEnhanceInput,
) => Promise<AssistResult<ExplanationEnhanceOutput>>;

// ─── Hook 2 (primary): structured-data gap enrichment ────────────────────────

/**
 * Identify and (later) help fill STRUCTURED gaps that block lead quality:
 * missing domain → no career-page crawl → capped Reachability; missing industry
 * → weaker Fit. The hook proposes candidate values WITH provenance for human /
 * deterministic verification — it never writes them into the org record or the
 * score directly.
 */
export interface GapEnrichInput {
  orgName: string;
  knownDomain: string | null;
  knownIndustry: string | null;
  knownInn: string | null;
}

export interface GapEnrichSuggestion {
  field: 'domain' | 'industry' | 'careerPageUrl';
  value: string;
  /** Where the suggestion came from — required so a human can verify it. */
  provenance: string;
}

export interface GapEnrichOutput {
  suggestions: GapEnrichSuggestion[];
}

export type GapEnrichHook = (
  input: GapEnrichInput,
) => Promise<AssistResult<GapEnrichOutput>>;

// ─── Hook 3 (primary): hiring-intent classification support ──────────────────

/**
 * Suggest a hiring-intent label as a HINT for the human and as a potential
 * future *input candidate* to the deterministic scorer — never as a direct
 * score/gate mutation. Output is advisory; the deterministic FIUR pipeline
 * remains the only thing that sets Intent.
 */
export interface IntentClassifyInput {
  roleNames: ReadonlyArray<string>;
  vacanciesCount: number;
  distinctVacancyNamesCount: number;
}

export interface IntentClassifyOutput {
  /** e.g. 'expansion', 'backfill', 'internal-recruiter-only', 'burst'. */
  label: string;
  rationale: string;
}

export type IntentClassifyHook = (
  input: IntentClassifyInput,
) => Promise<AssistResult<IntentClassifyOutput>>;

// ─── Hook 4 (primary): weak-signal extraction support ────────────────────────

/**
 * Recover potentially-good leads from weak / unstructured evidence by surfacing
 * candidate signals for review. This is how AI helps *lead quantity* without
 * lowering the bar: candidates go to the human / deterministic gate, they do not
 * auto-promote a lead.
 */
export interface WeakSignalExtractInput {
  /** Free-text fragments (e.g. a sparse posting) with their source family. */
  fragments: ReadonlyArray<{ text: string; sourceFamily: string }>;
}

export interface WeakSignalCandidate {
  signal: string;
  sourceFamily: string;
  /** AI self-confidence; routed to review, never straight to a gate. */
  confidence: AssistConfidence;
}

export interface WeakSignalExtractOutput {
  candidates: WeakSignalCandidate[];
}

export type WeakSignalExtractHook = (
  input: WeakSignalExtractInput,
) => Promise<AssistResult<WeakSignalExtractOutput>>;

// ─── Hook 5 (last, minimal): outreach opener draft ───────────────────────────

/**
 * Draft an editable opener. Deliberately LAST and minimal — copywriting is not
 * the priority of the AI roadmap. Openers are no longer surfaced to the user
 * (outreach was removed; the digest is an executive brief, not a send tool);
 * this hook only exists so a model could later propose an alternative the user
 * edits and confirms if outreach is ever reintroduced. Must respect
 * contactPolicy and never auto-send.
 */
export interface OpenerDraftInput {
  orgName: string;
  reasons: ReadonlyArray<string>;
  roleNames: ReadonlyArray<string>;
  contactPolicy: 'corporate_only' | 'no_personal' | 'unrestricted';
}

export interface OpenerDraftOutput {
  /** Editable draft; the UI must present it as a suggestion, not a send. */
  draft: string;
}

export type OpenerDraftHook = (
  input: OpenerDraftInput,
) => Promise<AssistResult<OpenerDraftOutput>>;

// ─── Registry ────────────────────────────────────────────────────────────────

/**
 * The future assist surface. A provider implements the hooks it supports;
 * unimplemented hooks stay undefined and callers degrade. Ordering documents
 * priority: quality/quantity hooks first, opener draft last.
 */
export interface AiAssistProvider {
  readonly name: string;
  enhanceExplanation?: ExplanationEnhanceHook;
  enrichGaps?: GapEnrichHook;
  classifyIntent?: IntentClassifyHook;
  extractWeakSignals?: WeakSignalExtractHook;
  draftOpener?: OpenerDraftHook;
}
