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
