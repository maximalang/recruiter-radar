#!/usr/bin/env node

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import pg from 'pg';

const { Client } = pg;
const sourceIds = ['fns-open-data', 'government-procurement', 'cbr-registry', 'rosstat-open-data', 'rospatent-open-data'];
const fixturePath = resolve(import.meta.dirname, './government-open-data-smoke-fixture.json');
const verifyLiveRospatentSnapshot = process.env.ROSPATENT_LIVE_SNAPSHOT_VERIFY === '1';

assert.equal(process.env.SOURCE_LIVE_VERIFY, '1', 'SOURCE_LIVE_VERIFY=1 is required.');
assert.equal(process.env.SOURCE_IDENTITY_LINEAGE_DB_TEST_ACK, 'isolated', 'SOURCE_IDENTITY_LINEAGE_DB_TEST_ACK=isolated is required.');
const databaseUrl = process.env.DATABASE_URL?.trim();
assert.ok(databaseUrl, 'DATABASE_URL is required.');

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  const baseline = await client.query('SELECT clock_timestamp() AS database_started_at');
  const metrics = [
    runSource('source-fns-open-data.mjs', { FNS_OPEN_DATA_INPUT_FILE: fixturePath }),
    runSource('source-government-procurement.mjs', { GOVERNMENT_PROCUREMENT_INPUT_FILE: fixturePath }),
    runSource('source-cbr-registry.mjs', {}),
    runSource('source-rosstat-open-data.mjs', { ROSSTAT_OPEN_DATA_INPUT_FILE: fixturePath }),
    runSource('source-rospatent-open-data.mjs', verifyLiveRospatentSnapshot ? {} : { ROSPATENT_OPEN_DATA_INPUT_FILE: fixturePath }),
  ];

  assert.deepEqual(metrics.map((item) => item.source), sourceIds);
  for (const item of metrics) {
    assert.ok(item.normalizedRecords > 0, `${item.source} must normalize records`);
    assert.equal(item.signalUpsertsCompleted, item.normalizedRecords);
    assert.equal(item.evidenceUpsertsCompleted, item.normalizedRecords);
  }
  assert.equal(metrics.find((item) => item.source === 'cbr-registry').inputMode, 'live-public');
  const rospatentMetrics = metrics.find((item) => item.source === 'rospatent-open-data');
  assert.equal(rospatentMetrics.inputMode, verifyLiveRospatentSnapshot ? 'active-snapshot' : 'file');
  assert.ok(rospatentMetrics.normalizedRecords > 0);

  const verified = await client.query(
    `SELECT
       lineage.source,
       COUNT(*)::int AS lineage_rows,
       COUNT(DISTINCT lineage.signal_id)::int AS signals,
       COUNT(DISTINCT lineage.evidence_id)::int AS evidence,
       COUNT(DISTINCT lineage.organization_id)::int AS organizations,
       BOOL_AND(lineage.source_url ~ '^https://') AS source_urls_preserved,
       BOOL_AND(lineage.evidence_tier = 'context') AS context_only,
       BOOL_AND(signal.org_id = lineage.organization_id) AS signal_owner_consistent,
       BOOL_AND(evidence.org_id = lineage.organization_id) AS evidence_owner_consistent,
       BOOL_AND(EXISTS (
         SELECT 1
         FROM org_source_refs ref
         WHERE ref.org_id = lineage.organization_id
           AND ref.source = lineage.source
       )) AS source_ref_owner_consistent,
       BOOL_AND(signal.payload ->> 'source' = lineage.source) AS payload_source_consistent,
       BOOL_AND(COALESCE((signal.payload ->> 'hiring_proof')::boolean, false) = false) AS never_hiring_proof,
       COUNT(*) FILTER (
         WHERE signal.payload ?| ARRAY['email', 'phone', 'phones', 'employee_email', 'employee_phone', 'personal_email', 'phone_number', 'mailbox_email']
       )::int AS sensitive_payload_rows
     FROM source_signal_evidence_lineage_v1 lineage
     JOIN signals signal ON signal.id = lineage.signal_id
     JOIN evidence_items evidence ON evidence.id = lineage.evidence_id
     WHERE lineage.source = ANY($1) AND lineage.created_at >= $2
     GROUP BY lineage.source
     ORDER BY lineage.source`,
    [sourceIds, baseline.rows[0].database_started_at],
  );

  assert.deepEqual(verified.rows.map((row) => row.source).sort(), [...sourceIds].sort());
  for (const row of verified.rows) {
    assert.ok(row.lineage_rows > 0, `${row.source} must create lineage`);
    assert.equal(row.signals, row.lineage_rows);
    assert.ok(row.evidence > 0, `${row.source} must create evidence`);
    assert.ok(row.evidence <= row.lineage_rows, `${row.source} may reuse one official record across derived signals`);
    assert.equal(row.source_urls_preserved, true);
    assert.equal(row.context_only, true);
    assert.equal(row.signal_owner_consistent, true);
    assert.equal(row.evidence_owner_consistent, true);
    assert.equal(row.source_ref_owner_consistent, true);
    assert.equal(row.payload_source_consistent, true);
    assert.equal(row.never_hiring_proof, true);
    assert.equal(row.sensitive_payload_rows, 0);
  }

  const rosstat = await client.query(
    `SELECT COUNT(*)::int AS company_attributed
     FROM signals
     WHERE source = 'rosstat-open-data'
       AND (payload ->> 'company_attributed')::boolean IS DISTINCT FROM false`,
  );
  assert.equal(rosstat.rows[0].company_attributed, 0);

  console.log(JSON.stringify({
    ok: true,
    source: 'government-open-data',
    mode: 'snapshot-plus-live-cbr-normalize-ingest-evidence-lineage',
    metrics,
    sources: verified.rows,
  }, null, 2));
} finally {
  await client.end();
}

function runSource(scriptName, extraEnv) {
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, scriptName), 'pipeline'], {
    cwd: resolve(import.meta.dirname, '../../..'),
    env: {
      ...process.env,
      ...extraEnv,
      DATABASE_URL: databaseUrl,
      GOVERNMENT_ENRICHMENT_INNS: '7707083893',
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
