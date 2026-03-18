import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');
const searchText = '\u0440\u0435\u043a\u0440\u0443\u0442\u0435\u0440';
const fetchUrl = new URL('https://api.hh.ru/vacancies');

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
  const upsertCount =
    normalizedVacancies.length === 0 ? 0 : await upsertVacancies(databaseUrl, normalizedVacancies);

  console.log(`vacancies received: ${vacancies.length}`);
  console.log(`upserts completed: ${upsertCount}`);
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

  return {
    hhVacancyId,
    hhEmployerId: toNonEmptyText(vacancy.employer?.id),
    employerName: toNonEmptyText(vacancy.employer?.name),
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

  const upsertQuery = `
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

  let upsertCount = 0;

  await client.connect();

  try {
    await client.query('BEGIN');

    for (const vacancy of vacancies) {
      const result = await client.query(upsertQuery, [
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

      upsertCount += result.rowCount ?? 0;
    }

    await client.query('COMMIT');
    return upsertCount;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
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
