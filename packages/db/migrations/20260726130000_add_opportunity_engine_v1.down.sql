BEGIN;

DROP INDEX IF EXISTS digest_candidates_client_profile_org_created_idx;

DROP TABLE IF EXISTS opportunity_build_failures;
DROP TABLE IF EXISTS opportunity_actions;
DROP TABLE IF EXISTS opportunities;
DROP TABLE IF EXISTS hiring_episode_detection_state;
DROP TABLE IF EXISTS hiring_episode_evidence;
DROP TABLE IF EXISTS hiring_episodes;

DROP INDEX IF EXISTS client_profiles_id_owner_uidx;
DROP INDEX IF EXISTS evidence_items_id_org_uidx;
DROP INDEX IF EXISTS signals_id_org_uidx;

COMMIT;
