BEGIN;

CREATE TABLE IF NOT EXISTS org_source_refs (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_key TEXT NOT NULL,
  external_id TEXT,
  display_name TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT org_source_refs_source_not_blank CHECK (BTRIM(source) <> ''),
  CONSTRAINT org_source_refs_source_key_not_blank CHECK (BTRIM(source_key) <> ''),
  CONSTRAINT org_source_refs_external_id_not_blank
    CHECK (external_id IS NULL OR BTRIM(external_id) <> ''),
  CONSTRAINT org_source_refs_display_name_not_blank
    CHECK (display_name IS NULL OR BTRIM(display_name) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS org_source_refs_source_key_uidx
  ON org_source_refs (source, source_key);
CREATE UNIQUE INDEX IF NOT EXISTS org_source_refs_source_external_id_uidx
  ON org_source_refs (source, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS org_source_refs_org_source_idx
  ON org_source_refs (org_id, source);

DROP INDEX IF EXISTS signals_source_external_id_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS signals_source_external_id_uidx
  ON signals (source, external_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trg
    JOIN pg_class AS cls
      ON cls.oid = trg.tgrelid
    WHERE trg.tgname = 'org_source_refs_set_updated_at'
      AND cls.relname = 'org_source_refs'
  ) THEN
    CREATE TRIGGER org_source_refs_set_updated_at
    BEFORE UPDATE ON org_source_refs
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

DO $$
DECLARE
  employer_record RECORD;
  resolved_org_id BIGINT;
BEGIN
  FOR employer_record IN
    SELECT DISTINCT
      NULLIF(BTRIM(hh_employer_id), '') AS external_id,
      CASE
        WHEN NULLIF(BTRIM(hh_employer_id), '') IS NOT NULL THEN
          'employer:' || NULLIF(BTRIM(hh_employer_id), '')
        ELSE NULL
      END AS id_source_key,
      CASE
        WHEN NULLIF(BTRIM(employer_name), '') IS NOT NULL THEN
          'employer-name:' || LOWER(REGEXP_REPLACE(BTRIM(employer_name), '\s+', ' ', 'g'))
        ELSE NULL
      END AS name_source_key,
      NULLIF(BTRIM(employer_name), '') AS display_name,
      COALESCE(
        NULLIF(BTRIM(employer_name), ''),
        CASE
          WHEN NULLIF(BTRIM(hh_employer_id), '') IS NOT NULL THEN
            'Работодатель HH ' || NULLIF(BTRIM(hh_employer_id), '')
          ELSE 'Работодатель HH'
        END
      ) AS org_name
    FROM hh_vacancies
    WHERE NULLIF(BTRIM(hh_employer_id), '') IS NOT NULL
       OR NULLIF(BTRIM(employer_name), '') IS NOT NULL
  LOOP
    IF employer_record.id_source_key IS NULL
       AND employer_record.name_source_key IS NULL THEN
      CONTINUE;
    END IF;

    SELECT org_id
    INTO resolved_org_id
    FROM org_source_refs
    WHERE source = 'hh'
      AND source_key = ANY(ARRAY[employer_record.id_source_key, employer_record.name_source_key])
    ORDER BY
      CASE
        WHEN source_key = employer_record.id_source_key THEN 0
        WHEN source_key = employer_record.name_source_key THEN 1
        ELSE 2
      END,
      id ASC
    LIMIT 1;

    IF resolved_org_id IS NULL THEN
      INSERT INTO orgs (name)
      VALUES (employer_record.org_name)
      RETURNING id INTO resolved_org_id;
    END IF;

    INSERT INTO org_source_refs (
      org_id,
      source,
      source_key,
      external_id,
      display_name,
      metadata
    )
    VALUES (
      resolved_org_id,
      'hh',
      COALESCE(employer_record.id_source_key, employer_record.name_source_key),
      employer_record.external_id,
      employer_record.display_name,
      jsonb_build_object(
        'source', 'hh',
        'source_key', COALESCE(employer_record.id_source_key, employer_record.name_source_key),
        'source_alias_key', CASE
          WHEN employer_record.id_source_key IS NOT NULL THEN employer_record.name_source_key
          ELSE NULL
        END,
        'external_id', employer_record.external_id,
        'display_name', employer_record.display_name,
        'employer_name', employer_record.display_name,
        'org_name', employer_record.org_name
      )
    )
    ON CONFLICT (source, source_key) DO UPDATE
    SET
      external_id = COALESCE(EXCLUDED.external_id, org_source_refs.external_id),
      display_name = CASE
        WHEN EXCLUDED.display_name IS NULL OR BTRIM(EXCLUDED.display_name) = '' THEN org_source_refs.display_name
        WHEN org_source_refs.display_name IS NULL OR BTRIM(org_source_refs.display_name) = '' THEN EXCLUDED.display_name
        ELSE org_source_refs.display_name
      END,
      metadata = COALESCE(org_source_refs.metadata, '{}'::JSONB) || EXCLUDED.metadata;

    IF employer_record.id_source_key IS NOT NULL
       AND employer_record.name_source_key IS NOT NULL THEN
      INSERT INTO org_source_refs (
        org_id,
        source,
        source_key,
        external_id,
        display_name,
        metadata
      )
      VALUES (
        resolved_org_id,
        'hh',
        employer_record.name_source_key,
        NULL,
        employer_record.display_name,
        jsonb_build_object(
          'source', 'hh',
          'source_key', employer_record.name_source_key,
          'source_alias_key', employer_record.id_source_key,
          'external_id', NULL,
          'display_name', employer_record.display_name,
          'employer_name', employer_record.display_name,
          'org_name', employer_record.org_name
        )
      )
      ON CONFLICT (source, source_key) DO UPDATE
      SET
        display_name = CASE
          WHEN EXCLUDED.display_name IS NULL OR BTRIM(EXCLUDED.display_name) = '' THEN org_source_refs.display_name
          WHEN org_source_refs.display_name IS NULL OR BTRIM(org_source_refs.display_name) = '' THEN EXCLUDED.display_name
          ELSE org_source_refs.display_name
        END,
        metadata = COALESCE(org_source_refs.metadata, '{}'::JSONB) || EXCLUDED.metadata;
    END IF;

    UPDATE orgs
    SET name = employer_record.display_name
    WHERE id = resolved_org_id
      AND employer_record.display_name IS NOT NULL
      AND BTRIM(employer_record.display_name) <> ''
      AND (
        orgs.name IS NULL
        OR BTRIM(orgs.name) = ''
        OR orgs.name = CASE
          WHEN employer_record.external_id IS NOT NULL THEN
            'Работодатель HH ' || employer_record.external_id
          ELSE 'Работодатель HH'
        END
      );
  END LOOP;

  INSERT INTO signals (
    org_id,
    signal_type,
    source,
    external_id,
    headline,
    summary,
    source_url,
    occurred_at,
    payload
  )
  SELECT
    refs.org_id,
    'job_posting'::signal_kind,
    'hh',
    vacancy.hh_vacancy_id,
    vacancy.vacancy_name,
    CASE
      WHEN NULLIF(BTRIM(vacancy.area_name), '') IS NOT NULL THEN
        'Новая вакансия в регионе ' || vacancy.area_name
      ELSE 'Новая вакансия из hh.ru'
    END,
    vacancy.alternate_url,
    COALESCE(vacancy.published_at, vacancy.fetched_at, vacancy.created_at),
    jsonb_build_object(
      'source', 'hh',
      'org_source_key', CASE
        WHEN NULLIF(BTRIM(vacancy.hh_employer_id), '') IS NOT NULL THEN
          'employer:' || NULLIF(BTRIM(vacancy.hh_employer_id), '')
        WHEN NULLIF(BTRIM(vacancy.employer_name), '') IS NOT NULL THEN
          'employer-name:' || LOWER(REGEXP_REPLACE(BTRIM(vacancy.employer_name), '\s+', ' ', 'g'))
        ELSE NULL
      END,
      'hh_vacancy_id', vacancy.hh_vacancy_id,
      'hh_employer_id', vacancy.hh_employer_id,
      'employer_name', vacancy.employer_name,
      'vacancy_name', vacancy.vacancy_name,
      'area_name', vacancy.area_name,
      'published_at', vacancy.published_at,
      'alternate_url', vacancy.alternate_url,
      'fetched_at', vacancy.fetched_at
    )
  FROM hh_vacancies AS vacancy
  JOIN org_source_refs AS refs
    ON refs.source = 'hh'
   AND refs.source_key = CASE
     WHEN NULLIF(BTRIM(vacancy.hh_employer_id), '') IS NOT NULL THEN 'employer:' || NULLIF(BTRIM(vacancy.hh_employer_id), '')
     WHEN NULLIF(BTRIM(vacancy.employer_name), '') IS NOT NULL THEN
       'employer-name:' || LOWER(REGEXP_REPLACE(BTRIM(vacancy.employer_name), '\s+', ' ', 'g'))
     ELSE NULL
   END
  ON CONFLICT (source, external_id) DO UPDATE
  SET
    org_id = EXCLUDED.org_id,
    headline = EXCLUDED.headline,
    summary = EXCLUDED.summary,
    source_url = EXCLUDED.source_url,
    occurred_at = EXCLUDED.occurred_at,
    payload = EXCLUDED.payload;
END;
$$;

COMMIT;
