-- Rollback for 20260528120000_add_digest_candidate_confidence_and_next_action.sql
--
-- Drops the added columns, constraints, index, and enum types. Safe to run
-- against a database that never received the up migration (every step uses
-- IF EXISTS). Order matters: drop columns before dropping the enum types
-- they depend on.

BEGIN;

DROP INDEX IF EXISTS digest_candidates_lead_confidence_idx;

ALTER TABLE digest_candidates
  DROP CONSTRAINT IF EXISTS digest_candidates_next_action_pair_check,
  DROP CONSTRAINT IF EXISTS digest_candidates_next_action_hint_len_check;

ALTER TABLE digest_candidates
  DROP COLUMN IF EXISTS next_action_hint,
  DROP COLUMN IF EXISTS next_action_kind,
  DROP COLUMN IF EXISTS lead_confidence;

DROP TYPE IF EXISTS lead_action_kind;
DROP TYPE IF EXISTS lead_confidence;

COMMIT;
