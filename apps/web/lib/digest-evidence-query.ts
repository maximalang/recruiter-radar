// AUTO-MIRRORED from packages/db/scripts/source-digest-evidence.sql.
// Inlined so Next.js bundles it (the standalone tracer cannot follow a dynamic
// readFileSync path, and import.meta.url is unsafe in the bundled runtime).
// String.raw preserves SQL regex escapes (s+) verbatim. Drift is guarded by
// digest-evidence-query.test.ts. Edit the .sql file, then re-run scripts/sync-digest-evidence-query.mjs.

export const DIGEST_EVIDENCE_QUERY = String.raw`WITH source_signal_rows AS (
  SELECT
    signal.org_id,
    signal.source,
    signal.headline AS evidence_title,
    signal.occurred_at AS published_at,
    COALESCE(
      NULLIF(signal.payload ->> 'source_entity_external_id', ''),
      NULLIF(signal.payload ->> 'org_external_id', ''),
      NULLIF(signal.payload ->> 'company_id', ''),
      NULLIF(signal.payload ->> 'employer_id', ''),
      NULLIF(signal.payload ->> 'hh_employer_id', '')
    ) AS payload_external_id,
    COALESCE(
      NULLIF(BTRIM(signal.payload ->> 'source_entity_display_name'), ''),
      NULLIF(BTRIM(signal.payload ->> 'source_entity_name'), ''),
      NULLIF(BTRIM(signal.payload ->> 'company_name'), ''),
      NULLIF(BTRIM(signal.payload ->> 'employer_name'), '')
    ) AS payload_display_name,
    COALESCE(
      NULLIF(BTRIM(signal.payload ->> 'area_name'), ''),
      NULLIF(BTRIM(signal.payload ->> 'city'), ''),
      NULLIF(BTRIM(signal.payload ->> 'location_name'), ''),
      NULLIF(BTRIM(signal.payload ->> 'location'), '')
    ) AS location_name,
    ARRAY(
      SELECT DISTINCT source_key
      FROM UNNEST(
        ARRAY[
          NULLIF(signal.payload ->> 'source_entity_key', ''),
          NULLIF(signal.payload ->> 'org_source_key', ''),
          NULLIF(signal.payload ->> 'company_domain', ''),
          CASE
            WHEN NULLIF(signal.payload ->> 'company_domain', '') IS NOT NULL THEN
              'domain:' || LOWER(NULLIF(signal.payload ->> 'company_domain', ''))
            ELSE NULL
          END,
          CASE
            WHEN COALESCE(
              NULLIF(signal.payload ->> 'source_entity_external_id', ''),
              NULLIF(signal.payload ->> 'org_external_id', ''),
              NULLIF(signal.payload ->> 'company_id', ''),
              NULLIF(signal.payload ->> 'employer_id', ''),
              NULLIF(signal.payload ->> 'hh_employer_id', '')
            ) IS NOT NULL THEN
              'org:' || COALESCE(
                NULLIF(signal.payload ->> 'source_entity_external_id', ''),
                NULLIF(signal.payload ->> 'org_external_id', ''),
                NULLIF(signal.payload ->> 'company_id', ''),
                NULLIF(signal.payload ->> 'employer_id', ''),
                NULLIF(signal.payload ->> 'hh_employer_id', '')
              )
            ELSE NULL
          END,
          CASE
            WHEN COALESCE(
              NULLIF(BTRIM(signal.payload ->> 'source_entity_display_name'), ''),
              NULLIF(BTRIM(signal.payload ->> 'source_entity_name'), ''),
              NULLIF(BTRIM(signal.payload ->> 'company_name'), ''),
              NULLIF(BTRIM(signal.payload ->> 'employer_name'), '')
            ) IS NOT NULL THEN
              'company-name:' || LOWER(REGEXP_REPLACE(
                COALESCE(
                  NULLIF(BTRIM(signal.payload ->> 'source_entity_display_name'), ''),
                  NULLIF(BTRIM(signal.payload ->> 'source_entity_name'), ''),
                  NULLIF(BTRIM(signal.payload ->> 'company_name'), ''),
                  NULLIF(BTRIM(signal.payload ->> 'employer_name'), '')
                ),
                '\s+',
                ' ',
                'g'
              ))
            ELSE NULL
          END
        ] || COALESCE(
          ARRAY(
            SELECT NULLIF(BTRIM(alias_key), '')
            FROM jsonb_array_elements_text(COALESCE(signal.payload -> 'source_entity_alias_keys', '[]'::jsonb)) AS alias_key
          ),
          ARRAY[]::text[]
        )
      ) AS source_key
      WHERE source_key IS NOT NULL
    ) AS payload_source_keys,
    NULLIF(signal.payload ->> 'employer_id', '') AS payload_employer_id,
    NULLIF(signal.payload ->> 'hh_employer_id', '') AS payload_hh_employer_id
  FROM signals AS signal
  WHERE signal.signal_type = 'job_posting'
    AND signal.source IN ('hh', 'career-pages', 'rabota-rossii', 'superjob', 'habr-career', 'tech-job-boards', 'linkedin-company-pages', 'regional-job-boards')
),
-- org_corroboration_keys: map each org_id to a canonical cross-source
-- corroboration key derived from the STRONGEST shared strong key. This lets
-- signals from fragmented orgs (same employer, different org_id per source
-- because per-source resolution scopes WHERE source=$1) corroborate into one
-- evidence package at digest-assembly time — WITHOUT touching the hot upsert
-- path (the deferred canonical-org merge EPIC). Read-side only, reversible.
--
-- Key precedence (strongest first): inn: > ogrn: > domain:
--   - inn:/ogrn: are legally unique → a perfect merge signal.
--   - domain: is unique to one employer's corporate surface, but a PLATFORM
--     host domain (hh.ru, trudvsem.ru, superjob.ru, career.habr.com,
--     greenhouse.io, lever.co) must NEVER be used — 'domain:hh.ru' would
--     falsely merge every HH employer. Platform domains are excluded below.
--   - company-name:/employer-name:/employer: are EXCLUDED — RU company names
--     drift (ООО/АО/ПАО suffixes, transliteration, short vs full) → false
--     merges. Corroboration is earned by a strong key, not by name similarity.
--
-- An org with NO strong key (only company-name:) falls back to its own org_id
-- as the corroboration_key → today's behavior, no forced merge, no regression.
--
-- PLATFORM_HOST_DOMAINS: domains that are job-board/ATS hosts, NOT employer
-- corporate surfaces. A corroboration_key must never be 'domain:<these>' or
-- the platform's many employers would falsely merge into one lead. Kept in
-- sync with the foreign-employer + source-priority policy lists.
org_corroboration_keys AS (
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
      -- Strongest: INN (10-digit legal entity). Globally namespaced across sources.
      (SELECT ('inn:' || ref.source_key)
       FROM org_source_refs AS ref
       WHERE ref.org_id = org.id
         AND ref.source_key LIKE 'inn:%'
       ORDER BY ref.source_key ASC
       LIMIT 1),
      -- OGRN (13-digit). Same namespace across sources.
      (SELECT ('ogrn:' || ref.source_key)
       FROM org_source_refs AS ref
       WHERE ref.org_id = org.id
         AND ref.source_key LIKE 'ogrn:%'
       ORDER BY ref.source_key ASC
       LIMIT 1),
      -- domain: from org_source_refs (career-pages/rabota-rossii store it).
      -- Excludes platform hosts — a domain key that would falsely merge
      -- platform-aggregated employers is rejected.
      (SELECT ('domain:' || LOWER(REPLACE(ref.source_key, 'domain:', '')))
       FROM org_source_refs AS ref
       WHERE ref.org_id = org.id
         AND ref.source_key LIKE 'domain:%'
         AND LOWER(REPLACE(ref.source_key, 'domain:', '')) NOT IN (SELECT host_domain FROM platform_host_domains)
       ORDER BY ref.source_key ASC
       LIMIT 1),
      -- orgs.domain column (HH stores its corporate domain here, not as a
      -- source_key). Same platform-host exclusion. This is the bridge that
      -- lets an HH employer corroborate with a career-pages org on the same
      -- corporate domain even though HH never wrote a domain: source_key.
      CASE
        WHEN NULLIF(BTRIM(org.domain), '') IS NOT NULL
          AND LOWER(BTRIM(org.domain)) NOT IN (SELECT host_domain FROM platform_host_domains)
        THEN 'domain:' || LOWER(BTRIM(org.domain))
        ELSE NULL
      END,
      -- Fallback: no strong key → group by org_id (today's behavior).
      ('org:' || org.id::TEXT)
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
          AND LOWER(REPLACE(ref.source_key, 'domain:', '')) NOT IN (SELECT host_domain FROM platform_host_domains)
      ) THEN 'domain'
      WHEN NULLIF(BTRIM(org.domain), '') IS NOT NULL
        AND LOWER(BTRIM(org.domain)) NOT IN (SELECT host_domain FROM platform_host_domains) THEN 'domain'
      ELSE 'org_id'
    END AS corroboration_key_type
  FROM orgs AS org
  WHERE org.id IN (SELECT DISTINCT org_id FROM source_signal_rows)
),
normalized_signal_rows AS (
  SELECT
    signal.org_id,
    corb.corroboration_key,
    corb.corroboration_key_type,
    signal.source,
    signal.payload_source_keys,
    COALESCE(
      NULLIF(source_ref.external_id, ''),
      signal.payload_external_id
    ) AS source_external_id,
    COALESCE(
      NULLIF(source_ref.display_name, ''),
      signal.payload_display_name,
      org.name
    ) AS source_display_name,
    signal.evidence_title,
    signal.location_name,
    signal.published_at,
    -- evidence_quality: classifies how close this signal is to a company-controlled hiring surface.
    --
    -- direct_hiring_proof  — a COMPANY-OWNED hiring surface, i.e. career-pages. This is the only
    --                        signal class that proves the company itself is publishing the role on
    --                        its own surface. An external ID match (INN, company_id, employer_id,
    --                        registry org id) only proves entity identity on a third-party platform
    --                        or registry — it is NOT a company-owned surface and does NOT grant
    --                        direct proof. rabota-rossii (trudvsem) is a federal registry: an
    --                        INN-based org_external_id verifies the entity but carries no corporate
    --                        surface, so it is platform_aggregation (gate C until corroborated),
    --                        NOT direct_hiring_proof.
    -- platform_aggregation  — signal from a platform or registry (HH, superjob, rabota-rossii, etc.)
    --                        with a company match in org_source_refs, but no company-owned surface.
    -- enrichment_context    — no match found; signal provides background context only.
    CASE
      WHEN signal.source = 'career-pages'
        THEN 'direct_hiring_proof'
      WHEN source_ref.matched_by IS NOT NULL
        THEN 'platform_aggregation'
      ELSE 'enrichment_context'
    END AS evidence_quality
  FROM source_signal_rows AS signal
  JOIN orgs AS org
    ON org.id = signal.org_id
  JOIN org_corroboration_keys AS corb
    ON corb.org_id = signal.org_id
  LEFT JOIN LATERAL (
    SELECT
      external_id,
      display_name,
      CASE
        WHEN signal.payload_external_id IS NOT NULL
          AND external_id = signal.payload_external_id THEN 'external_id'
        WHEN COALESCE(array_length(signal.payload_source_keys, 1), 0) > 0
          AND EXISTS (
            SELECT 1
            FROM unnest(signal.payload_source_keys) AS payload_source_key
            WHERE metadata ->> 'source_alias_key' = payload_source_key
              OR EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(COALESCE(metadata -> 'source_alias_keys', '[]'::jsonb)) AS alias_key
                WHERE alias_key = payload_source_key
              )
          )
          AND NULLIF(external_id, '') IS NOT NULL THEN 'source_alias_key'
        WHEN COALESCE(array_length(signal.payload_source_keys, 1), 0) > 0
          AND source_key = ANY(signal.payload_source_keys) THEN 'source_key'
        WHEN NULLIF(external_id, '') IS NOT NULL THEN 'fallback_external_id'
        ELSE NULL
      END AS matched_by
    FROM org_source_refs
    WHERE org_id = signal.org_id
      AND source = signal.source
    ORDER BY
      CASE
        WHEN signal.payload_external_id IS NOT NULL
          AND external_id = signal.payload_external_id THEN 0
        WHEN COALESCE(array_length(signal.payload_source_keys, 1), 0) > 0
          AND EXISTS (
            SELECT 1
            FROM unnest(signal.payload_source_keys) AS payload_source_key
            WHERE metadata ->> 'source_alias_key' = payload_source_key
              OR EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(COALESCE(metadata -> 'source_alias_keys', '[]'::jsonb)) AS alias_key
                WHERE alias_key = payload_source_key
              )
          )
          AND NULLIF(external_id, '') IS NOT NULL THEN 1
        WHEN COALESCE(array_length(signal.payload_source_keys, 1), 0) > 0
          AND source_key = ANY(signal.payload_source_keys) THEN 2
        WHEN NULLIF(external_id, '') IS NOT NULL THEN 3
        ELSE 4
      END,
      id ASC
    LIMIT 1
  ) AS source_ref
    ON TRUE
),
aggregated AS (
  SELECT
    -- Representative org_id: the fragment with the strongest evidence wins, so
    -- downstream readers (career_page_url join, lead card) attach to the
    -- canonical surface. corroboration_key is the grouping identity; org_id is
    -- the representative surface, kept for the orgs join downstream.
    (ARRAY_AGG(org_id ORDER BY
      CASE evidence_quality
        WHEN 'direct_hiring_proof' THEN 2
        WHEN 'platform_aggregation' THEN 1
        ELSE 0
      END DESC,
      (source = 'career-pages') DESC,
      published_at DESC NULLS LAST,
      org_id ASC
    ))[1] AS org_id,
    corroboration_key,
    corroboration_key_type,
    -- The full set of org_ids that merged under this corroboration_key. When
    -- > 1, this lead is a cross-source merge of fragmented orgs — auditable,
    -- never silent. Drives the "подтверждено N источниками" surface and the
    -- fragmentation-overlap analytics.
    ARRAY_AGG(DISTINCT org_id ORDER BY org_id) AS corroborated_org_ids,
    (
      ARRAY_AGG(source_external_id ORDER BY
        CASE evidence_quality
          WHEN 'direct_hiring_proof' THEN 2
          WHEN 'platform_aggregation' THEN 1
          ELSE 0
        END DESC,
        (source = 'career-pages') DESC,
        published_at DESC NULLS LAST,
        source_external_id ASC NULLS LAST
      ) FILTER (WHERE source_external_id IS NOT NULL)
    )[1] AS source_external_id,
    (
      ARRAY_AGG(source_display_name ORDER BY
        CASE evidence_quality
          WHEN 'direct_hiring_proof' THEN 2
          WHEN 'platform_aggregation' THEN 1
          ELSE 0
        END DESC,
        (source = 'career-pages') DESC,
        published_at DESC NULLS LAST,
        source_display_name ASC NULLS LAST
      ) FILTER (WHERE source_display_name IS NOT NULL)
    )[1] AS source_display_name,
    CASE MAX(
      CASE evidence_quality
        WHEN 'direct_hiring_proof' THEN 2
        WHEN 'platform_aggregation' THEN 1
        ELSE 0
      END
    )
      WHEN 2 THEN 'direct_hiring_proof'
      WHEN 1 THEN 'platform_aggregation'
      ELSE 'enrichment_context'
    END AS evidence_quality,
    ARRAY_AGG(DISTINCT source ORDER BY source) AS source_families,
    ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(BTRIM(evidence_title), '')), NULL) AS evidence_titles,
    -- candidate_source_keys now spans EVERY org_id in the corroboration group
    -- (not just one fragment), so the lead card's source-key evidence reflects
    -- the full merged entity, not a single fragment's keys.
    ARRAY(
      SELECT DISTINCT NULLIF(BTRIM(ref.source_key), '')
      FROM org_source_refs AS ref
      WHERE ref.org_id = ANY(ARRAY_AGG(DISTINCT normalized_signal_rows.org_id))
        AND ref.source = ANY(ARRAY_AGG(DISTINCT normalized_signal_rows.source))
        AND NULLIF(BTRIM(ref.source_key), '') IS NOT NULL
      ORDER BY NULLIF(BTRIM(ref.source_key), '')
    ) AS candidate_source_keys,
    ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(BTRIM(location_name), '')), NULL) AS location_names,
    COUNT(*)::INT AS vacancies_count,
    COUNT(DISTINCT evidence_title)::INT AS distinct_vacancy_names_count,
    MAX(published_at) AS latest_published_at
  FROM normalized_signal_rows
  GROUP BY corroboration_key, corroboration_key_type
),
scored AS (
  SELECT
    org_id,
    corroboration_key,
    corroboration_key_type,
    corroborated_org_ids,
    source_external_id,
    source_display_name,
    evidence_quality,
    source_families,
    evidence_titles,
    candidate_source_keys,
    location_names,
    vacancies_count,
    distinct_vacancy_names_count,
    latest_published_at,
    LEAST(vacancies_count * 10, 50)::INT AS vacancies_score,
    LEAST(distinct_vacancy_names_count * 5, 25)::INT AS role_diversity_score,
    -- Sliding recency_score: 20 at 0 days → 10 at 7 days → 0 at 45 days.
    -- Linear gradient avoids the binary cliff at day 3/7 boundaries.
    GREATEST(0, LEAST(20, (20 * (1.0 - EXTRACT(EPOCH FROM (NOW() - latest_published_at)) / (45.0 * 86400)))::INT))::INT AS recency_score,
    LEAST(
      vacancies_count * 10
      + distinct_vacancy_names_count * 5
      + GREATEST(0, LEAST(20, (20 * (1.0 - EXTRACT(EPOCH FROM (NOW() - latest_published_at)) / (45.0 * 86400)))::INT)),
      90
    )::INT AS activity_score,
    CASE evidence_quality
      WHEN 'direct_hiring_proof' THEN 300
      WHEN 'platform_aggregation' THEN 200
      ELSE 0
    END::INT AS quality_weight,
    CASE evidence_quality
      WHEN 'direct_hiring_proof' THEN 'high_confidence_employer_match'
      WHEN 'platform_aggregation' THEN 'aggregated_employer_match'
      ELSE 'context_only'
    END AS quality_code,
    CASE evidence_quality
      WHEN 'direct_hiring_proof' THEN 'Прямой работодатель'
      WHEN 'platform_aggregation' THEN 'Платформенная агрегация'
      ELSE 'Контекстное обогащение'
    END AS quality_label,
    (latest_published_at >= NOW() - interval '3 days') AS is_recent,
    CASE
      WHEN latest_published_at >= NOW() - interval '3 days' THEN 'hot'
      WHEN latest_published_at >= NOW() - interval '7 days' THEN 'fresh'
      WHEN latest_published_at >= NOW() - interval '14 days' THEN 'recent'
      ELSE 'active'
    END AS recency_code,
    -- confidence_gate: A/B/C/D based on evidence layers and source diversity.
    -- A: direct proof + 2+ independent source families
    -- B: direct proof (single source) OR 2+ source families with platform_aggregation
    -- C: single-source platform_aggregation
    -- D: enrichment_context / fallback
    CASE
      WHEN evidence_quality = 'direct_hiring_proof'
        AND array_length(source_families, 1) >= 2
        THEN 'A'
      WHEN evidence_quality = 'direct_hiring_proof'
        OR (
          evidence_quality = 'platform_aggregation'
          AND array_length(source_families, 1) >= 2
        )
        THEN 'B'
      WHEN evidence_quality = 'platform_aggregation'
        THEN 'C'
      ELSE 'D'
    END AS confidence_gate
  FROM aggregated
  WHERE evidence_quality <> 'enrichment_context'
    AND latest_published_at IS NOT NULL
    AND latest_published_at >= NOW() - interval '45 days'
),
ranked AS (
  SELECT
    ROW_NUMBER() OVER (
      ORDER BY
        (quality_weight + activity_score) DESC,
        quality_weight DESC,
        vacancies_count DESC,
        latest_published_at DESC NULLS LAST
    )::INT AS rank,
    org_id,
    corroboration_key,
    corroboration_key_type,
    corroborated_org_ids,
    source_external_id,
    source_display_name,
    evidence_quality,
    source_families,
    evidence_titles,
    candidate_source_keys,
    location_names,
    vacancies_count,
    distinct_vacancy_names_count,
    latest_published_at,
    vacancies_score,
    role_diversity_score,
    recency_score,
    activity_score,
    quality_weight,
    quality_code,
    quality_label,
    is_recent,
    recency_code,
    (quality_weight + activity_score)::INT AS total_score,
    confidence_gate,
    CASE
      WHEN vacancies_count >= 3 THEN 'multi_open_roles'
      ELSE 'active_recruiting_role'
    END AS primary_reason_code,
    CASE
      WHEN vacancies_count >= 3 AND evidence_titles[1] IS NOT NULL
        THEN vacancies_count || ' вакансий, включая «' || evidence_titles[1] || '»'
      WHEN vacancies_count >= 3
        THEN vacancies_count || ' активных вакансий одновременно'
      WHEN evidence_titles[1] IS NOT NULL
        THEN 'Открыта вакансия «' || evidence_titles[1] || '»'
      ELSE 'Есть активная вакансия'
    END AS primary_reason_label,
    CASE
      WHEN latest_published_at >= NOW() - interval '3 days' THEN 'very_recent_post'
      WHEN distinct_vacancy_names_count >= 2 THEN 'multi_role_hiring'
      ELSE 'recent_contact_window'
    END AS secondary_reason_code,
    CASE
      WHEN latest_published_at >= NOW() - interval '3 days'
        THEN 'Опубликовано ' || TO_CHAR(latest_published_at, 'DD.MM')
      WHEN distinct_vacancy_names_count >= 2
        THEN distinct_vacancy_names_count || ' разных ролей — найм не точечный'
      ELSE 'Опубликовано за последние 45 дней'
    END AS secondary_reason_label
  FROM scored
)
SELECT
  rank,
  org_id,
  corroboration_key,
  corroboration_key_type,
  corroborated_org_ids,
  source_external_id,
  source_display_name,
  ranked_org.career_page_url AS career_page_url,
  source_families,
  evidence_titles,
  candidate_source_keys,
  location_names,
  vacancies_count,
  distinct_vacancy_names_count,
  latest_published_at,
  quality_code,
  quality_label,
  quality_weight,
  vacancies_score,
  role_diversity_score,
  recency_score,
  activity_score,
  total_score,
  is_recent,
  recency_code,
  confidence_gate,
  -- is_cross_source_corroborated: true when this lead merges 2+ fragmented
  -- org_ids under one corroboration_key. Exposed so the lead card / digest can
  -- show "подтверждено N источниками" truthfully and the analytics can count
  -- cross-source corroborated share. Single-fragment leads stay false.
  (array_length(corroborated_org_ids, 1) >= 2) AS is_cross_source_corroborated,
  primary_reason_code,
  primary_reason_label,
  secondary_reason_code,
  secondary_reason_label,
  jsonb_build_object(
    'quality_weight', quality_weight,
    'vacancies_score', vacancies_score,
    'role_diversity_score', role_diversity_score,
    'recency_score', recency_score,
    'activity_score', activity_score,
    'total_score', total_score,
    'confidence_gate', confidence_gate
  ) AS score_components,
  jsonb_build_array(
    jsonb_build_object(
      'slot', 1,
      'code', primary_reason_code,
      'label', primary_reason_label
    ),
    jsonb_build_object(
      'slot', 2,
      'code', secondary_reason_code,
      'label', secondary_reason_label
    )
  ) AS reason_details
FROM ranked
LEFT JOIN orgs AS ranked_org ON ranked_org.id = ranked.org_id
ORDER BY rank ASC
`;
