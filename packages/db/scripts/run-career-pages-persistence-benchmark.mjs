import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';

const { Client } = pg;
const execFileAsync = promisify(execFile);
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required.');

const root = resolve(import.meta.dirname, '..', '..', '..');
const migrateScript = resolve(root, 'packages/db/scripts/migrate.mjs');
const benchmarkScript = resolve(root, 'packages/db/scripts/benchmark-career-pages-persistence.mjs');
const admin = new Client({ connectionString: databaseUrl });

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function runMode(mode) {
  const databaseName = `rr_career_benchmark_${mode}_${process.pid}_${Date.now()}`;
  const temporaryUrl = new URL(databaseUrl);
  temporaryUrl.pathname = `/${databaseName}`;
  const env = {
    ...process.env,
    DATABASE_URL: temporaryUrl.toString(),
    CAREER_PAGES_BENCHMARK_ACK: 'isolated',
  };

  await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  try {
    await execFileAsync(process.execPath, [migrateScript], {
      cwd: root, env, maxBuffer: 20 * 1024 * 1024,
    });
    const { stdout } = await execFileAsync(process.execPath, [benchmarkScript, mode], {
      cwd: root, env, maxBuffer: 20 * 1024 * 1024,
      timeout: 10 * 60 * 1_000,
    });
    return JSON.parse(stdout.trim());
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`);
  }
}

await admin.connect();
try {
  const legacy = await runMode('legacy');
  const batch = await runMode('batch');
  const speedup = legacy.durationMs / Math.max(1, batch.durationMs);
  const report = {
    recordCount: batch.recordCount,
    companyCount: batch.companyCount,
    legacyDurationMs: legacy.durationMs,
    batchDurationMs: batch.durationMs,
    speedup: Number(speedup.toFixed(2)),
    target: { minimumSpeedup: 3, maximumBatchDurationMs: 120_000 },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (speedup < 3) throw new Error(`Career-page batch speedup ${speedup.toFixed(2)}x is below 3x.`);
  if (batch.durationMs >= 120_000) throw new Error(`Career-page batch duration ${batch.durationMs}ms exceeds 120000ms.`);
} finally {
  await admin.end();
}
