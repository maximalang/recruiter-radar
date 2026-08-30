BEGIN;
DROP TABLE IF EXISTS source_refresh_evidence_alerts;
DROP TABLE IF EXISTS source_refresh_evidence_log_archive;
DROP TABLE IF EXISTS source_refresh_evidence_snapshots;
DROP FUNCTION IF EXISTS source_refresh_evidence_log_archive_append_only();
DROP FUNCTION IF EXISTS source_refresh_evidence_snapshot_append_only();
COMMIT;
