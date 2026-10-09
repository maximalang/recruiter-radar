-- Landing demand funnel report (task t_98d91920).
--
-- Funnel: landing_viewed -> preview_started -> checkout_started (+1:4:3
-- ratio guard) with per-stage demand composition by traffic source
-- (referer/UTM classes), device and internal markers. Exclusions are part
-- of the dimension vocabulary (ua_class = 'browser' rows only; internal
-- marker 'none' rows only), not ad-hoc WHERE clauses, so the definition is
-- auditable against the preregistered protocol in
-- docs/marketing/landing-demand-protocol.md.
--
-- Usage:
--   psql "$DATABASE_URL" -f packages/db/scripts/landing-demand-funnel.sql
--   # optional window override:
--   psql "$DATABASE_URL" \
--     -v window_start="2026-09-01 00:00:00+03" \
--     -v window_end="2026-09-08 00:00:00+03" \
--     -f packages/db/scripts/landing-demand-funnel.sql

WITH window_bounds AS (
  SELECT
    COALESCE(NULLIF(:'{?window_start}', '')::timestamptz, NOW() - INTERVAL '7 days') AS window_start,
    COALESCE(NULLIF(:'{?window_end}', '')::timestamptz, NOW()) AS window_end
),

landing_events AS (
  SELECT
    visit_id,
    metadata ->> 'referer_class' AS referer_class,
    metadata ->> 'utm_source_class' AS utm_source_class,
    metadata ->> 'ua_class' AS ua_class,
    metadata ->> 'internal_marker' AS internal_marker,
    occurred_at
  FROM product_telemetry_events
  CROSS JOIN window_bounds
  WHERE event_name = 'landing_viewed'
    AND occurred_at >= window_start
    AND occurred_at < window_end
),

measurable_visits AS (
  SELECT *
  FROM landing_events
  WHERE visit_id IS NOT NULL
    AND COALESCE(ua_class, 'unknown') = 'browser'
    AND COALESCE(internal_marker, 'none') = 'none'
)

SELECT
  'funnel' AS section,
  (SELECT COUNT(DISTINCT visit_id) FROM measurable_visits) AS landing_viewed,
  (SELECT COUNT(DISTINCT v.visit_id)
     FROM measurable_visits v
     JOIN product_telemetry_events p
       ON p.event_name = 'preview_started'
      AND p.visit_id = v.visit_id
      AND p.occurred_at >= v.occurred_at) AS preview_started,
  (SELECT COUNT(DISTINCT v.visit_id)
     FROM measurable_visits v
     JOIN product_telemetry_events p
       ON p.event_name = 'checkout_started'
      AND p.visit_id = v.visit_id
      AND p.occurred_at >= v.occurred_at) AS checkout_started,
  NULL::numeric AS ratio_preview_per_view,
  NULL::numeric AS ratio_checkout_per_view,
  NULL::numeric AS ratio_preview_per_checkout
UNION ALL
SELECT
  'ratio_check' AS section,
  NULL, NULL, NULL,
  CASE WHEN (SELECT COUNT(DISTINCT visit_id) FROM measurable_visits) = 0
       THEN NULL
       ELSE ROUND(
         (SELECT COUNT(DISTINCT v.visit_id)
            FROM measurable_visits v
            JOIN product_telemetry_events p
              ON p.event_name = 'preview_started'
             AND p.visit_id = v.visit_id
             AND p.occurred_at >= v.occurred_at)::numeric
         / (SELECT COUNT(DISTINCT visit_id) FROM measurable_visits), 4)
  END,
  CASE WHEN (SELECT COUNT(DISTINCT visit_id) FROM measurable_visits) = 0
       THEN NULL
       ELSE ROUND(
         (SELECT COUNT(DISTINCT v.visit_id)
            FROM measurable_visits v
            JOIN product_telemetry_events p
              ON p.event_name = 'checkout_started'
             AND p.visit_id = v.visit_id
             AND p.occurred_at >= v.occurred_at)::numeric
         / (SELECT COUNT(DISTINCT visit_id) FROM measurable_visits), 4)
  END,
  CASE WHEN (SELECT COUNT(DISTINCT v.visit_id)
               FROM measurable_visits v
               JOIN product_telemetry_events p
                 ON p.event_name = 'checkout_started'
                AND p.visit_id = v.visit_id
                AND p.occurred_at >= v.occurred_at) = 0
       THEN NULL
       ELSE ROUND(
         (SELECT COUNT(DISTINCT v.visit_id)
            FROM measurable_visits v
            JOIN product_telemetry_events p
              ON p.event_name = 'preview_started'
             AND p.visit_id = v.visit_id
             AND p.occurred_at >= v.occurred_at)::numeric
         / (SELECT COUNT(DISTINCT v.visit_id)
              FROM measurable_visits v
              JOIN product_telemetry_events p
                ON p.event_name = 'checkout_started'
               AND p.visit_id = v.visit_id
               AND p.occurred_at >= v.occurred_at), 4)
  END;

-- Demand composition by source class and device (per-stage counts,
-- conversion to checkout within visits).
WITH window_bounds AS (
  SELECT
    COALESCE(NULLIF(:'{?window_start}', '')::timestamptz, NOW() - INTERVAL '7 days') AS window_start,
    COALESCE(NULLIF(:'{?window_end}', '')::timestamptz, NOW()) AS window_end
),

landing_events AS (
  SELECT
    visit_id,
    metadata ->> 'referer_class' AS referer_class,
    metadata ->> 'utm_source_class' AS utm_source_class,
    metadata ->> 'ua_class' AS ua_class,
    metadata ->> 'internal_marker' AS internal_marker,
    occurred_at
  FROM product_telemetry_events
  CROSS JOIN window_bounds
  WHERE event_name = 'landing_viewed'
    AND occurred_at >= window_start
    AND occurred_at < window_end
),

measurable_visits AS (
  SELECT *
  FROM landing_events
  WHERE visit_id IS NOT NULL
    AND COALESCE(ua_class, 'unknown') = 'browser'
    AND COALESCE(internal_marker, 'none') = 'none'
),

per_visit AS (
  SELECT
    v.visit_id,
    COALESCE(v.referer_class, 'unknown') AS referer_class,
    COALESCE(v.utm_source_class, 'unknown') AS utm_source_class,
    COALESCE(v.ua_class, 'unknown') AS ua_class,
    EXISTS (
      SELECT 1 FROM product_telemetry_events p
      WHERE p.event_name = 'preview_started'
        AND p.visit_id = v.visit_id
        AND p.occurred_at >= v.occurred_at
    ) AS has_preview,
    EXISTS (
      SELECT 1 FROM product_telemetry_events p
      WHERE p.event_name = 'checkout_started'
        AND p.visit_id = v.visit_id
        AND p.occurred_at >= v.occurred_at
    ) AS has_checkout
  FROM measurable_visits v
)

SELECT
  referer_class,
  utm_source_class,
  ua_class,
  COUNT(*) AS landing_viewed,
  COUNT(*) FILTER (WHERE has_preview) AS preview_started,
  COUNT(*) FILTER (WHERE has_checkout) AS checkout_started,
  ROUND(
    CASE WHEN COUNT(*) = 0 THEN NULL
         ELSE COUNT(*) FILTER (WHERE has_preview)::numeric / COUNT(*) END, 4) AS preview_rate,
  ROUND(
    CASE WHEN COUNT(*) FILTER (WHERE has_preview) = 0 THEN NULL
         ELSE COUNT(*) FILTER (WHERE has_checkout)::numeric
              / COUNT(*) FILTER (WHERE has_preview) END, 4) AS checkout_rate
FROM per_visit
GROUP BY referer_class, utm_source_class, ua_class
ORDER BY landing_viewed DESC, referer_class, utm_source_class, ua_class;
