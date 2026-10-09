#!/usr/bin/env node
/**
 * Live verification runner for the 2026-10 public source expansion.
 *
 * Runs the real production fetch path (resolveInput -> live-public mode) for
 * every expanded source with bounded record limits, then prints and saves a
 * sanitized per-source evidence report: request outcome, record counts and
 * up to two sample titles/companies per source. No credentials, no DB access,
 * no payloads beyond public listing titles/company names.
 *
 * Usage:
 *   node packages/db/scripts/verify-public-source-expansion-live.mjs [--only=id1,id2] [--out=<path>]
 *
 * Query-driven sources need their target env (documented per source in the
 * registry usage text), e.g.:
 *   HN_ALGOLIA_QUERIES=GitLab GDELT_CONTEXT_QUERIES=GitLab \
 *   OPENALEX_SEARCH_TERMS="artificial intelligence" ROR_ORGANIZATIONS=microsoft \
 *   CBR_FX_DAILY_API_URL=https://www.cbr-xml-daily.ru/daily_json.js \
 *   node packages/db/scripts/verify-public-source-expansion-live.mjs
 */
import { writeFileSync } from 'node:fs';

import { createPublicExpansionSource, PUBLIC_EXPANSION_SOURCE_IDS } from './adapters/public-source-expansion.mjs';

const argv = process.argv.slice(2);
const onlyArg = argv.find((entry) => entry.startsWith('--only='));
const outArg = argv.find((entry) => entry.startsWith('--out='));
const only = onlyArg ? onlyArg.slice('--only='.length).split(',').map((entry) => entry.trim()).filter(Boolean) : null;
const outPath = outArg ? outArg.slice('--out='.length) : null;

// Bound every live fetch so verification stays polite and fast.
const boundedEnv = {
  THEMUSE_MAX_RECORDS: '5',
  LANDINGJOBS_MAX_PAGES: '1',
  LANDINGJOBS_MAX_RECORDS: '5',
  ARBEITNOW_MAX_PAGES: '1',
  ARBEITNOW_MAX_RECORDS: '5',
  REMOTEOK_MAX_RECORDS: '5',
  JOBICY_COUNT: '5',
  JOBICY_MAX_RECORDS: '5',
  HIMALAYAS_LIMIT: '5',
  HIMALAYAS_MAX_RECORDS: '5',
  REMOTIVE_LIMIT: '5',
  WEWORKREMOTELY_MAX_ITEMS: '5',
  HACKERNEWS_JOBS_MAX_ITEMS: '3',
  HN_ALGOLIA_HITS_PER_QUERY: '3',
  DEVTO_PER_PAGE: '5',
  GDELT_CONTEXT_MAX_RECORDS: '3',
  OPENALEX_PER_TERM: '3',
  ROR_PER_QUERY: '3',
};
for (const [name, value] of Object.entries(boundedEnv)) {
  process.env[name] ??= value;
}

const ids = only ?? PUBLIC_EXPANSION_SOURCE_IDS;
const report = [];
let failures = 0;

for (const id of ids) {
  const startedAt = new Date().toISOString();
  const entry = { source: id, startedAt };
  try {
    const source = createPublicExpansionSource(id);
    const input = await source.resolveInput();
    const summary = source.buildFetchSummary(input);
    entry.status = 'ok';
    entry.inputMode = summary.inputMode;
    entry.liveProvider = summary.liveProvider ?? null;
    entry.recordsReceived = summary.recordsReceived;
    entry.normalizedRecords = summary.normalizedRecords;
    entry.skippedRecords = summary.skippedRecords;
    entry.zeroReason = summary.zeroReason ?? null;
    entry.samples = (input.normalizedRecords ?? []).slice(0, 2).map((record) => ({
      title: String(record.headline ?? record.recordTitle ?? '').slice(0, 140) || null,
      company: record.companyName ?? null,
      orgKey: record.primarySourceKey ?? null,
      signalType: record.signalType ?? null,
    }));
  } catch (error) {
    entry.status = 'failed';
    entry.error = String(error?.message ?? error).slice(0, 400);
    failures += 1;
  }
  entry.finishedAt = new Date().toISOString();
  report.push(entry);
  console.log(
    `${entry.status === 'ok' ? 'PASS' : 'FAIL'} ${id} mode=${entry.inputMode ?? '-'} received=${entry.recordsReceived ?? '-'} normalized=${entry.normalizedRecords ?? '-'} zero=${entry.zeroReason ?? '-'}${entry.error ? ` error=${entry.error}` : ''}`,
  );
}

const payload = { verifiedAt: new Date().toISOString(), report };
if (outPath) {
  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`saved ${outPath}`);
}
console.log(`\n${report.length - failures}/${report.length} sources verified live-public.`);
process.exit(failures === 0 ? 0 : 1);
