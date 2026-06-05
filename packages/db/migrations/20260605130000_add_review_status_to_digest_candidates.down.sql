BEGIN;

DROP INDEX IF EXISTS digest_candidates_pending_review_idx;

ALTER TABLE digest_candidates DROP COLUMN IF EXISTS review_status;

DROP TYPE IF EXISTS review_status;

COMMIT;
