import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');

loadEnvFile(rootEnvPath);

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Add it to your environment or .env file, then run `npm run db:migrate` again.');
  process.exit(1);
}

const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });

try {
  await client.connect();
  console.log('Connected to database.');

  // 1. Create schema_migrations table if not exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT NOT NULL PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('schema_migrations table ready.');

  // 2. Check if the database is empty (no user tables) → apply init.sql
  const { rows: tableCheck } = await client.query(`
    SELECT COUNT(*) AS cnt
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name <> 'schema_migrations'
  `);

  const initMarker = 'init-schema';
  const { rows: initApplied } = await client.query(
    `SELECT 1 FROM schema_migrations WHERE version = $1`,
    [initMarker]
  );

  if (tableCheck[0].cnt === 0 && initApplied.length === 0) {
    const initPath = resolve(scriptDir, '..', 'schema', 'init.sql');
    if (existsSync(initPath)) {
      const initSql = readFileSync(initPath, 'utf8');
      console.log('Applying init.sql (empty database)...');
      await client.query(initSql);
      await client.query(
        `INSERT INTO schema_migrations (version) VALUES ($1)`,
        [initMarker]
      );
      console.log('init.sql applied successfully.');
    } else {
      console.warn('init.sql not found at', initPath, '— skipping initial schema.');
    }
  } else {
    console.log('Database already has tables — skipping init.sql.');
  }

  // 3. Discover and apply pending migrations
  const migrationsDir = resolve(scriptDir, '..', 'migrations');
  if (!existsSync(migrationsDir)) {
    console.log('No migrations directory found — nothing to apply.');
    process.exit(0);
  }

  const allFiles = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort();

  const { rows: appliedRows } = await client.query(
    `SELECT version FROM schema_migrations ORDER BY version`
  );
  const appliedSet = new Set(appliedRows.map(r => r.version));

  let appliedCount = 0;
  let skippedCount = 0;

  for (const filename of allFiles) {
    // Strip .sql extension to get the version key
    const version = filename.replace(/\.sql$/, '');

    if (appliedSet.has(version)) {
      skippedCount++;
      continue;
    }

    const filePath = join(migrationsDir, filename);
    const sql = readFileSync(filePath, 'utf8');

    console.log(`Applying migration: ${filename}`);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (version) VALUES ($1)`,
        [version]
      );
      await client.query('COMMIT');
      appliedCount++;
      console.log(`  ✓ ${filename} applied.`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${filename} FAILED: ${message}`);
      process.exitCode = 1;
      break;
    }
  }

  console.log(`\nMigration summary: ${appliedCount} applied, ${skippedCount} skipped, ${allFiles.length} total.`);

  if (appliedCount > 0) {
    console.log('All new migrations applied successfully.');
  } else if (skippedCount === allFiles.length) {
    console.log('Database is up to date — no pending migrations.');
  }
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Migration failed: ${message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
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

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}
