-- Slice B: persist scoring-pipeline orchestrator output (AgencyLead) on
-- digest_candidates so callers can read confidence + next action straight
-- from the row instead of recomputing from payload JSON.
--
-- Adds:
--   * lead_confidence  (enum: high|medium|low)  — NULL for legacy rows
--   * next_action_kind (enum: outreach|enrich-contacts|review|wait)
--   * next_action_hint (free-text, ≤ 500 chars)
--
-- Nullable on purpose: existing rows pre-orchestrator must remain readable.
-- New writes (apps/web/lib/scoring/scoring-pipeline.ts → AgencyLead) will
-- always populate the three columns together.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lead_confidence') THEN
    CREATE TYPE lead_confidence AS ENUM ('high', 'medium', 'low');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lead_action_kind') THEN
    CREATE TYPE lead_action_kind AS ENUM ('outreach', 'enrich-contacts', 'review', 'wait');
  END IF;
END$$;

ALTER TABLE digest_candidates
  ADD COLUMN IF NOT EXISTS lead_confidence  lead_confidence,
  ADD COLUMN IF NOT EXISTS next_action_kind lead_action_kind,
  ADD COLUMN IF NOT EXISTS next_action_hint TEXT;

ALTER TABLE digest_candidates
  DROP CONSTRAINT IF EXISTS digest_candidates_next_action_hint_len_check;
ALTER TABLE digest_candidates
  ADD  CONSTRAINT digest_candidates_next_action_hint_len_check
    CHECK (next_action_hint IS NULL OR char_length(next_action_hint) BETWEEN 1 AND 500);

ALTER TABLE digest_candidates
  DROP CONSTRAINT IF EXISTS digest_candidates_next_action_pair_check;
ALTER TABLE digest_candidates
  ADD  CONSTRAINT digest_candidates_next_action_pair_check
    CHECK (
      (next_action_kind IS NULL AND next_action_hint IS NULL)
      OR
      (next_action_kind IS NOT NULL AND next_action_hint IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS digest_candidates_lead_confidence_idx
  ON digest_candidates (lead_confidence, created_at DESC)
  WHERE lead_confidence IS NOT NULL;

COMMIT;
