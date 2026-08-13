#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

import pg from 'pg';

const execFileAsync = promisify(execFile);
const { Client } = pg;
const sourceId = process.argv[2]?.trim();
if (!['superjob', 'rabota-rossii', 'public-ats', 'hosted-ats', 'company-context', 'government-open-data', 'source-subsystem'].includes(sourceId)) {
  throw new Error('Usage: run-source-live-db-verifier.mjs <superjob|rabota-rossii|public-ats|hosted-ats|company-context|government-open-data|source-subsystem>');
}
if (process.env.SOURCE_LIVE_DB_TEST_ACK !== 'isolated') {
  throw new Error('SOURCE_LIVE_DB_TEST_ACK=isolated is required before creating a disposable database.');
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required.');

const databaseName = `rr_source_live_${sourceId.replaceAll('-', '_')}_${Date.now()}_${process.pid}`;
const temporaryUrl = new URL(databaseUrl);
temporaryUrl.pathname = `/${databaseName}`;
temporaryUrl.searchParams.delete('schema');
const testEnvironment = {
  ...process.env,
  DATABASE_URL: temporaryUrl.toString(),
  SOURCE_LIVE_VERIFY: '1',
  SOURCE_LIVE_DB_TEST_ACK: 'isolated',
  SOURCE_IDENTITY_LINEAGE_DB_TEST_ACK: 'isolated',
  SOURCE_ENV_FILE_DISABLED: 'true',
};
const admin = new Client({ connectionString: databaseUrl });
let databaseCreated = false;

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function run(args) {
  const result = await execFileAsync(process.execPath, args, {
    cwd: resolve(import.meta.dirname, '../../..'),
    env: testEnvironment,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

await admin.connect();
try {
  await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  databaseCreated = true;
  await run([resolve(import.meta.dirname, './migrate.mjs')]);
  const verifier = sourceId === 'public-ats'
    ? './verify-public-ats-live-pipeline.mjs'
    : sourceId === 'hosted-ats'
      ? './verify-hosted-ats-live-pipeline.mjs'
    : sourceId === 'company-context'
      ? './verify-company-owned-context-live-pipeline.mjs'
      : sourceId === 'government-open-data'
        ? './verify-government-open-data-live-pipeline.mjs'
        : sourceId === 'source-subsystem'
          ? './verify-source-subsystem-db.mjs'
      : './verify-job-source-live-pipeline.mjs';
  await run([
    resolve(import.meta.dirname, verifier),
    ...(['public-ats', 'hosted-ats', 'company-context', 'government-open-data', 'source-subsystem'].includes(sourceId) ? [] : [sourceId]),
  ]);
} finally {
  if (databaseCreated) {
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`);
  }
  await admin.end();
}
