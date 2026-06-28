/**
 * AI-assist boundary — public surface.
 *
 * Stage 1 ships the *contract* and *types* only; no LLM provider is wired. AI is
 * a secondary assist layer over the deterministic evidence core and may never
 * change score, gate, or evidence. See ./boundary for the enforced rules and
 * ./assist-types for the future hook shapes.
 *
 * docs/specs/2026-06-27-stage1-ai-assist-deterministic.md
 */

export {
  AI_CAPABILITIES,
  AI_PROHIBITIONS,
  PROTECTED_LEAD_FIELDS,
  AiBoundaryViolation,
  assertNoOverride,
  isAllowedCapability,
  type AiCapability,
  type AiProhibition,
  type ProtectedLeadField,
} from './boundary';

export type {
  AssistConfidence,
  AssistResult,
  AiAssistProvider,
  ExplanationEnhanceHook,
  ExplanationEnhanceInput,
  ExplanationEnhanceOutput,
  GapEnrichHook,
  GapEnrichInput,
  GapEnrichOutput,
  GapEnrichSuggestion,
  IntentClassifyHook,
  IntentClassifyInput,
  IntentClassifyOutput,
  WeakSignalExtractHook,
  WeakSignalExtractInput,
  WeakSignalExtractOutput,
  WeakSignalCandidate,
  OpenerDraftHook,
  OpenerDraftInput,
  OpenerDraftOutput,
} from './assist-types';

// ─── Career-page enrichment (first concrete enrichment boundary) ─────────────

export {
  emptyEnrichmentResult,
  hasEnrichment,
  type CareerPageEnrichmentInput,
  type CareerPageEnrichmentResult,
  type SourceEvidenceSnapshot,
  type EnrichedHiringSignals,
  type EnrichedRole,
  type EnrichedHiringUrgency,
  type EnrichmentProvider,
} from './enrichment/careerPages';

export {
  isWeakCareerPage,
  repairWeakCareerPage,
  assertEnrichmentDoesNotTouchEvidence,
  WEAK_CAREER_PAGE_QUALITY_THRESHOLD,
  type WeakCareerPageCandidate,
} from './enrichment/repairWeakCareerPage';

export {
  createScrapeGraphProvider,
  isScrapeGraphConfigured,
  CAREER_PAGE_EXTRACTION_INSTRUCTION,
  type ScrapeProvider,
  type ScrapeMarkdownResult,
} from './providers/scrapegraph';
