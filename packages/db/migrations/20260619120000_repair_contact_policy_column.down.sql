-- Intentional no-op.
--
-- This is a REPAIR migration: it only re-asserts the contact_policy type/column
-- that rightfully belong to 20260605140000. Dropping them here would delete live
-- contact-policy data and re-break the daily-radar digest. To remove the column,
-- roll back the original migration via its own .down.sql file, not this one.
SELECT 1;
