-- Down for the ICP repair migration.
--
-- Intentionally a no-op: this migration only reconciles columns that are owned
-- by 20260604000000 and 20260612120000. Dropping them here would destroy schema
-- those earlier migrations are responsible for and break client_profiles reads.
-- Rolling back the repair therefore changes nothing — the columns stay.

SELECT 1;
