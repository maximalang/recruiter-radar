import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');
const searchText = 'рекрутер';
const fetchUrl = new URL('https://api.hh.ru/vacancies');
const hhSource = 'hh';

fetchUrl.searchParams.set('text', searchText);
fetchUrl.searchParams.set('per_page', '20');
fetchUrl.searchParams.set('page', '0');

loadEnvFile(rootEnvPath);

if (typeof fetch !== 'function') {
  console.error('Built-in fetch is unavailable. Use Node.js 18+ to run this script.');
  process.exit(1);
}

const hhUserAgent = process.env.HH_USER_AGENT?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!hhUserAgent) {
  console.error(
    'HH_USER_AGENT is not set. Add it to your environment or .env file, then run `npm run hh:ingest` again.',
  );
  process.exit(1);
}

if (!databaseUrl) {
  console.error(
    'DATABASE_URL is not set. Add it to your environment or .env file, then run `npm run hh:ingest` again.',
  );
  process.exit(1);
}

try {
  const vacancies = await fetchVacancies(hhUserAgent);
  const normalizedVacancies = normalizeVacancies(vacancies);
  const stats =
    normalizedVacancies.length === 0
      ? { hhVacancyUpsertCount: 0, signalUpsertCount: 0, skippedSignalCount: 0 }
      : await upsertVacancies(databaseUrl, normalizedVacancies);

  console.log(`vacancies received: ${vacancies.length}`);
  console.log(`hh vacancy upserts completed: ${stats.hhVacancyUpsertCount}`);
  console.log(`normalized signal upserts completed: ${stats.signalUpsertCount}`);

  if (stats.skippedSignalCount > 0) {
    console.log(`vacancies skipped for normalized layer: ${stats.skippedSignalCount}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const causeMessage =
    error instanceof Error && error.cause instanceof Error ? error.cause.message : '';

  console.error(`HH ingestion failed: ${message}`);

  if (causeMessage) {
    console.error(`cause: ${causeMessage}`);
  }

  process.exit(1);
}

async function fetchVacancies(userAgent) {
  const response = await fetch(fetchUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': userAgent,
    },
  });

  if (!response.ok) {
    const details = await safeReadBody(response);
    const suffix = details ? `: ${details}` : '';
    throw new Error(`HH request failed with ${response.status} ${response.statusText}${suffix}`);
  }

  const payload = await response.json();
  return Array.isArray(payload.items) ? payload.items : [];
}

function normalizeVacancies(vacancies) {
  const fetchedAt = new Date().toISOString();
  const normalizedVacancies = [];

  for (const vacancy of vacancies) {
    const normalizedVacancy = normalizeVacancy(vacancy, fetchedAt);

    if (normalizedVacancy) {
      normalizedVacancies.push(normalizedVacancy);
    }
  }

  return normalizedVacancies;
}

function normalizeVacancy(vacancy, fetchedAt) {
  if (!vacancy || typeof vacancy !== 'object') {
    return null;
  }

  const hhVacancyId = toNonEmptyText(vacancy.id);
  const vacancyName = toNonEmptyText(vacancy.name);

  if (!hhVacancyId || !vacancyName) {
    return null;
  }

  const hhEmployerId = toNonEmptyText(vacancy.employer?.id);
  const employerName = toNonEmptyText(vacancy.employer?.name);
  const employerIdSourceKey = buildEmployerIdSourceKey(hhEmployerId);
  const employerNameSourceKey = buildEmployerNameSourceKey(employerName);
  const orgSourceKey = buildOrgSourceKey(hhEmployerId, employerName);

  return {
    hhVacancyId,
    hhEmployerId,
    employerName,
    orgName: employerName ?? buildFallbackEmployerName(hhEmployerId),
    orgDisplayName: employerName,
    orgSourceKey,
    orgSourceAliasKey:
      employerIdSourceKey && employerNameSourceKey && employerIdSourceKey !== employerNameSourceKey
        ? employerNameSourceKey
        : null,
    vacancyName,
    areaName: toNonEmptyText(vacancy.area?.name),
    publishedAt: toTimestampOrNull(vacancy.published_at),
    alternateUrl: toNonEmptyText(vacancy.alternate_url),
    payload: vacancy,
    fetchedAt,
  };
}

async function upsertVacancies(connectionString, vacancies) {
  const client = new Client({
    connectionString,
  });

  const hhVacancyUpsertQuery = `
    INSERT INTO hh_vacancies (
      hh_vacancy_id,
      hh_employer_id,
      employer_name,
      vacancy_name,
      area_name,
      published_at,
      alternate_url,
      payload,
      fetched_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (hh_vacancy_id) DO UPDATE
    SET
      hh_employer_id = EXCLUDED.hh_employer_id,
      employer_name = EXCLUDED.employer_name,
      vacancy_name = EXCLUDED.vacancy_name,
      area_name = EXCLUDED.area_name,
      published_at = EXCLUDED.published_at,
      alternate_url = EXCLUDED.alternate_url,
      payload = EXCLUDED.payload,
      fetched_at = EXCLUDED.fetched_at
  `;

  const signalUpsertQuery = `
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
    VALUES ($1, 'job_posting', $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (source, external_id) DO UPDATE
    SET
      org_id = EXCLUDED.org_id,
      headline = EXCLUDED.headline,
      summary = EXCLUDED.summary,
      source_url = EXCLUDED.source_url,
      occurred_at = EXCLUDED.occurred_at,
      payload = EXCLUDED.payload
  `;

  let hhVacancyUpsertCount = 0;
  let signalUpsertCount = 0;
  let skippedSignalCount = 0;

  await client.connect();

  try {
    await client.query('BEGIN');

    for (const vacancy of vacancies) {
      const hhVacancyResult = await client.query(hhVacancyUpsertQuery, [
        vacancy.hhVacancyId,
        vacancy.hhEmployerId,
        vacancy.employerName,
        vacancy.vacancyName,
        vacancy.areaName,
        vacancy.publishedAt,
        vacancy.alternateUrl,
        vacancy.payload,
        vacancy.fetchedAt,
      ]);

      hhVacancyUpsertCount += hhVacancyResult.rowCount ?? 0;

      if (!vacancy.orgSourceKey || !vacancy.orgName) {
        skippedSignalCount += 1;
        continue;
      }

      const orgId = await upsertOrgSourceRef(client, vacancy);
      const signalResult = await client.query(signalUpsertQuery, [
        orgId,
        hhSource,
        vacancy.hhVacancyId,
        vacancy.vacancyName,
        buildSignalSummary(vacancy),
        vacancy.alternateUrl,
        vacancy.publishedAt ?? vacancy.fetchedAt,
        buildSignalPayload(vacancy),
      ]);

      signalUpsertCount += signalResult.rowCount ?? 0;
    }

    await client.query('COMMIT');

    return {
      hhVacancyUpsertCount,
      signalUpsertCount,
      skippedSignalCount,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

async function upsertOrgSourceRef(client, vacancy) {
  const sourceKeys = buildOrgSourceKeys(vacancy);

  await lockOrgSourceKeys(client, sourceKeys);

  const existingRefResult = await client.query(
    `
      SELECT org_id
      FROM org_source_refs
      WHERE source = $1
        AND source_key = ANY($2)
      ORDER BY
        CASE
          WHEN source_key = $3 THEN 0
          WHEN source_key = $4 THEN 1
          ELSE 2
        END,
        id ASC
      LIMIT 1
    `,
    [hhSource, sourceKeys, vacancy.orgSourceKey, vacancy.orgSourceAliasKey],
  );

  let orgId = existingRefResult.rows[0]?.org_id;

  if (!orgId) {
    const insertedOrgResult = await client.query(
      `
        INSERT INTO orgs (name)
        VALUES ($1)
        RETURNING id
      `,
      [vacancy.orgName],
    );

    orgId = insertedOrgResult.rows[0].id;
  }

  await upsertOrgSourceKeys(client, orgId, vacancy);
  await updateOrgSourceRef(client, orgId, vacancy);

  return orgId;
}

async function updateOrgSourceRef(client, orgId, vacancy) {
  await client.query(
    `
      UPDATE orgs
      SET name = $2
      WHERE id = $1
        AND $2 IS NOT NULL
        AND BTRIM($2) <> ''
        AND (
          name IS NULL
          OR BTRIM(name) = ''
          OR name = $3
        )
    `,
    [orgId, vacancy.orgDisplayName, buildFallbackEmployerName(vacancy.hhEmployerId)],
  );

  await client.query(
    `
      UPDATE org_source_refs
      SET
        display_name = CASE
          WHEN $4 IS NULL OR BTRIM($4) = '' THEN display_name
          WHEN display_name IS NULL OR BTRIM(display_name) = '' THEN $4
          ELSE display_name
        END
      WHERE org_id = $1
        AND source = $2
        AND source_key = ANY($3)
    `,
    [orgId, hhSource, buildOrgSourceKeys(vacancy), vacancy.orgDisplayName],
  );
}

async function lockOrgSourceKeys(client, sourceKeys) {
  for (const sourceKey of [...sourceKeys].sort()) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
      hhSource,
      sourceKey,
    ]);
  }
}

async function upsertOrgSourceKeys(client, orgId, vacancy) {
  const sourceRefs = [
    {
      sourceKey: vacancy.orgSourceKey,
      externalId: vacancy.hhEmployerId,
      displayName: vacancy.orgDisplayName,
    },
  ];

  if (vacancy.orgSourceAliasKey) {
    sourceRefs.push({
      sourceKey: vacancy.orgSourceAliasKey,
      externalId: null,
      displayName: vacancy.orgDisplayName,
    });
  }

  for (const sourceRef of sourceRefs) {
    await client.query(
      `
        INSERT INTO org_source_refs (
          org_id,
          source,
          source_key,
          external_id,
          display_name,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (source, source_key) DO UPDATE
        SET
          external_id = COALESCE(EXCLUDED.external_id, org_source_refs.external_id),
          display_name = CASE
            WHEN EXCLUDED.display_name IS NULL OR BTRIM(EXCLUDED.display_name) = '' THEN org_source_refs.display_name
            WHEN org_source_refs.display_name IS NULL OR BTRIM(org_source_refs.display_name) = '' THEN EXCLUDED.display_name
            ELSE org_source_refs.display_name
          END,
          metadata = COALESCE(org_source_refs.metadata, '{}'::jsonb) || EXCLUDED.metadata
      `,
      [
        orgId,
        hhSource,
        sourceRef.sourceKey,
        sourceRef.externalId,
        sourceRef.displayName,
        buildOrgSourceMetadata(vacancy, sourceRef.sourceKey, sourceRef.externalId),
      ],
    );
  }
}

function buildOrgSourceMetadata(vacancy, sourceKey = vacancy.orgSourceKey, externalId = vacancy.hhEmployerId) {
  return {
    source: hhSource,
    source_key: sourceKey,
    source_alias_key:
      sourceKey === vacancy.orgSourceAliasKey ? vacancy.orgSourceKey : vacancy.orgSourceAliasKey,
    external_id: externalId,
    display_name: vacancy.orgDisplayName,
    employer_name: vacancy.employerName,
    org_name: vacancy.orgName,
  };
}

function buildSignalPayload(vacancy) {
  return {
    source: hhSource,
    source_entity_type: 'employer',
    source_entity_key: vacancy.orgSourceKey,
    source_entity_alias_key: vacancy.orgSourceAliasKey,
    source_entity_external_id: vacancy.hhEmployerId,
    source_entity_display_name: vacancy.employerName,
    source_entity_name: vacancy.orgName,
    source_record_type: 'job_posting',
    source_record_id: vacancy.hhVacancyId,
    source_record_title: vacancy.vacancyName,
    source_record_url: vacancy.alternateUrl,
    source_record_published_at: vacancy.publishedAt,
    org_source_key: vacancy.orgSourceKey,
    hh_vacancy_id: vacancy.hhVacancyId,
    hh_employer_id: vacancy.hhEmployerId,
    employer_name: vacancy.employerName,
    vacancy_name: vacancy.vacancyName,
    area_name: vacancy.areaName,
    published_at: vacancy.publishedAt,
    alternate_url: vacancy.alternateUrl,
    fetched_at: vacancy.fetchedAt,
  };
}

function buildSignalSummary(vacancy) {
  const fragments = [];

  if (vacancy.employerName) {
    fragments.push(vacancy.employerName);
  }

  if (vacancy.areaName) {
    fragments.push(`регион: ${vacancy.areaName}`);
  }

  if (fragments.length === 0) {
    return 'Новая вакансия из hh.ru';
  }

  return `Вакансия hh.ru (${fragments.join(', ')})`;
}

function buildOrgSourceKey(hhEmployerId, employerName) {
  return buildEmployerIdSourceKey(hhEmployerId) ?? buildEmployerNameSourceKey(employerName);
}

function buildEmployerIdSourceKey(hhEmployerId) {
  return hhEmployerId ? `employer:${hhEmployerId}` : null;
}

function buildEmployerNameSourceKey(employerName) {
  const normalizedEmployerName = normalizeSourceKeyText(employerName);
  return normalizedEmployerName ? `employer-name:${normalizedEmployerName}` : null;
}

function buildOrgSourceKeys(vacancy) {
  return [vacancy.orgSourceKey, vacancy.orgSourceAliasKey].filter(
    (sourceKey, index, sourceKeys) => Boolean(sourceKey) && sourceKeys.indexOf(sourceKey) === index,
  );
}

function normalizeSourceKeyText(value) {
  if (!value) {
    return null;
  }

  const normalizedValue = value.trim().replace(/\s+/g, ' ').toLowerCase();
  return normalizedValue === '' ? null : normalizedValue;
}

function buildFallbackEmployerName(hhEmployerId) {
  return hhEmployerId ? `Работодатель HH ${hhEmployerId}` : null;
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const envFile = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');

  for (const rawLine of envFile.split(/\r?\n/)) {
    const trimmedLine = rawLine.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = rawLine.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = rawLine.slice(0, separatorIndex).trim();

    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = rawLine.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function toNonEmptyText(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue === '' ? null : normalizedValue;
}

function toTimestampOrNull(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

async function safeReadBody(response) {
  try {
    const body = await response.text();
    return body.trim();
  } catch {
    return '';
  }
}
