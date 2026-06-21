-- Backfill orgs.domain from orgs.website_url where domain was never populated.
--
-- Why this exists:
--   HH ingest historically wrote only orgs.website_url and never orgs.domain
--   (see ingest-hh.mjs upsertOrgSourceRef before 2026-06-20). Every org sourced
--   from HH therefore has domain IS NULL even when a corporate website is known,
--   forcing downstream readers to re-derive the domain from website_url on every
--   read (multi-source-lead-generator.ts fallback). The ingest path is now fixed
--   to populate domain at write time; this migration repairs the rows already
--   accumulated under the old behaviour.
--
-- Derivation matches lib/adapter-base.mjs extractDomain():
--   strip scheme + leading "www.", take the host up to the first "/", lowercase.
--
-- Unique-index safety (orgs has a UNIQUE index on LOWER(domain) WHERE domain IS
-- NOT NULL): a blind UPDATE could collide two NULL-domain rows that derive the
-- same domain, or collide with a row that already owns it. We therefore assign a
-- derived domain ONLY when it is unambiguous:
--   1. not already owned by any existing (non-NULL domain) org, AND
--   2. derived by exactly one candidate row in this backfill set.
-- Rows that don't qualify stay NULL — ingest will keep website_url as the read
-- fallback, exactly as today. Forward-only and idempotent (re-running is a no-op
-- because qualifying rows no longer have domain IS NULL).

BEGIN;

WITH candidates AS (
  SELECT
    id,
    LOWER(
      regexp_replace(
        regexp_replace(BTRIM(website_url), '^[a-z][a-z0-9+.-]*://(www\.)?', '', 'i'),
        '[/?#].*$', ''
      )
    ) AS derived_domain
  FROM orgs
  WHERE domain IS NULL
    AND website_url IS NOT NULL
    AND BTRIM(website_url) <> ''
),
valid AS (
  SELECT id, derived_domain
  FROM candidates
  WHERE derived_domain <> ''
    -- not already owned by an org that has a domain
    AND NOT EXISTS (
      SELECT 1 FROM orgs taken
      WHERE taken.domain IS NOT NULL
        AND LOWER(taken.domain) = derived_domain
    )
    -- derived by exactly one candidate row (avoid intra-batch collision)
    AND derived_domain IN (
      SELECT derived_domain FROM candidates
      WHERE derived_domain <> ''
      GROUP BY derived_domain
      HAVING COUNT(*) = 1
    )
)
UPDATE orgs
SET domain = valid.derived_domain
FROM valid
WHERE orgs.id = valid.id;

COMMIT;
