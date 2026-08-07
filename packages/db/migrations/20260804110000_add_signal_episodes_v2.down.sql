BEGIN;

LOCK TABLE signal_episodes IN ACCESS EXCLUSIVE MODE;
LOCK TABLE signal_episode_state_changes IN ACCESS EXCLUSIVE MODE;
LOCK TABLE signal_episode_events IN ACCESS EXCLUSIVE MODE;
LOCK TABLE signal_episode_evidence IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM signal_episodes) THEN
    RAISE EXCEPTION
      'signal episodes v2 rollback refused: episode data exists';
  END IF;
END;
$$;

DROP TABLE signal_episode_evidence;
DROP TABLE signal_episode_events;
DROP TABLE signal_episode_state_changes;
DROP TABLE signal_episodes;

DROP FUNCTION validate_signal_episode_evidence();
DROP FUNCTION reject_signal_episode_mutation();

COMMIT;
