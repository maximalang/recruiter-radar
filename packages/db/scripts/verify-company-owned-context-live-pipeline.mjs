#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import pg from 'pg';

const { Client } = pg;
const sourceIds = ['company-site', 'company-newsrooms'];

assert.equal(process.env.SOURCE_LIVE_VERIFY, '1', 'SOURCE_LIVE_VERIFY=1 is required.');
assert.equal(
  process.env.SOURCE_IDENTITY_LINEAGE_DB_TEST_ACK,
  'isolated',
  'SOURCE_IDENTITY_LINEAGE_DB_TEST_ACK=isolated is required.',
);
const databaseUrl = process.env.DATABASE_URL?.trim();
assert.ok(databaseUrl, 'DATABASE_URL is required.');

const tempDirectory = mkdtempSync(resolve(tmpdir(), 'rr-company-context-db-'));
const siteTargetsPath = resolve(tempDirectory, 'company-site-targets.json');
const newsroomTargetsPath = resolve(tempDirectory, 'company-newsrooms-targets.json');
writeFileSync(siteTargetsPath, `${JSON.stringify([{
  url: 'https://vk.company/',
  company_name: 'VK',
  company_domain: 'vk.company',
}], null, 2)}\n`, 'utf8');
writeFileSync(newsroomTargetsPath, `${JSON.stringify([{
  url: 'https://vk.company/ru/press/releases/',
  company_name: 'VK',
  company_domain: 'vk.company',
}], null, 2)}\n`, 'utf8');

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  const baseline = await client.query('SELECT clock_timestamp() AS database_started_at');
  const siteMetrics = runSource('source-company-site.mjs', {
    COMPANY_SITE_TARGETS_FILE: siteTargetsPath,
  });
  const newsroomMetrics = runSource('source-company-newsrooms.mjs', {
    COMPANY_NEWSROOMS_TARGETS_FILE: newsroomTargetsPath,
  });

  assert.equal(siteMetrics.source, 'company-site');
  assert.equal(siteMetrics.action, 'pipeline');
  assert.equal(siteMetrics.normalizedRecords, 1);
  assert.equal(siteMetrics.signalUpsertsCompleted, 1);
  assert.equal(newsroomMetrics.source, 'company-newsrooms');
  assert.equal(newsroomMetrics.action, 'pipeline');
  assert.ok(newsroomMetrics.normalizedRecords >= 1);
  assert.equal(newsroomMetrics.signalUpsertsCompleted, newsroomMetrics.normalizedRecords);
  assert.equal(newsroomMetrics.crawlErrors, 0);

  const verified = await client.query(
    `SELECT
       lineage.source,
       COUNT(*)::int AS lineage_rows,
       COUNT(DISTINCT lineage.signal_id)::int AS signals,
       COUNT(DISTINCT lineage.evidence_id)::int AS evidence,
       COUNT(DISTINCT lineage.organization_id)::int AS organizations,
       BOOL_AND(lineage.source_url LIKE 'https://vk.company/%') AS official_source_urls,
       BOOL_AND(lineage.evidence_tier = 'context') AS context_only,
       BOOL_AND(signal.org_id = lineage.organization_id) AS signal_owner_consistent,
       BOOL_AND(evidence.org_id = lineage.organization_id) AS evidence_owner_consistent,
       BOOL_AND(ref.org_id = lineage.organization_id) AS source_ref_owner_consistent,
       BOOL_AND(signal.payload ->> 'source' = lineage.source) AS payload_source_consistent,
       ARRAY_AGG(DISTINCT lineage.extraction_method ORDER BY lineage.extraction_method) AS extraction_methods,
       COUNT(*) FILTER (
         WHERE signal.payload ?| ARRAY['employee_email', 'employee_phone', 'personal_email', 'phone_number', 'mailbox_email']
       )::int AS sensitive_payload_rows
     FROM source_signal_evidence_lineage_v1 lineage
     JOIN signals signal ON signal.id = lineage.signal_id
     JOIN evidence_items evidence ON evidence.id = lineage.evidence_id
     JOIN org_source_refs ref ON ref.org_id = lineage.organization_id AND ref.source = lineage.source
     WHERE lineage.source = ANY($1) AND lineage.created_at >= $2
     GROUP BY lineage.source
     ORDER BY lineage.source`,
    [sourceIds, baseline.rows[0].database_started_at],
  );

  assert.deepEqual(
    verified.rows.map((row) => row.source).sort(),
    [...sourceIds].sort(),
  );
  for (const row of verified.rows) {
    assert.ok(row.lineage_rows > 0, `${row.source} must create lineage`);
    assert.equal(row.signals, row.lineage_rows);
    assert.equal(row.evidence, row.lineage_rows);
    assert.equal(row.organizations, 1);
    assert.equal(row.official_source_urls, true);
    assert.equal(row.context_only, true);
    assert.equal(row.signal_owner_consistent, true);
    assert.equal(row.evidence_owner_consistent, true);
    assert.equal(row.source_ref_owner_consistent, true);
    assert.equal(row.payload_source_consistent, true);
    assert.equal(row.sensitive_payload_rows, 0);
  }
  assert.deepEqual(
    verified.rows.find((row) => row.source === 'company-site').extraction_methods,
    ['live-public'],
  );
  assert.ok(
    verified.rows.find((row) => row.source === 'company-newsrooms').extraction_methods.includes('dated-link'),
  );

  console.log(JSON.stringify({
    ok: true,
    source: 'company-context',
    mode: 'live-fetch-normalize-ingest-evidence-lineage',
    siteMetrics,
    newsroomMetrics,
    sources: verified.rows,
  }, null, 2));
} finally {
  await client.end();
  rmSync(tempDirectory, { recursive: true, force: true });
}

function runSource(scriptName, extraEnv) {
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, scriptName), 'pipeline'], {
    cwd: resolve(import.meta.dirname, '../../..'),
    env: {
      ...process.env,
      ...extraEnv,
      DATABASE_URL: databaseUrl,
      SOURCE_ENV_FILE_DISABLED: 'true',
    },
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${scriptName} live ingest failed: ${[result.stderr, result.stdout].filter(Boolean).join('\n').trim()}`);
  }
  return JSON.parse(result.stdout.trim());
}
