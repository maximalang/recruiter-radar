#!/usr/bin/env node

import assert from 'node:assert/strict';
import pg from 'pg';

import {
  collectHhEmployerIds,
  fetchHhEmployerDetails,
} from './adapters/hh-employer-enrichment.mjs';
import {
  buildHhEmployersMissingIdentityQuery,
  persistHhEmployerIdentity,
} from './adapters/hh-employer-identity-persistence.mjs';
import {
  resolveHhProxyDispatcher,
  resolveHhProxyFetch,
} from './adapters/hh.mjs';
import { loadEnvFile } from './lib/common-utils.mjs';

const { Client } = pg;
loadEnvFile();

const databaseUrl = process.env.DATABASE_URL?.trim();
const userAgent = process.env.HH_USER_AGENT?.trim();
const limit = resolveLimit(process.env.HH_EMPLOYER_IDENTITY_LIMIT);
const jsonOutput = process.argv.includes('--json');

assert.ok(databaseUrl, 'DATABASE_URL is required.');
assert.ok(userAgent, 'HH_USER_AGENT is required.');

const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
await client.connect();
const stats = {
  candidates: 0,
  detailsRequested: 0,
  cacheHits: 0,
  detailFailures: 0,
  enriched: 0,
  noSite: 0,
  conflicts: 0,
  rejected: 0,
  truncated: false,
  truncatedEmployers: 0,
};

try {
  const candidates = await client.query(
    `${buildHhEmployersMissingIdentityQuery()}\nLIMIT $1::INTEGER`,
    [limit],
  );
  stats.candidates = candidates.rows.length;
  const syntheticVacancies = candidates.rows.map((row) => ({
    employer: { id: row.employer_id, name: row.employer_name },
  }));
  const employerIds = collectHhEmployerIds(syntheticVacancies);
  const details = await fetchHhEmployerDetails({
    employerIds,
    userAgent,
    env: process.env,
    dispatcher: resolveHhProxyDispatcher(process.env),
    transportFetch: resolveHhProxyFetch(process.env) ?? undefined,
    maxEmployers: limit,
  });
  stats.detailsRequested = details.requested;
  stats.cacheHits = details.cacheHits;
  stats.detailFailures = details.failed;
  stats.truncated = details.truncated;
  stats.truncatedEmployers = details.truncatedEmployers;

  for (const row of candidates.rows) {
    const detail = details.details.get(String(row.employer_id));
    if (!detail) continue;
    await client.query('BEGIN');
    try {
      const result = await persistHhEmployerIdentity(client, {
        orgId: row.org_id,
        employerId: row.employer_id,
        employerName: row.employer_name,
        detail,
      });
      await client.query('COMMIT');
      if (result.status === 'enriched') stats.enriched += 1;
      else if (result.status === 'no-site') stats.noSite += 1;
      else if (result.status === 'conflict') stats.conflicts += 1;
      else stats.rejected += 1;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`HH employer identity persistence failed for ${row.employer_id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} finally {
  await client.end();
}

const report = {
  ok: stats.conflicts === 0,
  source: 'hh',
  mode: 'post-ingest-employer-identity-enrichment',
  generatedAt: new Date().toISOString(),
  stats,
  createsHiringSignals: false,
};
console.log(jsonOutput ? JSON.stringify(report) : JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 2;

function resolveLimit(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 2000 ? parsed : 1200;
}
