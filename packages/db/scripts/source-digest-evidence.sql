WITH source_signal_rows AS (
  SELECT
    signal.org_id,
    signal.source,
    signal.headline AS evidence_title,
    signal.occurred_at AS published_at,
    COALESCE(
      NULLIF(signal.payload ->> 'source_entity_external_id', ''),
      NULLIF(signal.payload ->> 'hh_employer_id', '')
    ) AS payload_external_id,
    COALESCE(
      NULLIF(BTRIM(signal.payload ->> 'source_entity_display_name'), ''),
      NULLIF(BTRIM(signal.payload ->> 'source_entity_name'), ''),
      NULLIF(BTRIM(signal.payload ->> 'employer_name'), '')
    ) AS payload_display_name,
    COALESCE(
      NULLIF(signal.payload ->> 'source_entity_key', ''),
      NULLIF(signal.payload ->> 'org_source_key', ''),
      CASE
        WHEN COALESCE(
          NULLIF(signal.payload ->> 'source_entity_external_id', ''),
          NULLIF(signal.payload ->> 'hh_employer_id', '')
        ) IS NOT NULL THEN
          'employer:' || COALESCE(
            NULLIF(signal.payload ->> 'source_entity_external_id', ''),
            NULLIF(signal.payload ->> 'hh_employer_id', '')
          )
        WHEN COALESCE(
          NULLIF(BTRIM(signal.payload ->> 'source_entity_display_name'), ''),
          NULLIF(BTRIM(signal.payload ->> 'source_entity_name'), ''),
          NULLIF(BTRIM(signal.payload ->> 'employer_name'), '')
        ) IS NOT NULL THEN
          'employer-name:' || LOWER(REGEXP_REPLACE(
            COALESCE(
              NULLIF(BTRIM(signal.payload ->> 'source_entity_display_name'), ''),
              NULLIF(BTRIM(signal.payload ->> 'source_entity_name'), ''),
              NULLIF(BTRIM(signal.payload ->> 'employer_name'), '')
            ),
            '\s+',
            ' ',
            'g'
          ))
        ELSE NULL
      END
    ) AS payload_source_key
  FROM signals AS signal
  WHERE signal.signal_type = 'job_posting'
    AND signal.source = 'hh'
),
normalized_signal_rows AS (
  SELECT
    signal.org_id,
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
    signal.published_at,
    CASE
      WHEN signal.payload_external_id IS NOT NULL THEN 'direct_hiring_proof'
      WHEN source_ref.matched_by IS NOT NULL THEN 'platform_aggregation'
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
        WHEN signal.payload_source_key IS NOT NULL
          AND metadata ->> 'source_alias_key' = signal.payload_source_key
          AND NULLIF(external_id, '') IS NOT NULL THEN 'source_alias_key'
        WHEN signal.payload_source_key IS NOT NULL
          AND source_key = signal.payload_source_key THEN 'source_key'
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
        WHEN signal.payload_source_key IS NOT NULL
          AND metadata ->> 'source_alias_key' = signal.payload_source_key
          AND NULLIF(external_id, '') IS NOT NULL THEN 1
        WHEN signal.payload_source_key IS NOT NULL
          AND source_key = signal.payload_source_key THEN 2
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
    source_external_id,
    source_display_name,
    evidence_quality,
    COUNT(*)::INT AS vacancies_count,
    COUNT(DISTINCT evidence_title)::INT AS distinct_vacancy_names_count,
    MAX(published_at) AS latest_published_at
  FROM normalized_signal_rows
  GROUP BY org_id, source_external_id, source_display_name, evidence_quality
),
scored AS (
  SELECT
    org_id,
    source_external_id,
    source_display_name,
    evidence_quality,
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
    END AS recency_code
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
  source_external_id,
  source_display_name,
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
    'total_score', total_score
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
