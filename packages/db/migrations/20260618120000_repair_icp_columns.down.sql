-- Intentional no-op.
--
-- This is a REPAIR migration: it only re-asserts columns that rightfully belong
-- to 20260604000000 and 20260612120000. Dropping them here would delete live
-- ICP data and re-break clientProfiles.ts. To remove these columns, roll back
-- the original migrations via their own .down.sql files, not this one.
SELECT 1;
