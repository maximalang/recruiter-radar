-- Add country / industry / city to orgs (Block 1: ICP + score inversion fix).
--
-- Why this exists:
--   The FIUR Fit component is one-dimensional (vacancies_count + freshness) because
--   orgs carries no country/industry/city — those facts live only in signal
--   payloads and are never persisted to the org. As a result a foreign company
--   can out-rank a domestic one on score. These columns let Fit use a stable,
--   per-org country/industry/city instead of re-deriving it per signal.
--
-- Nullable + no default: unknown stays NULL so scoring treats it as "unknown"
-- (neither RU bonus nor foreign penalty) — no leads=0 regression on thin data.
--
-- Forward-only and idempotent (ADD COLUMN IF NOT EXISTS). The backfill below is
-- also idempotent: it only writes a column that is still NULL.

BEGIN;

ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS industry TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT;

-- Bare ADD CONSTRAINT is NOT idempotent (throws 42710 on re-run and aborts the
-- transaction), so drop-then-add keeps this migration replay-safe alongside the
-- IF NOT EXISTS columns above.
ALTER TABLE orgs DROP CONSTRAINT IF EXISTS orgs_country_not_blank;
ALTER TABLE orgs ADD CONSTRAINT orgs_country_not_blank
  CHECK (country IS NULL OR BTRIM(country) <> '');
ALTER TABLE orgs DROP CONSTRAINT IF EXISTS orgs_industry_not_blank;
ALTER TABLE orgs ADD CONSTRAINT orgs_industry_not_blank
  CHECK (industry IS NULL OR BTRIM(industry) <> '');
ALTER TABLE orgs DROP CONSTRAINT IF EXISTS orgs_city_not_blank;
ALTER TABLE orgs ADD CONSTRAINT orgs_city_not_blank
  CHECK (city IS NULL OR BTRIM(city) <> '');

-- One-time backfill of orgs.city from the most recent signal location for each
-- org. Signal payloads carry a location under several keys (area_name, city,
-- location_name, location); take the first non-blank, most recent one. Only
-- fills rows where city IS NULL so re-running is a no-op.
WITH latest_location AS (
  SELECT DISTINCT ON (s.org_id)
    s.org_id,
    COALESCE(
      NULLIF(BTRIM(s.payload ->> 'area_name'), ''),
      NULLIF(BTRIM(s.payload ->> 'city'), ''),
      NULLIF(BTRIM(s.payload ->> 'location_name'), ''),
      NULLIF(BTRIM(s.payload ->> 'location'), '')
    ) AS loc
  FROM signals s
  WHERE s.signal_type = 'job_posting'
  ORDER BY s.org_id, s.occurred_at DESC NULLS LAST
)
UPDATE orgs
SET city = latest_location.loc
FROM latest_location
WHERE orgs.id = latest_location.org_id
  AND orgs.city IS NULL
  AND latest_location.loc IS NOT NULL;

-- Backfill orgs.country = 'RU' for any org that already has a domestic footprint:
-- a Cyrillic city, a .ru domain/website, or a domestic source family. This is
-- conservative — it only ever sets 'RU', never 'foreign', so a mistaken RU tag
-- costs at most a small unearned Fit bonus, never a wrong penalty. Rows with no
-- domestic cue stay NULL (unknown).
UPDATE orgs
SET country = 'RU'
WHERE country IS NULL
  AND (
    (city IS NOT NULL AND city ~ '[А-Яа-яЁё]')
    OR (domain IS NOT NULL AND LOWER(domain) LIKE '%.ru')
    -- host ends in .ru (guard against .rutube.com / x.rust.io false positives):
    -- match a .ru host at the end of the host portion, before any path/query.
    OR (website_url IS NOT NULL AND LOWER(website_url) ~ '://[^/]+\.ru(?:[:/?#]|$)')
    OR EXISTS (
      SELECT 1 FROM signals s
      WHERE s.org_id = orgs.id
        AND s.source IN ('hh', 'rabota-rossii', 'superjob', 'habr-career', 'regional-job-boards')
      LIMIT 1
    )
  );

COMMIT;
