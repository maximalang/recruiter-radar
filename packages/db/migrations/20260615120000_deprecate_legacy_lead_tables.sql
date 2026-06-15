BEGIN;

-- T10: Deprecate legacy lead tables (leads, lead_status, deliveries).
--
-- These tables predate the digest-candidate model. The product now tracks
-- lead state through digest_candidates (+ digest_feedback / digest deliveries
-- via the client_digest pipeline). The legacy tables have NO production
-- readers/writers in apps/web or packages/* (verified via codegraph_callers
-- and a query grep — see docs/legacy-tables-deprecation.md, step 10.3).
--
-- We DO NOT drop them in this migration — only mark them deprecated so the
-- intent is visible at the schema level. Drop is a separate, later migration
-- once a backup/retention window has passed (see deprecation plan).

COMMENT ON TABLE leads IS
  'DEPRECATED (2026-06-15): superseded by digest_candidates. No production queries. Do not add new readers/writers. See docs/legacy-tables-deprecation.md.';

COMMENT ON TABLE lead_status IS
  'DEPRECATED (2026-06-15): legacy lead state-transition log, superseded by digest_candidates.review_status / digest_feedback. No production queries. See docs/legacy-tables-deprecation.md.';

COMMENT ON TABLE deliveries IS
  'DEPRECATED (2026-06-15): legacy Telegram delivery log, superseded by the client_digest delivery pipeline. No production queries. See docs/legacy-tables-deprecation.md.';

COMMIT;
