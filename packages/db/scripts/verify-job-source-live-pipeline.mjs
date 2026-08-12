#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import pg from 'pg';

const { Client } = pg;
const sourceId = process.argv[2]?.trim();
const sourceConfig = {
  superjob: {
    script: './source-superjob.mjs',
    env: {
      SUPERJOB_KEYWORD: process.env.SUPERJOB_KEYWORD?.trim() || 'рекрутер',
      SUPERJOB_PER_PAGE: process.env.SUPERJOB_PER_PAGE?.trim() || '100',
      SUPERJOB_PAGES: process.env.SUPERJOB_PAGES?.trim() || '1',
    },
  },
  'rabota-rossii': {
    script: './source-rabota-rossii.mjs',
    env: {
      RABOTA_ROSSII_SEARCH_TEXT: process.env.RABOTA_ROSSII_SEARCH_TEXT?.trim() || 'разработчик',
      RABOTA_ROSSII_LIMIT: process.env.RABOTA_ROSSII_LIMIT?.trim() || '20',
      RABOTA_ROSSII_PAGES: process.env.RABOTA_ROSSII_PAGES?.trim() || '1',
      // Keep the disposable proof bounded to one official federal window. The
      // production adapter's multi-region breadth has separate confidence tests.
      RABOTA_ROSSII_REGION_CODES: process.env.RABOTA_ROSSII_REGION_CODES?.trim() || 'federal',
    },
  },
}[sourceId];

assert.ok(sourceConfig, 'Usage: verify-job-source-live-pipeline.mjs <superjob|rabota-rossii>');
if (process.env.SOURCE_LIVE_VERIFY !== '1') {
  throw new Error('Live source verification is opt-in. Set SOURCE_LIVE_VERIFY=1.');
}
if (process.env.SOURCE_IDENTITY_LINEAGE_DB_TEST_ACK !== 'isolated') {
  throw new Error('SOURCE_IDENTITY_LINEAGE_DB_TEST_ACK=isolated is required.');
}

const databaseUrl = process.env.DATABASE_URL?.trim();
assert.ok(databaseUrl, 'DATABASE_URL is required.');

const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  const baseline = await client.query(
    `SELECT
       (SELECT COUNT(*)::int FROM signals WHERE source = $1) AS signals,
       (SELECT COUNT(*)::int FROM source_signal_evidence_lineage_v1 WHERE source = $1) AS lineage,
       clock_timestamp() AS database_started_at`,
    [sourceId],
  );
  assert.equal(baseline.rows[0].signals, 0, 'isolated database must start with zero source signals');
  assert.equal(baseline.rows[0].lineage, 0, 'isolated database must start with zero source lineage');

  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, sourceConfig.script), 'pipeline'], {
    cwd: resolve(import.meta.dirname, '../../..'),
    env: {
      ...process.env,
      ...sourceConfig.env,
      DATABASE_URL: databaseUrl,
      SOURCE_ENV_FILE_DISABLED: 'true',
    },
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${sourceId} live ingest failed: ${[result.stderr, result.stdout].filter(Boolean).join('\n').trim()}`);
  }

  const metrics = JSON.parse(result.stdout.trim());
  assert.equal(metrics.source, sourceId);
  assert.equal(metrics.action, 'pipeline');
  assert.ok(metrics.recordsReceived > 0, 'live fetch returned zero records');
  assert.ok(metrics.normalizedRecords > 0, 'live fetch normalized zero records');
  assert.ok(metrics.signalUpsertsCompleted > 0, 'live ingest created no signals');
  assert.ok(metrics.evidenceUpsertsCompleted > 0, 'live ingest created no evidence');
  assert.ok(metrics.lineageCreated > 0, 'live ingest created no lineage');

  const verified = await client.query(
    `SELECT
       COUNT(*)::int AS lineage_rows,
       COUNT(DISTINCT lineage.signal_id)::int AS signals,
       COUNT(DISTINCT lineage.evidence_id)::int AS evidence,
       COUNT(DISTINCT lineage.organization_id)::int AS organizations,
       BOOL_AND(lineage.source_url ~ '^https://') AS source_urls_preserved,
       BOOL_AND(lineage.extraction_method = 'live-public') AS extraction_preserved,
       BOOL_AND(signal.org_id = lineage.organization_id) AS signal_owner_consistent,
       BOOL_AND(evidence.org_id = lineage.organization_id) AS evidence_owner_consistent,
       COUNT(*) FILTER (WHERE signal.payload ? 'candidate_eligible')::int AS eligibility_rows,
       COUNT(*) FILTER (WHERE signal.payload ->> 'publisher_type' = 'direct-employer')::int AS direct_employer_rows,
       COUNT(*) FILTER (WHERE signal.payload ->> 'publisher_type' <> 'direct-employer')::int AS non_direct_rows,
       COUNT(*) FILTER (
         WHERE (signal.payload ->> 'candidate_eligible')::boolean
           IS DISTINCT FROM (signal.payload ->> 'publisher_type' = 'direct-employer')
       )::int AS invalid_publisher_eligibility_rows,
       COUNT(*) FILTER (WHERE signal.occurred_at >= clock_timestamp() - INTERVAL '30 days')::int AS fresh_rows,
       COUNT(*) FILTER (WHERE signal.payload ?| ARRAY[
         'employee_email', 'employee_phone', 'personal_email', 'phone_number'
       ])::int AS sensitive_payload_rows,
       BOOL_AND(
         CASE WHEN signal.payload ? 'candidate_eligible'
           THEN (signal.payload ->> 'candidate_eligible') IN ('true', 'false')
           ELSE TRUE
         END
       ) AS eligibility_valid
     FROM source_signal_evidence_lineage_v1 lineage
     JOIN signals signal ON signal.id = lineage.signal_id
     JOIN evidence_items evidence ON evidence.id = lineage.evidence_id
     WHERE lineage.source = $1 AND lineage.created_at >= $2`,
    [sourceId, baseline.rows[0].database_started_at],
  );
  const proof = verified.rows[0];
  assert.ok(proof.lineage_rows > 0);
  assert.equal(proof.signals, proof.lineage_rows);
  assert.equal(proof.evidence, proof.lineage_rows);
  assert.equal(proof.source_urls_preserved, true);
  assert.equal(proof.extraction_preserved, true);
  assert.equal(proof.signal_owner_consistent, true);
  assert.equal(proof.evidence_owner_consistent, true);
  assert.equal(proof.eligibility_valid, true);
  if (sourceId === 'superjob') {
    assert.equal(proof.eligibility_rows, proof.lineage_rows, 'every SuperJob signal must declare candidate eligibility');
    assert.ok(proof.direct_employer_rows > 0, 'SuperJob live sample must include direct-employer vacancies');
    assert.ok(proof.non_direct_rows > 0, 'SuperJob live sample must exercise non-direct publisher rejection');
    assert.equal(proof.invalid_publisher_eligibility_rows, 0, 'publisher attribution and eligibility must agree');
    assert.ok(proof.fresh_rows / proof.lineage_rows >= 0.8, 'at least 80% of SuperJob live vacancies must be fresh within 30 days');
    assert.equal(proof.sensitive_payload_rows, 0, 'SuperJob payload must not retain personal contact fields');
  }

  console.log(JSON.stringify({ ok: true, source: sourceId, mode: 'live-fetch-normalize-ingest-evidence-lineage', ...proof }, null, 2));
} finally {
  await client.end();
}
