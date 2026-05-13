WITH source_signal_rows AS (
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
    ) AS payload_source_keys
  FROM signals AS signal
  WHERE signal.signal_type = 'job_posting'
    AND signal.source IN ('hh', 'career-pages')
),
normalized_signal_rows AS (
  SELECT
    signal.org_id,
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
    -- direct_hiring_proof  — company-owned surface (career-pages) or a matched org-level external ID
    --                        that indicates a verified employer entity, not a platform aggregator ID.
    --                        source_entity_external_id / org_external_id are org-level identifiers.
    --                        employer_id / hh_employer_id are NOT org-level: they are platform (HH)
    --                        aggregator IDs and do NOT grant direct_hiring_proof status on their own.
    -- platform_aggregation  — signal from a platform (HH) with a company match in org_source_refs,
    --                        but no company-owned surface. HH/employer_id alone → platform_aggregation.
    -- enrichment_context    — no match found; signal provides background context only.
    CASE
      WHEN signal.source = 'career-pages'
        THEN 'direct_hiring_proof'
      WHEN signal.payload_external_id IS NOT NULL
        AND signal.payload_external_id NOT IN (
          -- employer_id and hh_employer_id are HH platform IDs, not org identifiers.
          -- Their presence alone does not constitute a direct hiring proof.
          (signal.payload ->> 'employer_id'),
          (signal.payload ->> 'hh_employer_id')
        )
        THEN 'direct_hiring_proof'
      WHEN source_ref.matched_by IS NOT NULL
        THEN 'platform_aggregation'
      ELSE 'enrichment_context'
    END AS evidence_quality
  FROM source_signal_rows AS signal
  JOIN orgs AS org
    ON org.id = signal.org_id
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
    org_id,
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
    ARRAY(
      SELECT DISTINCT NULLIF(BTRIM(ref.source_key), '')
      FROM org_source_refs AS ref
      WHERE ref.org_id = normalized_signal_rows.org_id
        AND ref.source = ANY(ARRAY_AGG(DISTINCT normalized_signal_rows.source))
        AND NULLIF(BTRIM(ref.source_key), '') IS NOT NULL
      ORDER BY NULLIF(BTRIM(ref.source_key), '')
    ) AS candidate_source_keys,
    ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(BTRIM(location_name), '')), NULL) AS location_names,
    COUNT(*)::INT AS vacancies_count,
    COUNT(DISTINCT evidence_title)::INT AS distinct_vacancy_names_count,
    MAX(published_at) AS latest_published_at
  FROM normalized_signal_rows
  GROUP BY org_id
),
scored AS (
  SELECT
    org_id,
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
    CASE
      WHEN latest_published_at >= NOW() - interval '3 days' THEN 20
      WHEN latest_published_at >= NOW() - interval '7 days' THEN 10
      ELSE 0
    END::INT AS recency_score,
    LEAST(
      vacancies_count * 10
      + distinct_vacancy_names_count * 5
      + CASE
        WHEN latest_published_at >= NOW() - interval '3 days' THEN 20
        WHEN latest_published_at >= NOW() - interval '7 days' THEN 10
        ELSE 0
      END,
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
      WHEN vacancies_count >= 3 THEN 'У компании несколько активных вакансий одновременно'
      ELSE 'У компании есть активная вакансия по рекрутингу'
    END AS primary_reason_label,
    CASE
      WHEN latest_published_at >= NOW() - interval '3 days' THEN 'very_recent_post'
      WHEN distinct_vacancy_names_count >= 2 THEN 'multi_role_hiring'
      ELSE 'recent_contact_window'
    END AS secondary_reason_code,
    CASE
      WHEN latest_published_at >= NOW() - interval '3 days' THEN 'Вакансия опубликована совсем недавно'
      WHEN distinct_vacancy_names_count >= 2 THEN 'Есть несколько разных ролей, значит найм не точечный'
      ELSE 'Роль опубликована недавно, это хороший момент для контакта'
    END AS secondary_reason_label
  FROM scored
)
SELECT
  rank,
  org_id,
  source_external_id,
  source_display_name,
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
ORDER BY rank ASC
