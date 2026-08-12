import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import pg from 'pg';

import { loadEnvFile } from './source-career-pages.mjs';

const { Client } = pg;
const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const rootDir = resolve(scriptDir, '../../..');
const sourceScriptPath = resolve(scriptDir, './source-career-pages.mjs');
const rootEnvPath = resolve(scriptDir, '../../../.env');

loadEnvFile(rootEnvPath);

const databaseUrl = process.env.DATABASE_URL?.trim();
const dbConnectionTimeoutMillis = 5000;

assert.ok(databaseUrl, 'DATABASE_URL must be set for verify:career-pages:ingest');
assert.equal(
  process.env.SOURCE_IDENTITY_LINEAGE_DB_TEST_ACK,
  'isolated',
  'SOURCE_IDENTITY_LINEAGE_DB_TEST_ACK=isolated is required; lineage verification must never use a user database',
);

const runId = `verify-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
const companyDomain = `${runId}.example`;
const companyName = `Verify Career Pages ${runId}`;
const companyWebsiteUrl = `https://${companyDomain}/`;
const careerPageUrl = `https://${companyDomain}/careers`;
const externalId = `career-pages-${runId}`;
const jobPostingUrl = `${careerPageUrl}/roles/platform-engineer`;
const canonicalSourceKeys = [`domain:${companyDomain}`];
const companyNameAliasKey = `company-name:${companyName.toLowerCase()}`;
const cleanupSourceKeys = [...canonicalSourceKeys, companyNameAliasKey];

const fixtureRecords = [
  {
    company_name: companyName,
    company_domain: companyDomain,
    company_website_url: companyWebsiteUrl,
    career_page_url: careerPageUrl,
    job_posting_url: jobPostingUrl,
    job_title: 'Platform Engineer',
    external_id: externalId,
    location: 'Remote',
    employment_type: 'full-time',
    occurred_at: '2026-01-15T12:00:00.000Z',
    source_record_type: 'job_posting',
    raw: {
      verify_run_id: runId,
      adapter: 'verify-fixture',
    },
  },
];

const tempDir = mkdtempSync(resolve(tmpdir(), 'career-pages-ingest-verify-'));
const fixturePath = resolve(tempDir, 'career-pages-ingest-fixture.json');
writeFileSync(fixturePath, `${JSON.stringify({ records: fixtureRecords }, null, 2)}\n`, 'utf8');

async function assertRequiredTablesExist() {
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: dbConnectionTimeoutMillis,
  });
  await client.connect();

  try {
    const result = await client.query(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1)
      `,
      [['orgs', 'org_source_refs', 'signals']],
    );
    const existingTables = new Set(result.rows.map((row) => row.table_name));
    const missingTables = ['orgs', 'org_source_refs', 'signals'].filter((tableName) => !existingTables.has(tableName));

    assert.equal(
      missingTables.length,
      0,
      `Missing required public tables for career-pages ingest verify: ${missingTables.join(', ')}. Apply the current DB schema/migrations to ${databaseUrl}.`,
    );
  } finally {
    await client.end();
  }
}

async function queryVerificationState() {
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: dbConnectionTimeoutMillis,
  });
  await client.connect();
  try {
    const orgResult = await client.query(
      `SELECT id, name, domain, website_url FROM orgs WHERE domain = $1`,
      [companyDomain],
    );
    const signalResult = await client.query(
      `SELECT org_id, source, external_id, headline, source_url, payload FROM signals WHERE source = $1 AND external_id = $2`,
      ['career-pages', externalId],
    );
    const refResult = await client.query(
      `SELECT org_id, source_key, external_id, display_name, metadata FROM org_source_refs WHERE source = $1 AND source_key = ANY($2) ORDER BY source_key ASC`,
      ['career-pages', cleanupSourceKeys],
    );
    const lineageResult = await client.query(
      `SELECT lineage.evidence_tier, lineage.extraction_method, evidence.url
       FROM source_signal_evidence_lineage_v1 lineage
       JOIN evidence_items evidence ON evidence.id = lineage.evidence_id
       WHERE lineage.source = $1 AND lineage.external_id = $2`,
      ['career-pages', externalId],
    );

    return {
      orgRows: orgResult.rows,
      signalRows: signalResult.rows,
      refRows: refResult.rows,
      lineageRows: lineageResult.rows,
    };
  } finally {
    await client.end();
  }
}

function runIngest() {
  const result = spawnSync(process.execPath, [sourceScriptPath, 'ingest'], {
    cwd: rootDir,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      CAREER_PAGES_INPUT_FILE: fixturePath,
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout || 'career-pages ingest exited with non-zero status');
  const summary = JSON.parse(result.stdout.trim());
  assert.equal(summary.source, 'career-pages');
  assert.equal(summary.action, 'ingest');
  assert.equal(summary.inputMode, 'file');
  assert.equal(summary.recordsReceived, fixtureRecords.length);
  assert.equal(summary.normalizedRecords, fixtureRecords.length);
  assert.equal(summary.signalUpsertsCompleted, fixtureRecords.length);
  assert.equal(summary.evidenceUpsertsCompleted, fixtureRecords.length);
  return summary;
}

function assertIdentityState(state) {
  assert.equal(state.refRows.length, canonicalSourceKeys.length);
  assert.deepEqual(state.refRows.map((row) => row.source_key), canonicalSourceKeys);
  assert.ok(
    state.refRows[0].metadata?.source_alias_keys?.includes(companyNameAliasKey),
    'weak company-name identity must remain an alias on the canonical domain ref',
  );
  assert.equal(
    state.refRows.some((row) => row.source_key === companyNameAliasKey),
    false,
    'weak company-name identity must not become a standalone canonical source ref when a domain exists',
  );
  assert.ok(
    state.signalRows[0].payload?.source_entity_alias_keys?.includes(companyNameAliasKey),
    'signal payload must retain the company-name alias for entity resolution',
  );
}

try {
  await assertRequiredTablesExist();

  const firstSummary = runIngest();
  const firstState = await queryVerificationState();

  assert.equal(firstState.orgRows.length, 1);
  assert.equal(firstState.signalRows.length, 1);
  assert.equal(firstState.orgRows[0].name, companyName);
  assert.equal(firstState.orgRows[0].domain, companyDomain);
  assert.equal(firstState.orgRows[0].website_url, companyWebsiteUrl);
  assert.equal(firstState.signalRows[0].headline, 'Platform Engineer');
  assert.equal(firstState.signalRows[0].source_url, jobPostingUrl);
  assertIdentityState(firstState);
  assert.deepEqual(firstState.lineageRows, [{
    evidence_tier: 'direct',
    extraction_method: 'unknown',
    url: jobPostingUrl,
  }]);

  const secondSummary = runIngest();
  const secondState = await queryVerificationState();

  assert.equal(secondState.orgRows.length, 1);
  assert.equal(secondState.signalRows.length, 1);
  assertIdentityState(secondState);
  assert.equal(secondSummary.signalUpsertsCompleted, fixtureRecords.length);
  assert.equal(secondSummary.evidenceCreated, 0);
  assert.equal(secondSummary.lineageCreated, 0);

  console.log(JSON.stringify({
    ok: true,
    source: 'career-pages',
    mode: 'db-backed-ingest-verify',
    fixturePath,
    externalId,
    orgDomain: companyDomain,
    firstRun: {
      orgsCreated: firstSummary.orgsCreated,
      signalUpsertsCompleted: firstSummary.signalUpsertsCompleted,
    },
    secondRun: {
      orgsCreated: secondSummary.orgsCreated,
      signalUpsertsCompleted: secondSummary.signalUpsertsCompleted,
    },
    verified: {
      orgRows: secondState.orgRows.length,
      signalRows: secondState.signalRows.length,
      canonicalSourceRefRows: secondState.refRows.length,
      lineageRows: secondState.lineageRows.length,
      weakCompanyNameAliasPreserved: true,
      idempotent: true,
    },
    cleanup: 'isolated-database-retained-for-audit',
  }, null, 2));
} catch (error) {
  throw error;
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
