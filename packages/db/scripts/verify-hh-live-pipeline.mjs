#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const { Client } = pg;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const ingestPath = resolve(scriptDir, './ingest-hh.mjs');

if (process.env.HH_LIVE_VERIFY !== '1') {
  throw new Error('HH live verification is opt-in. Set HH_LIVE_VERIFY=1.');
}
if (process.env.SOURCE_IDENTITY_LINEAGE_DB_TEST_ACK !== 'isolated') {
  throw new Error(
    'HH live verification may write only to a disposable isolated database. '
      + 'Set SOURCE_IDENTITY_LINEAGE_DB_TEST_ACK=isolated after verifying DATABASE_URL.',
  );
}

const databaseUrl = process.env.DATABASE_URL?.trim();
const hhUserAgent = process.env.HH_USER_AGENT?.trim();
const hhClientId = process.env.HH_CLIENT_ID?.trim();
const hhClientSecret = process.env.HH_CLIENT_SECRET?.trim();
assert.ok(databaseUrl, 'DATABASE_URL is required.');
assert.ok(hhUserAgent, 'HH_USER_AGENT is required.');
assert.ok(hhClientId, 'credential-not-supplied: HH_CLIENT_ID is required.');
assert.ok(hhClientSecret, 'credential-not-supplied: HH_CLIENT_SECRET is required.');

const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  const baseline = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM signals WHERE source = 'hh') AS signals,
      (SELECT COUNT(*)::int FROM source_signal_evidence_lineage_v1 WHERE source = 'hh') AS lineage,
      clock_timestamp() AS database_started_at
  `);
  const baselineRow = baseline.rows[0];
  assert.equal(baselineRow.signals, 0, 'isolated verifier database must start with zero HH signals');
  assert.equal(baselineRow.lineage, 0, 'isolated verifier database must start with zero HH lineage rows');

  const result = spawnSync(process.execPath, [ingestPath], {
    cwd: resolve(scriptDir, '../../..'),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      HH_USER_AGENT: hhUserAgent,
      HH_SEARCH_TEXT: process.env.HH_SEARCH_TEXT?.trim() || 'recruiter',
      HH_PER_PAGE: process.env.HH_PER_PAGE?.trim() || '2',
      HH_PAGES: process.env.HH_PAGES?.trim() || '1',
      SOURCE_ENV_FILE_DISABLED: 'true',
    },
    encoding: 'utf8',
    timeout: 60_000,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`HH live ingest failed with exit ${result.status}: ${detail}`);
  }

  const metrics = parseLastJsonLine(result.stdout);
  assert.equal(metrics.source, 'hh');
  assert.equal(metrics.action, 'pipeline');
  assert.ok(metrics.recordsReceived > 0, 'HH live fetch returned zero records');
  assert.ok(metrics.normalizedRecords > 0, 'HH live fetch normalized zero records');
  assert.ok(metrics.signalUpsertsCompleted > 0, 'HH live ingest created no signal upserts');
  assert.ok(metrics.evidenceUpsertsCompleted > 0, 'HH live ingest created no evidence upserts');
  assert.ok(metrics.lineageCreated > 0, 'fresh isolated HH ingest created no lineage');

  const verified = await client.query(`
    SELECT
      COUNT(*)::int AS lineage_rows,
      COUNT(DISTINCT lineage.signal_id)::int AS signals,
      COUNT(DISTINCT lineage.evidence_id)::int AS evidence,
      COUNT(DISTINCT lineage.organization_id)::int AS organizations,
      BOOL_AND(lineage.source_url ~ '^https://') AS source_urls_preserved,
      BOOL_AND(lineage.extraction_method = 'hh-api') AS extraction_preserved,
      BOOL_AND(signal.payload ->> 'publisher_type' = 'direct-employer') AS direct_employer_attribution,
      BOOL_AND(signal.org_id = lineage.organization_id) AS signal_owner_consistent,
      BOOL_AND(evidence.org_id = lineage.organization_id) AS evidence_owner_consistent
    FROM source_signal_evidence_lineage_v1 lineage
    JOIN signals signal ON signal.id = lineage.signal_id
    JOIN evidence_items evidence ON evidence.id = lineage.evidence_id
    WHERE lineage.source = 'hh'
      AND lineage.created_at >= $1
  `, [baselineRow.database_started_at]);
  const proof = verified.rows[0];

  assert.ok(proof.lineage_rows > 0, 'HH ingest produced no fresh persisted lineage');
  assert.equal(proof.signals, proof.lineage_rows, 'each HH lineage row must identify one signal');
  assert.equal(proof.evidence, proof.lineage_rows, 'each HH lineage row must identify one evidence item');
  assert.equal(proof.source_urls_preserved, true);
  assert.equal(proof.extraction_preserved, true);
  assert.equal(proof.direct_employer_attribution, true);
  assert.equal(proof.signal_owner_consistent, true);
  assert.equal(proof.evidence_owner_consistent, true);

  console.log(JSON.stringify({
    ok: true,
    source: 'hh',
    mode: 'live-fetch-normalize-ingest-evidence-lineage',
    recordsReceived: metrics.recordsReceived,
    normalizedRecords: metrics.normalizedRecords,
    ...proof,
  }, null, 2));
} finally {
  await client.end();
}

function parseLastJsonLine(stdout) {
  const lines = String(stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch (_error) {
      // Human-readable HH metrics precede the final single-line JSON payload.
    }
  }
  throw new Error('HH ingest did not emit its JSON metrics payload.');
}
