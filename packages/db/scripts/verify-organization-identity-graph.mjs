#!/usr/bin/env node

import assert from 'node:assert/strict';
import pg from 'pg';

import { auditOrganizationIdentityGraph } from './adapters/organization-identity-graph-audit.mjs';

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();
assert.ok(databaseUrl, 'DATABASE_URL is required.');

const jsonOutput = process.argv.includes('--json');
const reportOnly = process.argv.includes('--report-only');
const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
await client.connect();

try {
  const [refsResult, orgsResult] = await Promise.all([
    client.query(`
      SELECT org_id::TEXT AS org_id, source, source_key
      FROM org_source_refs
      WHERE source_key ~* '^(inn|ogrn|domain):'
      ORDER BY source_key, org_id, source
    `),
    client.query(`
      SELECT id::TEXT AS id, domain
      FROM orgs
      WHERE NULLIF(BTRIM(domain), '') IS NOT NULL
      ORDER BY id
    `),
  ]);

  const report = auditOrganizationIdentityGraph(refsResult.rows, orgsResult.rows);
  const output = {
    ...report,
    generatedAt: new Date().toISOString(),
  };

  if (jsonOutput) console.log(JSON.stringify(output));
  else printHuman(output);

  if (!reportOnly && !report.pass) process.exitCode = 1;
} finally {
  await client.end();
}

function printHuman(report) {
  console.log('=== ORGANIZATION IDENTITY GRAPH AUDIT ===');
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Strong identity keys: ${report.strongIdentityKeys}`);
  console.log(`Strong identity links: ${report.strongIdentityLinks}`);
  console.log(`Cross-owner strong-key conflicts: ${report.strongIdentityConflicts.length}`);
  console.log(`Invalid strong refs: ${report.invalidStrongRefs.length}`);
  console.log(`Platform-domain refs: ${report.platformDomainRefs.length}`);
  console.log(`Organization-domain mismatches: ${report.orgDomainMismatches.length}`);
  console.log(`Identity graph: ${report.pass ? 'PASS' : 'FAIL'}`);

  for (const conflict of report.strongIdentityConflicts.slice(0, 20)) {
    console.log(`  conflict ${conflict.strongKey} -> ${conflict.orgIds.join(', ')}`);
  }
  for (const mismatch of report.orgDomainMismatches.slice(0, 20)) {
    console.log(`  domain mismatch org=${mismatch.orgId} org.domain=${mismatch.orgDomain} refs=${mismatch.strongDomains.join(',')}`);
  }
}
