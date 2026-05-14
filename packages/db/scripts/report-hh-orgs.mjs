import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');
const digestEvidenceQuery = readFileSync(resolve(scriptDir, './source-digest-evidence.sql'), 'utf8');

loadEnvFile(rootEnvPath);

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error(
    'DATABASE_URL is not set. Add it to your environment or .env file, then run `npm run hh:report` again.',
  );
  process.exit(1);
}

try {
  const rows = await fetchTopOrganizations(databaseUrl);

  console.log('top 20 normalized hiring orgs:');
  console.table(
    rows.map((row) => ({
      org_external_id: row.source_external_id ?? '',
      org_name: row.source_display_name ?? '',
      source_families: formatSourceFamilies(row.source_families),
      confidence_gate: row.confidence_gate ?? '',
      quality: row.quality_label ?? '',
      vacancies_count: row.vacancies_count,
      distinct_vacancy_names_count: row.distinct_vacancy_names_count,
      latest_published_at: formatTimestamp(row.latest_published_at),
    })),
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`HH report failed: ${message}`);
  process.exit(1);
}

async function fetchTopOrganizations(connectionString) {
  const client = new Client({
    connectionString,
  });

  await client.connect();

  try {
    const result = await client.query(`${digestEvidenceQuery}\nLIMIT 20`);

    return result.rows;
  } finally {
    await client.end();
  }
}

function formatSourceFamilies(value) {
  return Array.isArray(value) ? value.join(', ') : '';
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
