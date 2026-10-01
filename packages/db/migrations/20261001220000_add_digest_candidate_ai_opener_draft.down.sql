BEGIN;

DROP INDEX IF EXISTS digest_candidates_ai_opener_draft_present_idx;

ALTER TABLE digest_candidates DROP COLUMN IF EXISTS ai_opener_draft;

COMMIT;
