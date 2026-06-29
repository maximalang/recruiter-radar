BEGIN;

-- Stage-2 AI enrichment: persist recovered hiring signals for weak career pages.
--
-- Adds digest_candidates.ai_enrichment (JSONB, nullable, default NULL). This is a
-- SEPARATE, attributed AI layer that sits ALONGSIDE — never inside — the
-- deterministic columns (total_score, confidence_gate, reasons, evidence_titles).
-- It is written only after a successful enrichment for a WEAK page and is read
-- back purely as an advisory hint for the UI. Nothing here ever feeds the score
-- or the confidence gate.
--
-- Shape (see lib/ai/enrichment/careerPages.ts EnrichedHiringSignals + envelope):
--   {
--     "schemaVersion": 1,
--     "provider": "scrapegraph" | "crawl4ai" | ...,
--     "confidence": "low" | "medium" | "high",
--     "detectedRoles": [{ "title", "department", "confidence" }],
--     "hiringUrgency": "low" | "medium" | "high" | "unknown",
--     "departments": ["..."],
--     "locations": ["..."],
--     "hiringPatternSummary": "...",
--     "sourceUrl": "https://...",
--     "enrichedAt": "<ISO-8601>"
--   }
--
-- Nullable on purpose: every existing row and every lead whose page was strong
-- (or whose org has no provider/quota) stays NULL and renders the deterministic
-- baseline only.

ALTER TABLE digest_candidates
  ADD COLUMN IF NOT EXISTS ai_enrichment JSONB;

COMMENT ON COLUMN digest_candidates.ai_enrichment IS
  'Stage-2 AI enrichment (attributed, advisory). EnrichedHiringSignals + provenance for WEAK career pages. NULL = no enrichment; renders deterministic baseline. NEVER affects total_score / confidence_gate / reasons / evidence_titles.';

-- Partial index for the "has enrichment" read path (UI badge / filter), kept
-- small by excluding the common NULL rows.
CREATE INDEX IF NOT EXISTS digest_candidates_ai_enrichment_present_idx
  ON digest_candidates (client_profile_id, created_at DESC)
  WHERE ai_enrichment IS NOT NULL;

COMMIT;
