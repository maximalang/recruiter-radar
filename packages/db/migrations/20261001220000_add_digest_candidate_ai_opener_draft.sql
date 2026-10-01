BEGIN;

-- D3 AI opener draft: persist the editable, attributed AI draft of the first
-- outreach message on a lead (owner directive 2026-10-01).
--
-- Adds digest_candidates.ai_opener_draft (JSONB, nullable, default NULL). Like
-- ai_enrichment, this is a SEPARATE, attributed AI layer that sits ALONGSIDE —
-- never inside — the deterministic columns (total_score, confidence_gate,
-- reasons, evidence_titles, opener). It is written only after an explicit
-- user-triggered generation and read back purely as an editable draft for the
-- lead detail page. Nothing here ever feeds the score or the confidence gate,
-- and NOTHING is ever sent automatically: the flow is generate → edit →
-- human confirm → manual clipboard copy (boundary.ts `auto-send` prohibition).
--
-- Shape (see lib/ai/opener/openerDraftStore.ts StoredOpenerDraft):
--   {
--     "schemaVersion": 1,
--     "draft": "<original AI text>",
--     "currentText": "<text with operator edits applied>",
--     "status": "draft" | "confirmed",
--     "provider": "codexoid" | "openai" | ...,
--     "model": "<model name>",
--     "promptVersion": "opener-draft-v1",
--     "traceId": "<uuid>",
--     "generatedAt": "<ISO-8601>",
--     "editedAt": "<ISO-8601>" | null,
--     "confirmedAt": "<ISO-8601>" | null
--   }
--
-- Nullable on purpose: every existing row and every lead nobody generated a
-- draft for stays NULL and renders exactly as before.

ALTER TABLE digest_candidates
  ADD COLUMN IF NOT EXISTS ai_opener_draft JSONB;

COMMENT ON COLUMN digest_candidates.ai_opener_draft IS
  'D3 AI opener draft (attributed, advisory, manual-send-only). StoredOpenerDraft v1: original AI text + operator-edited currentText + draft/confirmed status + provenance (provider, model, promptVersion, traceId). NULL = no draft. NEVER affects total_score / confidence_gate / reasons / evidence_titles / opener; nothing is ever sent automatically.';

-- Partial index for the "has draft" read path (lead detail UI), kept small by
-- excluding the common NULL rows.
CREATE INDEX IF NOT EXISTS digest_candidates_ai_opener_draft_present_idx
  ON digest_candidates (client_profile_id, created_at DESC)
  WHERE ai_opener_draft IS NOT NULL;

COMMIT;
