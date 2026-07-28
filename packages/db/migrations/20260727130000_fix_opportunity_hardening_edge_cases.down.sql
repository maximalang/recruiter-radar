BEGIN;

ALTER TABLE opportunities
  DROP CONSTRAINT IF EXISTS opportunities_snoozed_until_check;

ALTER TABLE opportunities
  ADD CONSTRAINT opportunities_snoozed_until_check
    CHECK (snoozed_until IS NULL OR snoozed_until > created_at);

COMMIT;
