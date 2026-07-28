BEGIN;

UPDATE opportunities opportunity
SET
  snoozed_until = state.suppressed_until,
  updated_at = NOW()
FROM client_episode_state state
WHERE opportunity.client_profile_id = state.client_profile_id
  AND opportunity.hiring_episode_id = state.hiring_episode_id
  AND opportunity.status = 'snoozed'
  AND (
    opportunity.snoozed_until IS NULL
    OR opportunity.snoozed_until <= NOW()
  )
  AND state.status = 'snoozed'
  AND state.suppressed_until > NOW();

-- A snoozed row without authoritative episode state cannot be expired safely.
-- Return only those legacy-invalid rows to the neutral state; action history stays intact.
UPDATE opportunities
SET
  status = 'new',
  snoozed_until = NULL,
  updated_at = NOW()
WHERE status = 'snoozed'
  AND (
    snoozed_until IS NULL
    OR snoozed_until <= NOW()
  );

ALTER TABLE opportunities
  DROP CONSTRAINT opportunities_snoozed_until_check;

ALTER TABLE opportunities
  ADD CONSTRAINT opportunities_snoozed_until_check
    CHECK (
      (
        (status = 'snoozed' AND snoozed_until IS NOT NULL)
        OR status <> 'snoozed'
      )
      AND (snoozed_until IS NULL OR snoozed_until > created_at)
    );

COMMIT;
