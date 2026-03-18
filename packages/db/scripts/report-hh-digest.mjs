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
    'DATABASE_URL is not set. Add it to your environment or .env file, then run `npm run hh:digest` again.',
  );
  process.exit(1);
}

try {
  const rows = await fetchTopEmployers(databaseUrl);
  const report = rows.map(buildDigestRow);

  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`HH digest report failed: ${message}`);
  process.exit(1);
}

async function fetchTopEmployers(connectionString) {
  const client = new Client({
    connectionString,
  });

  await client.connect();

  try {
    const result = await client.query(`
      WITH aggregated AS (
        SELECT
          hh_employer_id,
          employer_name,
          COUNT(*)::INT AS vacancies_count,
          COUNT(DISTINCT vacancy_name)::INT AS distinct_vacancy_names_count,
          MAX(published_at) AS latest_published_at
        FROM hh_vacancies
        GROUP BY hh_employer_id, employer_name
      ),
      scored AS (
        SELECT
          hh_employer_id,
          employer_name,
          vacancies_count,
          distinct_vacancy_names_count,
          latest_published_at,
          (
            vacancies_count * 10
            + distinct_vacancy_names_count * 5
            + CASE
              WHEN latest_published_at >= NOW() - interval '3 days' THEN 20
              WHEN latest_published_at >= NOW() - interval '7 days' THEN 10
              ELSE 0
            END
          )::INT AS total_score,
          (latest_published_at >= NOW() - interval '3 days') AS is_recent
        FROM aggregated
      ),
      ranked AS (
        SELECT
          ROW_NUMBER() OVER (
            ORDER BY
              total_score DESC,
              vacancies_count DESC,
              latest_published_at DESC NULLS LAST
          )::INT AS rank,
          hh_employer_id,
          employer_name,
          vacancies_count,
          distinct_vacancy_names_count,
          latest_published_at,
          total_score,
          is_recent
        FROM scored
      )
      SELECT
        rank,
        hh_employer_id,
        employer_name,
        vacancies_count,
        distinct_vacancy_names_count,
        latest_published_at,
        total_score,
        is_recent
      FROM ranked
      ORDER BY rank ASC
      LIMIT 10
    `);

    return result.rows;
  } finally {
    await client.end();
  }
}

function buildDigestRow(row) {
  const reasons = buildReasons(row);

  return {
    rank: row.rank,
    hh_employer_id: row.hh_employer_id ?? '',
    employer_name: row.employer_name ?? '',
    vacancies_count: row.vacancies_count,
    distinct_vacancy_names_count: row.distinct_vacancy_names_count,
    latest_published_at: formatTimestamp(row.latest_published_at),
    total_score: row.total_score,
    reasons,
    opener: buildOpener(row.employer_name ?? '', reasons),
  };
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

function buildOpener(employerName, reasons) {
  const safeEmployerName = shortenEmployerName(employerName);
  const [firstReason, secondReason] = reasons.map(toReasonFragment);

  const opener =
    `Здравствуйте! По ${safeEmployerName} видно, что ${firstReason}, а также ${secondReason}. ` +
    'Предлагаю короткий созвон на 10-15 минут, чтобы сверить задачи по найму и понять, можем ли быть полезны. ' +
    'Если сейчас неактуально, просто дайте знать.';

  if (opener.length <= 450) {
    return opener;
  }

  return (
    `Здравствуйте! По ${safeEmployerName} видно: ${firstReason}; ${secondReason}. ` +
    'Предлагаю короткий созвон на 10-15 минут, чтобы понять, можем ли помочь с наймом. ' +
    'Если неактуально, просто дайте знать.'
  );
}

function shortenEmployerName(value) {
  const name = String(value || '').trim();

  if (name.length <= 80) {
    return name || 'компании';
  }

  return `${name.slice(0, 77)}...`;
}

function toReasonFragment(reason) {
  switch (reason) {
    case 'У компании несколько активных вакансий одновременно':
      return 'идет несколько активных вакансий одновременно';
    case 'У компании есть активная вакансия по рекрутингу':
      return 'есть активная вакансия по рекрутингу';
    case 'Есть несколько разных ролей, значит найм не точечный':
      return 'найм выглядит не точечным';
    case 'Роль опубликована недавно, это хороший момент для контакта':
      return 'роль опубликована недавно';
    case 'Вакансия опубликована совсем недавно':
      return 'вакансия опубликована совсем недавно';
    default:
      return 'найм выглядит актуальным';
  }
}

function formatTimestamp(value) {
  if (!value) {
    return '';
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
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
