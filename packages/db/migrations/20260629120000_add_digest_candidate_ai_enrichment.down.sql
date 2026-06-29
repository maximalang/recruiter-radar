BEGIN;

DROP INDEX IF EXISTS digest_candidates_ai_enrichment_present_idx;

ALTER TABLE digest_candidates DROP COLUMN IF EXISTS ai_enrichment;

COMMIT;
