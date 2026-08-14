#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import pg from 'pg';

const { Client } = pg;
const allSourceIds = ['greenhouse', 'lever', 'ashby', 'recruitee', 'workable', 'smartrecruiters'];
const excludedSourceIds = new Set(
  (process.env.PUBLIC_ATS_LIVE_EXCLUDE ?? '').split(',').map((value) => value.trim()).filter(Boolean),
);
for (const sourceId of excludedSourceIds) {
  assert.ok(allSourceIds.includes(sourceId), `Unknown PUBLIC_ATS_LIVE_EXCLUDE source: ${sourceId}`);
}
const sourceIds = allSourceIds.filter((sourceId) => !excludedSourceIds.has(sourceId));
const expectedExtraction = {
  greenhouse: 'greenhouse-api',
  lever: 'lever-api',
  ashby: 'ashby-public-api',
  recruitee: 'recruitee-careers-api',
  workable: 'workable-public-api',
  smartrecruiters: null,
};
const targets = [
  { id: 'discord-greenhouse-live', adapter: 'greenhouse-board', company_name: 'Discord', company_domain: 'discord.com', company_website_url: 'https://discord.com/', career_page_url: 'https://boards.greenhouse.io/discord', source_url: 'https://boards-api.greenhouse.io/v1/boards/discord/jobs?content=true' },
  { id: 'dnb-lever-live', adapter: 'lever-postings', company_name: 'Dun & Bradstreet', company_domain: 'dnb.com', company_website_url: 'https://www.dnb.com/', career_page_url: 'https://jobs.lever.co/dnb', source_url: 'https://api.lever.co/v0/postings/dnb?mode=json' },
  { id: 'ashby-live', adapter: 'ashby-job-board', company_name: 'Ashby', company_domain: 'ashbyhq.com', company_website_url: 'https://www.ashbyhq.com/', career_page_url: 'https://jobs.ashbyhq.com/Ashby', source_url: 'https://api.ashbyhq.com/posting-api/job-board/Ashby?includeCompensation=true' },
  { id: 'framestore-recruitee-live', adapter: 'recruitee-careers', company_name: 'Framestore', company_domain: 'framestore.com', company_website_url: 'https://www.framestore.com/', career_page_url: 'https://framestore.recruitee.com', source_url: 'https://framestore.recruitee.com/api/offers/' },
  { id: 'blue-altair-workable-live', adapter: 'workable-public-jobs', company_name: 'Blue Altair', company_domain: 'bluealtair.com', company_website_url: 'https://www.bluealtair.com/', career_page_url: 'https://apply.workable.com/blue-altair/', source_url: 'https://www.workable.com/api/accounts/blue-altair?details=true' },
  process.env.SMARTRECRUITERS_LIVE_PUBLIC_CAREERS === '1'
    ? { id: 'smartrecruiters-public-careers-live', adapter: 'smartrecruiters-public-careers', company_name: 'SmartRecruiters Inc', company_domain: 'smartrecruiters.com', company_website_url: 'https://www.smartrecruiters.com/', career_page_url: 'https://careers.smartrecruiters.com/smartrecruiters', source_url: 'https://careers.smartrecruiters.com/smartrecruiters' }
    : { id: 'smartrecruiters-live', adapter: 'smartrecruiters-postings', company_name: 'SmartRecruiters Inc', company_domain: 'smartrecruiters.com', company_website_url: 'https://www.smartrecruiters.com/', career_page_url: 'https://careers.smartrecruiters.com/smartrecruiters', source_url: 'https://api.smartrecruiters.com/v1/companies/smartrecruiters/postings?limit=100&offset=0' },
].filter((target) => !excludedSourceIds.has({
  'greenhouse-board': 'greenhouse',
  'lever-postings': 'lever',
  'ashby-job-board': 'ashby',
  'recruitee-careers': 'recruitee',
  'workable-public-jobs': 'workable',
  'smartrecruiters-postings': 'smartrecruiters',
  'smartrecruiters-public-careers': 'smartrecruiters',
}[target.adapter]));

assert.equal(process.env.SOURCE_LIVE_VERIFY, '1', 'SOURCE_LIVE_VERIFY=1 is required.');
assert.equal(process.env.SOURCE_IDENTITY_LINEAGE_DB_TEST_ACK, 'isolated', 'SOURCE_IDENTITY_LINEAGE_DB_TEST_ACK=isolated is required.');
const databaseUrl = process.env.DATABASE_URL?.trim();
assert.ok(databaseUrl, 'DATABASE_URL is required.');

const tempDirectory = mkdtempSync(resolve(tmpdir(), 'rr-public-ats-db-'));
const targetsFilePath = resolve(tempDirectory, 'targets.json');
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
      SOURCE_ENV_FILE_DISABLED: 'true',
    },
    encoding: 'utf8',
    timeout: 420_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`public ATS live ingest failed: ${[result.stderr, result.stdout].filter(Boolean).join('\n').trim()}`);
  }

  const metrics = JSON.parse(result.stdout.trim());
  assert.equal(metrics.action, 'pipeline');
  assert.ok(
    metrics.recordsReceived > 0,
    `public ATS live run returned no records: ${JSON.stringify(metrics.targetResults ?? [])}`,
  );
  assert.equal(metrics.normalizedRecords, metrics.recordsReceived);
  assert.equal(metrics.signalUpsertsCompleted, metrics.recordsReceived);
  assert.equal(metrics.evidenceUpsertsCompleted, metrics.recordsReceived);

  const verified = await client.query(
    `SELECT
       lineage.source,
       COUNT(*)::int AS lineage_rows,
       COUNT(DISTINCT lineage.signal_id)::int AS signals,
       COUNT(DISTINCT lineage.evidence_id)::int AS evidence,
       COUNT(DISTINCT lineage.organization_id)::int AS organizations,
       BOOL_AND(lineage.source_url ~ '^https://') AS source_urls_preserved,
       BOOL_AND(lineage.evidence_tier = 'direct') AS direct_evidence_preserved,
       BOOL_AND(signal.org_id = lineage.organization_id) AS signal_owner_consistent,
       BOOL_AND(evidence.org_id = lineage.organization_id) AS evidence_owner_consistent,
       BOOL_AND(signal.payload ->> 'source' = lineage.source) AS payload_source_consistent,
       BOOL_AND(ref.org_id = lineage.organization_id) AS source_ref_owner_consistent,
       BOOL_AND(ref.source = lineage.source) AS source_ref_namespace_consistent,
       ARRAY_AGG(DISTINCT lineage.extraction_method ORDER BY lineage.extraction_method) AS extraction_methods,
       ARRAY_REMOVE(ARRAY_AGG(DISTINCT signal.payload ->> 'source_transport'), NULL) AS source_transports,
       COUNT(*) FILTER (WHERE signal.payload ?| ARRAY['employee_email', 'employee_phone', 'personal_email', 'phone_number', 'mailbox_email'])::int AS sensitive_payload_rows
     FROM source_signal_evidence_lineage_v1 lineage
     JOIN signals signal ON signal.id = lineage.signal_id
     JOIN evidence_items evidence ON evidence.id = lineage.evidence_id
     JOIN org_source_refs ref ON ref.org_id = lineage.organization_id AND ref.source = lineage.source
     WHERE lineage.source = ANY($1) AND lineage.created_at >= $2
     GROUP BY lineage.source
     ORDER BY lineage.source`,
    [sourceIds, baseline.rows[0].database_started_at],
  );
  assert.deepEqual(verified.rows.map((row) => row.source).sort(), [...sourceIds].sort());

  for (const row of verified.rows) {
    assert.ok(row.lineage_rows > 0, `${row.source} must create lineage`);
    assert.equal(row.signals, row.lineage_rows, `${row.source} signal count must match lineage`);
    assert.equal(row.evidence, row.lineage_rows, `${row.source} evidence count must match lineage`);
    assert.equal(row.source_urls_preserved, true);
    assert.equal(row.direct_evidence_preserved, true);
    assert.equal(row.signal_owner_consistent, true);
    assert.equal(row.evidence_owner_consistent, true);
    assert.equal(row.payload_source_consistent, true);
    assert.equal(row.source_ref_owner_consistent, true);
    assert.equal(row.source_ref_namespace_consistent, true);
    if (row.source === 'smartrecruiters') {
      assert.ok(row.extraction_methods.every((method) => [
        'smartrecruiters-posting-api',
        'jsonld',
        'html-card-fallback',
        'playwright-jsonld',
        'playwright-dom',
      ].includes(method)), 'SmartRecruiters must use an official or public-careers extraction method');
      assert.ok(row.source_transports.length > 0, 'SmartRecruiters transport must be persisted separately');
      assert.ok(row.source_transports.every((transport) => [
        'official-api',
        'public-careers-rendered',
        'static-public-careers',
      ].includes(transport)), 'SmartRecruiters transport must be auditable');
    } else {
      assert.deepEqual(row.extraction_methods, [expectedExtraction[row.source]]);
    }
    assert.equal(row.sensitive_payload_rows, 0);
  }

  console.log(JSON.stringify({
    ok: true,
    source: 'public-ats',
    mode: 'live-fetch-normalize-ingest-evidence-lineage',
    recordsReceived: metrics.recordsReceived,
    sensitiveFieldsDropped: metrics.sensitiveFieldsDropped,
    excludedSources: [...excludedSourceIds],
    sources: verified.rows,
  }, null, 2));
} finally {
  await client.end();
  rmSync(tempDirectory, { recursive: true, force: true });
}
