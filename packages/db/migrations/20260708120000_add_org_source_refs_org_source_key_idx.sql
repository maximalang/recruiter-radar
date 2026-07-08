-- Add a composite index on org_source_refs(org_id, source_key) to speed up
-- the cross-source corroboration CTE in digest-evidence-query.ts
-- (org_corroboration_keys). That CTE runs several correlated subqueries per
-- org of the shape:
--
--   SELECT ('inn:' || ref.source_key) FROM org_source_refs AS ref
--   WHERE ref.org_id = org.id AND ref.source_key LIKE 'inn:%'
--   ORDER BY ref.source_key ASC LIMIT 1
--
-- The existing index org_source_refs_org_source_idx covers (org_id, source),
-- but the corroboration probes filter by source_key (LIKE 'inn:%' / 'ogrn:%' /
-- 'domain:%'), not by source. A composite (org_id, source_key) index turns
-- each probe into a tight index range scan instead of an org_id scan + filter.
--
-- Additive only — CREATE INDEX IF NOT EXISTS; no schema/constraint changes.
-- The down migration drops just this index. Safe to re-run.

BEGIN;

CREATE INDEX IF NOT EXISTS org_source_refs_org_source_key_idx
  ON org_source_refs (org_id, source_key);

COMMIT;
