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
    'DATABASE_URL is not set. Add it to your environment or .env file, then run the report script again.',
  );
  process.exit(1);
}

export async function runDigestReport(label = 'digest') {
  const rows = await fetchDigestRows(databaseUrl);
  const report = rows.map(buildDigestRow);
  console.log(JSON.stringify(report, null, 2));

  const summary = buildQualitySummary(report);
  if (summary.total > 0) {
    console.log(`\n--- ${label} Operator Quality Summary ---`);
    console.table(summary.counts);
    console.log(`Total delivered: ${summary.total}`);
  }

  return report;
}

async function fetchDigestRows(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const result = await client.query(`
      SELECT
        r.*,
        cos.feedback_status,
        cos.feedback_note
      FROM (
        ${digestEvidenceQuery}
        LIMIT 10
      ) r
      LEFT JOIN client_digest_org_state cos
        ON cos.org_id = r.org_id
       AND cos.client_profile_id = r.client_profile_id
    `);

    return result.rows;
  } finally {
    await client.end();
  }
}

export function buildDigestRow(row) {
  const reasons = getReasonLabels(row);

  return {
    rank: row.rank,
    source_external_id: row.source_external_id ?? '',
    employer_name: row.source_display_name ?? '',
    vacancies_count: row.vacancies_count,
    distinct_vacancy_names_count: row.distinct_vacancy_names_count,
    latest_published_at: formatTimestamp(row.latest_published_at),
    total_score: row.total_score,
    quality: {
      code: row.quality_code ?? '',
      label: row.quality_label ?? '',
      weight: row.quality_weight,
    },
    score_components: row.score_components,
    reason_details: row.reason_details,
    reasons,
    opener: buildOpener(row.source_display_name ?? '', row.reason_details, reasons),
    feedback_status: row.feedback_status ?? '',
    feedback_note: row.feedback_note ?? '',
    action_hint: getActionHint(row.feedback_status ?? ''),
  };
}

export function getActionHint(status) {
  const hints = {
    none: null,
    contacted: 'Написали — ждать ответ',
    replied: 'Ответили — запросить созвон',
    won: 'Клиент',
    badfit: 'Не подходит',
    snooze: 'Отложено',
    dismissed: 'Скрыто',
  };
  return hints[status] ?? null;
}

function getReasonLabels(row) {
  return [row.primary_reason_label, row.secondary_reason_label].filter(
    (reason) => typeof reason === 'string' && reason.length > 0,
  );
}

function buildOpener(employerName, reasonDetails, reasons) {
  const safeEmployerName = shortenEmployerName(employerName);
  const [firstReason, secondReason] = getReasonFragments(reasonDetails, reasons);

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

function getReasonFragments(reasonDetails, reasons) {
  const fragmentsByCode = new Map([
    ['multi_open_roles', 'идет несколько активных вакансий одновременно'],
    ['active_recruiting_role', 'есть активная вакансия по рекрутингу'],
    ['multi_role_hiring', 'найм выглядит не точечным'],
    ['recent_contact_window', 'роль опубликована недавно'],
    ['very_recent_post', 'вакансия опубликована совсем недавно'],
  ]);

  const fragments = Array.isArray(reasonDetails)
    ? reasonDetails
        .map((reason) => fragmentsByCode.get(reason?.code) ?? null)
        .filter((reason) => typeof reason === 'string' && reason.length > 0)
    : [];

  while (fragments.length < 2) {
    fragments.push(reasons[fragments.length] ?? 'найм выглядит актуальным');
  }

  return fragments.slice(0, 2);
}

function formatTimestamp(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

export function buildQualitySummary(report) {
  const statusLabels = {
    none: 'Нет статуса',
    contacted: 'Написали',
    replied: 'Ответили',
    won: 'Клиент',
    badfit: 'Не подходит',
    snooze: 'Отложено',
    dismissed: 'Скрыто',
  };

  const counts = {};
  let total = 0;

  for (const row of report) {
    const status = row.feedback_status;
    if (!status) continue;
    const label = statusLabels[status] ?? status;
    counts[label] = (counts[label] ?? 0) + 1;
    total++;
  }

  return { counts, total };
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;

  const envFile = readFileSync(filePath, 'utf8').replace(/^﻿/, '');

  for (const rawLine of envFile.split(/\r?\n/)) {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) continue;

    const separatorIndex = rawLine.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = rawLine.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;

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