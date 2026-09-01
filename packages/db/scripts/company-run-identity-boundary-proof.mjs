#!/usr/bin/env node
// Company-executed disposable-DB runner for the RF identity boundary
// quarantine verifier (Gap 1/Gap 2 closure evidence). Modeled on the repo's
// run-source-live-db-verifier.mjs: create an isolated database, apply all
// migrations, run the verifier, then drop the database. Never touches a
// production database.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import pg from 'pg';

const execFileAsync = promisify(execFile);
const { Client } = pg;

if (process.env.SOURCE_LIVE_DB_TEST_ACK !== 'isolated') {
  throw new Error('SOURCE_LIVE_DB_TEST_ACK=isolated is required.');
}
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required.');

const databaseName = `rr_identity_boundary_company_${Date.now()}_${process.pid}`;
const temporaryUrl = new URL(databaseUrl);
temporaryUrl.pathname = `/${databaseName}`;
temporaryUrl.searchParams.delete('schema');
const testEnvironment = {
  ...process.env,
  DATABASE_URL: temporaryUrl.toString(),
  SOURCE_LIVE_VERIFY: '1',
  SOURCE_LIVE_DB_TEST_ACK: 'isolated',
  SOURCE_IDENTITY_LINEAGE_DB_TEST_ACK: 'isolated',
  SOURCE_QUARANTINE_POLICY_TEST_ACK: 'isolated',
  SOURCE_ENV_FILE_DISABLED: 'true',
};
const admin = new Client({ connectionString: databaseUrl });
let databaseCreated = false;

async function run(args) {
  const result = await execFileAsync(process.execPath, args, {
    cwd: resolve(import.meta.dirname, '.'),
    env: testEnvironment,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  console.log(`[company-runner] created disposable db ${databaseName}`);
  await run([resolve(import.meta.dirname, 'migrate.mjs')]);
  console.log('[company-runner] migrations applied; running quarantine verifier');
  await run([resolve(import.meta.dirname, 'verify-source-identity-boundary-quarantine.mjs')]);
  console.log('[company-runner] verifier completed');
} finally {
  if (databaseCreated) {
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    console.log(`[company-runner] dropped disposable db ${databaseName}`);
  }
  await admin.end();
}
