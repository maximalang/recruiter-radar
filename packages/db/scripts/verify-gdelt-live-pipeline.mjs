#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import pg from 'pg';

const { Client } = pg;
const sourceId = 'funding-business-signals';

assert.equal(process.env.SOURCE_LIVE_VERIFY, '1', 'SOURCE_LIVE_VERIFY=1 is required.');
assert.equal(
  process.env.SOURCE_IDENTITY_LINEAGE_DB_TEST_ACK,
  'isolated',
  'SOURCE_IDENTITY_LINEAGE_DB_TEST_ACK=isolated is required.',
);
const databaseUrl = process.env.DATABASE_URL?.trim();
assert.ok(databaseUrl, 'DATABASE_URL is required.');

const companyName = process.env.GDELT_VERIFY_COMPANY_NAME?.trim() || 'Yandex';
const companyDomain = process.env.GDELT_VERIFY_COMPANY_DOMAIN?.trim() || 'yandex.ru';
const query = process.env.GDELT_VERIFY_QUERY?.trim()
  || '"Yandex" (expansion OR hiring OR launch OR office)';
const queryConfig = JSON.stringify([{
  query,
  company_name: companyName,
  company_domain: companyDomain,
  max_records: 5,
  timespan: '30d',
}]);

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  const baseline = await client.query('SELECT clock_timestamp() AS database_started_at');
  const result = spawnSync(
    process.execPath,
    [resolve(import.meta.dirname, './source-funding-business-signals.mjs'), 'pipeline'],
    {
      cwd: resolve(import.meta.dirname, '../../..'),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        FUNDING_SIGNALS_GDELT_QUERIES_JSON: queryConfig,
        FUNDING_SIGNALS_GDELT_MAX_ATTEMPTS: '1',
        SOURCE_ENV_FILE_DISABLED: 'true',
      },
      encoding: 'utf8',
      timeout: 90_000,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `GDELT live ingest failed with exit ${result.status}: `
        + [result.stderr, result.stdout].filter(Boolean).join('\n').trim(),
    );
  }

  const metrics = JSON.parse(result.stdout);
  assert.equal(metrics.source, sourceId);
  assert.equal(metrics.action, 'pipeline');
  assert.equal(metrics.inputMode, 'live-public');
  assert.ok(metrics.recordsReceived > 0, 'GDELT live query returned zero articles');
  assert.ok(metrics.normalizedRecords > 0, 'GDELT live query normalized zero articles');
  assert.ok(metrics.signalUpsertsCompleted > 0, 'GDELT live ingest created no signals');
  assert.ok(metrics.evidenceUpsertsCompleted > 0, 'GDELT live ingest created no evidence');
  assert.ok(metrics.lineageCreated > 0, 'GDELT live ingest created no lineage');

  const verified = await client.query(
    `SELECT
       COUNT(*)::int AS lineage_rows,
       COUNT(DISTINCT lineage.signal_id)::int AS signals,
       COUNT(DISTINCT lineage.evidence_id)::int AS evidence,
       COUNT(DISTINCT lineage.organization_id)::int AS organizations,
       BOOL_AND(lineage.evidence_tier = 'context') AS context_only,
       BOOL_AND(lineage.extraction_method = 'live-public') AS live_extraction,
       BOOL_AND(signal.org_id = lineage.organization_id) AS signal_owner_consistent,
       BOOL_AND(evidence.org_id = lineage.organization_id) AS evidence_owner_consistent,
       BOOL_AND(EXISTS (
         SELECT 1
         FROM org_source_refs ref
         WHERE ref.org_id = lineage.organization_id AND ref.source = lineage.source
       )) AS source_ref_owner_consistent,
       BOOL_AND(signal.payload ->> 'evidence_role' = 'context') AS payload_context_only,
       BOOL_AND(signal.payload ->> 'company_domain' = $1) AS identity_bound_domain,
       BOOL_AND(NULLIF(signal.payload ->> 'publisher_domain', '') IS NOT NULL) AS publisher_attributed,
       COUNT(*) FILTER (
         WHERE signal.payload ?| ARRAY[
           'employee_email', 'employee_phone', 'personal_email', 'phone_number',
           'subscriber', 'subscriber_list', 'user_profile'
         ]
       )::int AS sensitive_payload_rows
     FROM source_signal_evidence_lineage_v1 lineage
     JOIN signals signal ON signal.id = lineage.signal_id
     JOIN evidence_items evidence ON evidence.id = lineage.evidence_id
     WHERE lineage.source = $2 AND lineage.created_at >= $3`,
    [companyDomain, sourceId, baseline.rows[0].database_started_at],
  );
  const proof = verified.rows[0];
  assert.ok(proof.lineage_rows > 0);
  assert.equal(proof.signals, proof.lineage_rows);
  assert.equal(proof.evidence, proof.lineage_rows);
  assert.equal(proof.organizations, 1);
  assert.equal(proof.context_only, true);
  assert.equal(proof.live_extraction, true);
  assert.equal(proof.signal_owner_consistent, true);
  assert.equal(proof.evidence_owner_consistent, true);
  assert.equal(proof.source_ref_owner_consistent, true);
  assert.equal(proof.payload_context_only, true);
  assert.equal(proof.identity_bound_domain, true);
  assert.equal(proof.publisher_attributed, true);
  assert.equal(proof.sensitive_payload_rows, 0);

  console.log(JSON.stringify({
    ok: true,
    source: sourceId,
    mode: 'gdelt-article-organization-context-db-evidence-lineage',
    metrics,
    proof,
  }, null, 2));
} finally {
  await client.end();
}
