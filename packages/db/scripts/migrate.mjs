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
let migrationLockHeld = false;

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

  // 2. Bootstrap policy.
  // The numbered migration chain (0001_init → latest) is the single
  // authoritative, self-contained schema: every type/table/column the code
  // depends on is created exactly once, in order, with no intra-chain
  // collisions. An empty database is therefore bootstrapped by replaying the
  // whole chain — NOT by `schema/init.sql`.
  //
  // `schema/init.sql` is a stale partial squash (frozen circa 20260608, missing
  // owner_id / rbac / evidence_bundle / signal pattern / confidence / inn,ogrn /
  // review_status / contact_policy / icp_roles). Replaying it before 0001_init
  // also collides on unguarded `CREATE TYPE`/`CREATE TABLE`, which is the
  // empty-database failure this script previously hit. It is intentionally left
  // out of the bootstrap path. See docs/legacy-tables-deprecation.md.
  //
  // Databases provisioned by the OLD init.sql path carry an 'init-schema' marker
  // row. Those databases already contain every base table, so the chain loop
  // below — which keys purely off recorded versions — would try to re-create them
  // and fail. There is no static way to know which individual ALTER migrations
  // were already baked into that squash, so such a database must be reconciled by
  // hand before this migrator can advance it: compare the live schema against the
  // chain, INSERT the matching versions into schema_migrations (and add any
  // genuinely-missing columns those skipped migrations would have added), then
  // delete the 'init-schema' marker. Fail loudly rather than corrupt the schema.
  const initMarker = 'init-schema';
  const { rows: initApplied } = await client.query(
    `SELECT 1 FROM schema_migrations WHERE version = $1`,
    [initMarker]
  );

  if (initApplied.length > 0) {
    console.error(
      "This database was bootstrapped from the deprecated schema/init.sql " +
        "(it carries an 'init-schema' marker). The migrator cannot advance it " +
        'automatically because init.sql was a partial squash with no per-version ' +
        'records. Reconcile schema_migrations to match the live schema and remove ' +
        "the 'init-schema' marker before re-running. Refusing to proceed to avoid " +
        'duplicate-object failures or silently skipped columns.'
    );
    process.exit(1);
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

  await client.query(
    `SELECT pg_advisory_lock(
       hashtextextended('recruiter-radar:schema-migrations', 0)
     )`
  );
  migrationLockHeld = true;

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
    let transactionStarted = false;
    try {
      const concurrentIndexes = parseConcurrentIndexMigration(sql);
      if (concurrentIndexes) {
        await client.query("SET lock_timeout = '5s'");
        await client.query("SET statement_timeout = '30min'");
        for (const index of concurrentIndexes) {
          const { rows: existingRows } = await client.query(
            `SELECT candidate.indisvalid AS valid
             FROM pg_class AS relation
             JOIN pg_namespace AS namespace
               ON namespace.oid = relation.relnamespace
             JOIN pg_index AS candidate
               ON candidate.indexrelid = relation.oid
             WHERE namespace.nspname = CURRENT_SCHEMA()
               AND relation.relname = $1`,
            [index.name]
          );
          if (existingRows[0]?.valid === false) {
            await client.query(
              `DROP INDEX CONCURRENTLY IF EXISTS "${index.name}"`
            );
          }
          await client.query(index.sql);
          const { rows: validityRows } = await client.query(
            `SELECT candidate.indisvalid AS valid
             FROM pg_class AS relation
             JOIN pg_namespace AS namespace
               ON namespace.oid = relation.relnamespace
             JOIN pg_index AS candidate
               ON candidate.indexrelid = relation.oid
             WHERE namespace.nspname = CURRENT_SCHEMA()
               AND relation.relname = $1`,
            [index.name]
          );
          if (validityRows[0]?.valid !== true) {
            throw new Error(
              `Concurrent index ${index.name} is missing or invalid after build.`
            );
          }
        }
        await client.query('RESET statement_timeout');
        await client.query('RESET lock_timeout');
      } else {
        await client.query('BEGIN');
        transactionStarted = true;
        await client.query(sql);
      }
      if (!transactionStarted) {
        await client.query('BEGIN');
        transactionStarted = true;
      }
      await client.query(
        `INSERT INTO schema_migrations (version) VALUES ($1)`,
        [version]
      );
      await client.query('COMMIT');
      transactionStarted = false;
      appliedCount++;
      console.log(`  ✓ ${filename} applied.`);
    } catch (error) {
      if (transactionStarted) {
        await client.query('ROLLBACK').catch(() => {});
      }
      await client.query('RESET statement_timeout').catch(() => {});
      await client.query('RESET lock_timeout').catch(() => {});
      const message = error instanceof Error ? error.message : String(error);
      const position = (
        error &&
        typeof error === 'object' &&
        'position' in error &&
        typeof error.position === 'string'
      )
        ? ` (position ${error.position})`
        : '';
      console.error(`  ✗ ${filename} FAILED: ${message}${position}`);
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
  if (migrationLockHeld) {
    await client.query(
      `SELECT pg_advisory_unlock(
         hashtextextended('recruiter-radar:schema-migrations', 0)
       )`
    ).catch(() => {});
  }
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

function parseConcurrentIndexMigration(sql) {
  const marker = '-- migrate:concurrent-indexes';
  const firstContentLine = sql
    .split(/\r?\n/)
    .find(line => line.trim().length > 0)
    ?.trim();
  if (firstContentLine !== marker) {
    return null;
  }

  const executableBody = sql
    .slice(sql.indexOf(marker) + marker.length)
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');
  const indexes = executableBody
    .split(';')
    .map(statement => statement.trim())
    .filter(Boolean)
    .map(statement => {
      const executableSql = statement.trim();
      const match = executableSql.match(
        /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS\s+([a-z_][a-z0-9_]*)\s+ON\s+[\s\S]+$/i
      );
      if (!match) {
        throw new Error(
          'Concurrent-index migrations may contain only validated ' +
            'CREATE INDEX CONCURRENTLY IF NOT EXISTS statements.'
        );
      }
      return {
        name: match[1],
        sql: executableSql,
      };
    });
  if (indexes.length === 0) {
    throw new Error('Concurrent-index migrations must contain an index.');
  }
  if (new Set(indexes.map(index => index.name)).size !== indexes.length) {
    throw new Error('Concurrent-index migrations must not repeat index names.');
  }
  return indexes;
}
