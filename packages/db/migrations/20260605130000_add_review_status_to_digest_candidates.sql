-- Add review_status to digest_candidates for human-in-the-loop review queue.
-- Per product concept §Review queue: pending/approved/rejected states.

BEGIN;

CREATE TYPE review_status AS ENUM ('auto_approved', 'pending_review', 'approved', 'rejected');

ALTER TABLE digest_candidates
  ADD COLUMN IF NOT EXISTS review_status review_status NOT NULL DEFAULT 'auto_approved';

-- Index for fast review queue lookup
CREATE INDEX IF NOT EXISTS digest_candidates_pending_review_idx
  ON digest_candidates (client_profile_id, created_at DESC)
  WHERE review_status = 'pending_review';

COMMENT ON TYPE review_status IS 'Human review status: auto_approved = passed all review rules, pending_review = needs analyst check, approved/rejected = analyst decision';

COMMIT;
