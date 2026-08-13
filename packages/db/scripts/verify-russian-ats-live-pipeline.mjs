#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import pg from 'pg';

const { Client } = pg;
assert.equal(process.env.SOURCE_LIVE_VERIFY, '1', 'SOURCE_LIVE_VERIFY=1 is required.');
assert.equal(
  process.env.SOURCE_IDENTITY_LINEAGE_DB_TEST_ACK,
  'isolated',
  'SOURCE_IDENTITY_LINEAGE_DB_TEST_ACK=isolated is required.',
);
const databaseUrl = process.env.DATABASE_URL?.trim();
assert.ok(databaseUrl, 'DATABASE_URL is required.');

const tempDirectory = mkdtempSync(resolve(tmpdir(), 'rr-russian-ats-db-'));
const targetsFilePath = resolve(tempDirectory, 'targets.json');
const targets = [
  ['huntflow', 'hate agency', 'hateagency.com', 'https://hatehr.huntflow.io/'],
  ['friendwork', 'GGSEL', 'ggsel.net', 'https://jobs.friend.work/ggsel'],
].map(([family, companyName, companyDomain, sourceUrl]) => ({
  id: `${family}-db-live`,
  adapter: 'hosted-career-page',
  hosted_ats_family: family,
  company_name: companyName,
  company_domain: companyDomain,
  company_website_url: `https://${companyDomain}/`,
  career_page_url: sourceUrl,
  source_url: sourceUrl,
}));
writeFileSync(targetsFilePath, `${JSON.stringify({ targets }, null, 2)}\n`, 'utf8');

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  const baseline = await client.query('SELECT clock_timestamp() AS database_started_at');
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, './source-career-pages.mjs'), 'pipeline'], {
    cwd: resolve(import.meta.dirname, '../../..'),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      CAREER_PAGES_TARGETS_FILE: targetsFilePath,
      CAREER_PAGES_FETCH_BUDGET_MS: '0',
      CAREER_PAGES_RENDER_SETTLE_MS: '5000',
      SOURCE_ENV_FILE_DISABLED: 'true',
    },
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Russian ATS live ingest failed: ${[result.stderr, result.stdout].filter(Boolean).join('\n').trim()}`);
  }

  const metrics = JSON.parse(result.stdout.trim());
  assert.equal(metrics.action, 'pipeline');
  assert.ok(metrics.recordsReceived > 0);
  assert.equal(metrics.normalizedRecords, metrics.recordsReceived);
  assert.equal(metrics.signalUpsertsCompleted, metrics.recordsReceived);
  assert.equal(metrics.evidenceUpsertsCompleted, metrics.recordsReceived);

  const verified = await client.query(
    `SELECT
       signal.payload -> 'raw' ->> 'hosted_ats_family' AS family,
       COUNT(*)::int AS lineage_rows,
       COUNT(DISTINCT lineage.signal_id)::int AS signals,
       COUNT(DISTINCT lineage.evidence_id)::int AS evidence,
       COUNT(DISTINCT lineage.organization_id)::int AS organizations,
       BOOL_AND(lineage.source_url ~ '^https://') AS source_urls_preserved,
       BOOL_AND(lineage.evidence_tier = 'direct') AS direct_evidence_preserved,
       BOOL_AND(lineage.extraction_method IN ('html-card-fallback', 'playwright-dom')) AS extraction_preserved,
       BOOL_AND(signal.org_id = lineage.organization_id) AS signal_owner_consistent,
       BOOL_AND(evidence.org_id = lineage.organization_id) AS evidence_owner_consistent,
       BOOL_AND(signal.payload ->> 'source' = 'career-pages') AS payload_source_consistent,
       BOOL_AND(EXISTS (
         SELECT 1 FROM org_source_refs ref
         WHERE ref.org_id = lineage.organization_id AND ref.source = 'career-pages'
       )) AS source_ref_owner_consistent,
       COUNT(*) FILTER (WHERE signal.payload ?| ARRAY[
         'employee_email', 'employee_phone', 'personal_email', 'phone_number', 'mailbox_email'
       ])::int AS sensitive_payload_rows
     FROM source_signal_evidence_lineage_v1 lineage
     JOIN signals signal ON signal.id = lineage.signal_id
     JOIN evidence_items evidence ON evidence.id = lineage.evidence_id
     WHERE lineage.source = 'career-pages'
       AND lineage.created_at >= $1
       AND signal.payload -> 'raw' ->> 'hosted_ats_family' IN ('huntflow', 'friendwork')
     GROUP BY signal.payload -> 'raw' ->> 'hosted_ats_family'
     ORDER BY family`,
    [baseline.rows[0].database_started_at],
  );
  assert.deepEqual(verified.rows.map((row) => row.family), ['friendwork', 'huntflow']);
  for (const row of verified.rows) {
    assert.ok(row.lineage_rows > 0);
    assert.equal(row.signals, row.lineage_rows);
    assert.equal(row.evidence, row.lineage_rows);
    assert.equal(row.organizations, 1);
    assert.equal(row.source_urls_preserved, true);
    assert.equal(row.direct_evidence_preserved, true);
    assert.equal(row.extraction_preserved, true);
    assert.equal(row.signal_owner_consistent, true);
    assert.equal(row.evidence_owner_consistent, true);
    assert.equal(row.payload_source_consistent, true);
    assert.equal(row.source_ref_owner_consistent, true);
    assert.equal(row.sensitive_payload_rows, 0);
  }

  console.log(JSON.stringify({
    ok: true,
    source: 'russian-ats',
    mode: 'public-page-normalized-db-signal-evidence-lineage',
    recordsReceived: metrics.recordsReceived,
    families: verified.rows,
  }, null, 2));
} finally {
  await client.end();
  rmSync(tempDirectory, { recursive: true, force: true });
}
