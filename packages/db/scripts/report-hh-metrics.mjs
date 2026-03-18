import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');

loadEnvFile(rootEnvPath);

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error(
    'DATABASE_URL is not set. Add it to your environment or .env file, then run `npm run hh:metrics` again.',
  );
  process.exit(1);
}

try {
  const rows = await fetchEmployerMetrics(databaseUrl);

  console.log('top 20 hh employer metrics:');
  console.table(
    rows.map((row) => ({
      hh_employer_id: row.hh_employer_id ?? '',
      employer_name: row.employer_name ?? '',
      vacancies_count: row.vacancies_count,
      distinct_vacancy_names_count: row.distinct_vacancy_names_count,
      first_published_at: formatTimestamp(row.first_published_at),
      latest_published_at: formatTimestamp(row.latest_published_at),
    })),
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`HH metrics report failed: ${message}`);
  process.exit(1);
}

async function fetchEmployerMetrics(connectionString) {
  const client = new Client({
    connectionString,
  });

  await client.connect();

  try {
    const result = await client.query(`
      SELECT
        hh_employer_id,
        employer_name,
        COUNT(*)::INT AS vacancies_count,
        COUNT(DISTINCT vacancy_name)::INT AS distinct_vacancy_names_count,
        MIN(published_at) AS first_published_at,
        MAX(published_at) AS latest_published_at
      FROM hh_vacancies
      GROUP BY hh_employer_id, employer_name
      ORDER BY
        vacancies_count DESC,
        distinct_vacancy_names_count DESC,
        latest_published_at DESC NULLS LAST
      LIMIT 20
    `);

    return result.rows;
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

function formatTimestamp(value) {
  if (!value) {
    return '';
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}
