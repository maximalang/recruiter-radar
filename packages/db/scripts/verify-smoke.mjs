import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const { Client } = pg;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '../../..');
const rootEnvPath = resolve(scriptDir, '../../../.env');

loadEnvFile(rootEnvPath);

const alwaysScripts = [
  './verify-career-pages-smoke.mjs',
  './verify-career-pages-discovery-smoke.mjs',
  './verify-rabota-rossii-smoke.mjs',
  './verify-company-site-smoke.mjs',
  './verify-linkedin-company-pages-smoke.mjs',
  './verify-tech-job-boards-smoke.mjs',
  './verify-habr-career-scrape-smoke.mjs',
  './verify-egrul-fns-smoke.mjs',
  './verify-funding-business-signals-smoke.mjs',
  './verify-rf-source-expansion-smoke.mjs',
  './adapters/verify-adapters-smoke.mjs',
  './verify-source-readiness.mjs',
];
const dbBackedScripts = [
  './verify-mixed-ranking-smoke.mjs',
  './verify-digest-selection-smoke.mjs',
  './verify-digest-feedback-smoke.mjs',
  './verify-career-pages-ingest.mjs',
];

for (const scriptPath of alwaysScripts) {
  runScript(scriptPath);
}

const databaseUrl = process.env.DATABASE_URL?.trim();
const schemaCheck = databaseUrl
  ? await checkRequiredDigestTables(databaseUrl)
  : { ready: false, reason: 'DATABASE_URL is not set.' };
const schemaReady = schemaCheck.ready;

if (schemaReady) {
  for (const scriptPath of dbBackedScripts) {
    runScript(scriptPath);
  }
} else {
  console.log(JSON.stringify({
    ok: true,
    smoke: 'db-backed-skipped',
    reason: schemaCheck.reason,
    skipped: dbBackedScripts.map((scriptPath) => scriptPath.replace('./', 'packages/db/scripts/')),
  }, null, 2));
}

function runScript(relativePath) {
  const absolutePath = resolve(scriptDir, relativePath);
  const result = spawnSync(process.execPath, [absolutePath], {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function checkRequiredDigestTables(connectionString) {
  try {
    const ready = await hasRequiredDigestTables(connectionString);

    return {
      ready,
      reason: ready
        ? null
        : 'DATABASE_URL is set but digest schema tables are missing in the target database.',
    };
  } catch (error) {
    return {
      ready: false,
      reason: `DATABASE_URL is set but database connection/schema check failed: ${formatSafeError(error)}`,
    };
  }
}

function formatSafeError(error) {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const parts = [error.name].filter(Boolean);
  const errorCode = typeof error.code === 'string' ? error.code : null;

  if (errorCode) {
    parts.push(errorCode);
  }

  if (Array.isArray(error.errors)) {
    const nestedCodes = Array.from(new Set(error.errors
      .map((nestedError) => nestedError?.code ?? nestedError?.name)
      .filter(Boolean)));

    if (nestedCodes.length > 0) {
      parts.push(nestedCodes.join(','));
    }
  }

  return parts.length > 0 ? parts.join(': ') : 'database connection check failed';
}

async function hasRequiredDigestTables(connectionString) {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  await client.connect();

  try {
    const result = await client.query(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1)
      `,
      [['client_profiles', 'client_digest_org_state', 'digest_runs', 'digest_candidates', 'orgs', 'org_source_refs', 'signals']],
    );
    const existingTables = new Set(result.rows.map((row) => row.table_name));

    return ['client_profiles', 'client_digest_org_state', 'digest_runs', 'digest_candidates', 'orgs', 'org_source_refs', 'signals']
      .every((tableName) => existingTables.has(tableName));
  } finally {
    await client.end().catch(() => {});
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

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}
