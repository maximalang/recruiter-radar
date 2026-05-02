WITH source_signal_rows AS (
  SELECT
    signal.org_id,
    signal.source,
    signal.headline AS evidence_title,
    signal.occurred_at AS published_at,
    NULLIF(signal.payload ->> 'hh_employer_id', '') AS payload_external_id,
    NULLIF(BTRIM(signal.payload ->> 'employer_name'), '') AS payload_display_name,
    COALESCE(
      NULLIF(signal.payload ->> 'org_source_key', ''),
      CASE
        WHEN NULLIF(signal.payload ->> 'hh_employer_id', '') IS NOT NULL THEN
          'employer:' || NULLIF(signal.payload ->> 'hh_employer_id', '')
        WHEN NULLIF(BTRIM(signal.payload ->> 'employer_name'), '') IS NOT NULL THEN
          'employer-name:' || LOWER(REGEXP_REPLACE(BTRIM(signal.payload ->> 'employer_name'), '\s+', ' ', 'g'))
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
    (latest_published_at >= NOW() - interval '3 days') AS is_recent
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
    (quality_weight + activity_score)::INT AS total_score,
    is_recent
  FROM scored
)
SELECT
  rank,
  source_external_id,
  source_display_name,
  vacancies_count,
  distinct_vacancy_names_count,
  latest_published_at,
  total_score,
  is_recent
FROM ranked
ORDER BY rank ASC
