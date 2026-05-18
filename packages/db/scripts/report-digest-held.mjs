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
    'DATABASE_URL is not set. Add it to your environment or .env file, then run `npm run digest:held` again.',
  );
  process.exit(1);
}

try {
  const rows = await fetchHeldCandidates(databaseUrl);

  console.log('Confidence gate legend:');
  console.log('  A / B — доставлены автоматически (не показаны здесь)');
  console.log('  C / D — требуют проверки оператором перед доставкой');
  console.log('');

  if (rows.length === 0) {
    console.log('No held digest candidates (confidence gate C/D) found.');
  } else {
    console.log(`Held digest candidates (confidence gate C/D): ${rows.length} total`);
    console.table(
      rows.map((row) => ({
        id: row.id,
        digest_run_id: row.digest_run_id,
        client_profile_id: row.client_profile_id,
        org_id: row.org_id,
        confidence_gate: row.confidence_gate ?? '',
        delivery_decision: formatDeliveryDecision(row.confidence_gate),
        total_score: row.total_score,
        source_families: formatSourceFamilies(row.source_families),
        feedback_status: row.feedback_status ?? '',
        feedback_note: row.feedback_note ?? '',
        created_at: formatTimestamp(row.created_at),
      })),
    );
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Held candidates report failed: ${message}`);
  process.exit(1);
}

async function fetchHeldCandidates(connectionString) {
  const client = new Client({
    connectionString,
  });

  await client.connect();

  try {
    const result = await client.query(`
      SELECT
        dc.id,
        dc.digest_run_id,
        dc.client_profile_id,
        dc.org_id,
        dc.total_score,
        dc.source_families,
        dc.created_at,
        dc.payload->>'confidenceGate' AS confidence_gate,
        cos.feedback_status,
        cos.feedback_note
      FROM digest_candidates dc
      LEFT JOIN client_digest_org_state cos
        ON cos.org_id = dc.org_id
       AND cos.client_profile_id = dc.client_profile_id
      WHERE dc.payload->>'confidenceGate' IN ('C', 'D')
      ORDER BY dc.created_at DESC, dc.id DESC
      LIMIT 100
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

  const envFile = readFileSync(filePath, 'utf8').replace(/^﻿/, '');

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

function formatSourceFamilies(value) {
  if (!Array.isArray(value)) {
    return '';
  }

  return value.join(', ');
}

function formatDeliveryDecision(gate) {
  if (gate === 'C') return 'Требует проверки — агрегация или неуверенное сопоставление';
  if (gate === 'D') return 'Контекст — нет прямого сигнала найма';
  return '';
}
