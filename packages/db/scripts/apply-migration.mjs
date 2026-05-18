import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');

loadEnvFile(rootEnvPath);

const migrationPathArg = process.argv[2];
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!migrationPathArg) {
  console.error('Usage: node packages/db/scripts/apply-migration.mjs <migration-path>');
  process.exit(1);
}

if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Add it to your environment or .env file, then run the migration again.');
  process.exit(1);
}

const migrationPath = resolve(scriptDir, '..', migrationPathArg);
const sql = readFileSync(migrationPath, 'utf8');
const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });

try {
  await client.connect();
  await client.query(sql);
  console.log(JSON.stringify({ ok: true, migration: migrationPath }, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Migration apply failed: ${message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
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
