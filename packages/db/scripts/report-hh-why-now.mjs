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
    'DATABASE_URL is not set. Add it to your environment or .env file, then run `npm run hh:why-now` again.',
  );
  process.exit(1);
}

try {
  const rows = await fetchTopEmployers(databaseUrl);
  const report = rows.map((row) => ({
    rank: row.rank,
    hh_employer_id: row.source_external_id ?? '',
    employer_name: row.source_display_name ?? '',
    total_score: row.total_score,
    reasons: buildReasons(row),
  }));

  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`HH why-now report failed: ${message}`);
  process.exit(1);
}

async function fetchTopEmployers(connectionString) {
  const client = new Client({
    connectionString,
  });

  await client.connect();

  try {
    const result = await client.query(`${digestEvidenceQuery}\nLIMIT 10`);

    return result.rows;
  } finally {
    await client.end();
  }
}

function buildReasons(row) {
  const reasons = [
    row.vacancies_count >= 3
      ? 'У компании несколько активных вакансий одновременно'
      : 'У компании есть активная вакансия по рекрутингу',
  ];

  if (row.is_recent) {
    reasons.push('Вакансия опубликована совсем недавно');
  } else {
    reasons.push(
      row.distinct_vacancy_names_count >= 2
        ? 'Есть несколько разных ролей, значит найм не точечный'
        : 'Роль опубликована недавно, это хороший момент для контакта',
    );
  }

  return reasons.slice(0, 2);
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
