-- Cross-fragment suppression for digest feedback ("Скрыть").
-- The canonical ER-key view is shared by digest assembly and suppression so the
-- two paths cannot drift on INN/OGRN/domain precedence or platform exclusions.
BEGIN;

CREATE OR REPLACE VIEW org_corroboration_keys_v1 AS
WITH platform_host_domains AS (
  SELECT unnest(ARRAY[
    'hh.ru', 'hhcdn.com', 'trudvsem.ru', 'superjob.ru', 'superjob.com',
    'career.habr.com', 'habr.com', 'boards.greenhouse.io', 'greenhouse.io',
    'jobs.lever.co', 'lever.co', 'api.lever.co', 'boards-api.greenhouse.io',
    'linkedin.com', 'hh.kz', 'hh.ua', 'rabota.ru', 'zarplata.ru'
  ]) AS host_domain
)
SELECT
  org.id AS org_id,
  COALESCE(
    (SELECT 'inn:' || LOWER(REPLACE(ref.source_key, 'inn:', ''))
     FROM org_source_refs AS ref
     WHERE ref.org_id = org.id AND ref.source_key LIKE 'inn:%'
     ORDER BY ref.source_key ASC
     LIMIT 1),
    (SELECT 'ogrn:' || LOWER(REPLACE(ref.source_key, 'ogrn:', ''))
     FROM org_source_refs AS ref
     WHERE ref.org_id = org.id AND ref.source_key LIKE 'ogrn:%'
     ORDER BY ref.source_key ASC
     LIMIT 1),
    (SELECT 'domain:' || LOWER(REPLACE(ref.source_key, 'domain:', ''))
     FROM org_source_refs AS ref
     WHERE ref.org_id = org.id
       AND ref.source_key LIKE 'domain:%'
       AND LOWER(REPLACE(ref.source_key, 'domain:', '')) NOT IN (
         SELECT host_domain FROM platform_host_domains
       )
     ORDER BY ref.source_key ASC
     LIMIT 1),
    CASE
      WHEN NULLIF(BTRIM(org.domain), '') IS NOT NULL
        AND LOWER(BTRIM(org.domain)) NOT IN (
          SELECT host_domain FROM platform_host_domains
        )
      THEN 'domain:' || LOWER(BTRIM(org.domain))
      ELSE NULL
    END,
    'org:' || org.id::TEXT
  ) AS corroboration_key,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM org_source_refs AS ref
      WHERE ref.org_id = org.id AND ref.source_key LIKE 'inn:%'
    ) THEN 'inn'
    WHEN EXISTS (
      SELECT 1 FROM org_source_refs AS ref
      WHERE ref.org_id = org.id AND ref.source_key LIKE 'ogrn:%'
    ) THEN 'ogrn'
    WHEN EXISTS (
      SELECT 1 FROM org_source_refs AS ref
      WHERE ref.org_id = org.id
        AND ref.source_key LIKE 'domain:%'
        AND LOWER(REPLACE(ref.source_key, 'domain:', '')) NOT IN (
          SELECT host_domain FROM platform_host_domains
        )
    ) THEN 'domain'
    WHEN NULLIF(BTRIM(org.domain), '') IS NOT NULL
      AND LOWER(BTRIM(org.domain)) NOT IN (
        SELECT host_domain FROM platform_host_domains
      ) THEN 'domain'
    ELSE 'org_id'
  END AS corroboration_key_type
FROM orgs AS org;

CREATE TABLE IF NOT EXISTS client_org_suppressions (
  id BIGSERIAL PRIMARY KEY,
  client_profile_id BIGINT NOT NULL,
  org_id BIGINT NOT NULL,
  suppression_key TEXT NOT NULL,
  suppressed_org_ids BIGINT[] NOT NULL,
  reason digest_feedback_status NOT NULL DEFAULT 'dismissed',
  source_digest_candidate_id BIGINT,
  source_feedback_at TIMESTAMPTZ NOT NULL,
  suppressed_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_org_suppressions_key_not_blank
    CHECK (BTRIM(suppression_key) <> ''),
  CONSTRAINT client_org_suppressions_reason_dismissed
    CHECK (reason = 'dismissed'),
  CONSTRAINT client_org_suppressions_org_ids_nonempty
    CHECK (cardinality(suppressed_org_ids) > 0),
  CONSTRAINT client_org_suppressions_org_ids_positive
    CHECK (0 < ALL(suppressed_org_ids)),
  CONSTRAINT client_org_suppressions_candidate_positive
    CHECK (source_digest_candidate_id IS NULL OR source_digest_candidate_id > 0),
  CONSTRAINT client_org_suppressions_suppressed_until_positive
    CHECK (suppressed_until > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS client_org_suppressions_profile_key_uidx
  ON client_org_suppressions (client_profile_id, suppression_key);

CREATE INDEX IF NOT EXISTS client_org_suppressions_profile_until_idx
  ON client_org_suppressions (client_profile_id, suppressed_until);

CREATE INDEX IF NOT EXISTS client_org_suppressions_until_idx
  ON client_org_suppressions (suppressed_until);

COMMIT;
