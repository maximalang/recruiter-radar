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
  './verify-mixed-ranking-smoke.mjs',
  './verify-career-pages-smoke.mjs',
  './verify-career-pages-discovery-smoke.mjs',
];
const dbBackedScripts = [
  './verify-digest-selection-smoke.mjs',
  './verify-digest-feedback-smoke.mjs',
  './verify-career-pages-ingest.mjs',
];

for (const scriptPath of alwaysScripts) {
  runScript(scriptPath);
}

const databaseUrl = process.env.DATABASE_URL?.trim();
const schemaReady = databaseUrl ? await hasRequiredDigestTables(databaseUrl) : false;

if (schemaReady) {
  for (const scriptPath of dbBackedScripts) {
    runScript(scriptPath);
  }
} else {
  console.log(JSON.stringify({
    ok: true,
    smoke: 'db-backed-skipped',
    reason: databaseUrl
      ? 'DATABASE_URL is set but digest schema tables are missing in the target database.'
      : 'DATABASE_URL is not set.',
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
