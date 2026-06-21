-- Irreversible-by-design: this migration only fills NULL domains derived from
-- website_url, and we cannot distinguish backfilled domains from ones written
-- directly by ingest after the fix. Reverting would risk clearing legitimately
-- ingested domains. No-op down migration.
SELECT 1;
