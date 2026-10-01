#!/usr/bin/env node
/**
 * Fixture-first smoke verification for the 2026-10 public source expansion.
 *
 * Runs every expanded source through its production file-mode path
 * (INPUT_FILE -> extractRecords -> normalizeRecord -> dedupe -> summary)
 * using a committed fixture with 4 valid and 2 invalid records per source.
 * No network, no database. This is the CI-facing contract that each source's
 * normalization path works exactly as registered.
 *
 * Usage: node packages/db/scripts/verify-public-source-expansion-smoke.mjs [--only=id1,id2]
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPublicExpansionSource, PUBLIC_EXPANSION_SOURCE_IDS } from './adapters/public-source-expansion.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(scriptDir, './public-source-expansion-smoke-fixture.json');

delete process.env.DATABASE_URL;

const argv = process.argv.slice(2);
const onlyArg = argv.find((entry) => entry.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length).split(',').map((entry) => entry.trim()).filter(Boolean) : null;
const ids = only ?? PUBLIC_EXPANSION_SOURCE_IDS;

const results = [];
let failures = 0;

for (const id of ids) {
  const checks = [];
  try {
    const source = createPublicExpansionSource(id);
    const spec = source.spec;
    process.env[spec.inputFileEnvName] = fixturePath;
    try {
      const input = await source.resolveInput();
      const summary = source.buildFetchSummary(input);
      checks.push(['inputMode file', summary.inputMode === 'file', summary.inputMode]);
      checks.push(['recordsReceived 6', summary.recordsReceived === 6, summary.recordsReceived]);
      checks.push(['normalizedRecords 4', summary.normalizedRecords === 4, summary.normalizedRecords]);
      checks.push(['skippedRecords 2', summary.skippedRecords === 2, summary.skippedRecords]);
      checks.push(['sensitiveFieldsDropped 0', summary.sensitiveFieldsDropped === 0, summary.sensitiveFieldsDropped]);
      const expectedSignalType = spec.family === 'job-board' ? 'job_posting' : 'other';
      const signalTypes = new Set((input.normalizedRecords ?? []).map((record) => record.signalType));
      checks.push([`signalType ${expectedSignalType}`, signalTypes.size === 1 && signalTypes.has(expectedSignalType), [...signalTypes].join('|')]);
      const recordTypes = new Set((input.normalizedRecords ?? []).map((record) => record.sourceRecordType));
      checks.push([`sourceRecordType ${spec.sourceRecordType}`, recordTypes.size === 1 && recordTypes.has(spec.sourceRecordType), [...recordTypes].join('|')]);
      const keys = (input.normalizedRecords ?? []).map((record) => record.primarySourceKey);
      checks.push(['all records have primarySourceKey', keys.length === 4 && keys.every((key) => typeof key === 'string' && key.length > 0), keys.filter((key) => !key).length]);
      if (id === 'cbr-fx-daily') {
        checks.push(['cbr identity domain:cbr.ru', keys.every((key) => key === 'domain:cbr.ru'), keys.join('|')]);
      }
      if (id === 'trudvsem-opendata-datasets') {
        checks.push(['rostrud identity inn:7710538364', keys.every((key) => key === 'inn:7710538364'), keys.join('|')]);
      }
      if (spec.family === 'job-board') {
        checks.push(['job identity company-name:*', keys.every((key) => key.startsWith('company-name:')), keys.join('|')]);
      }
      if (id === 'ror') {
        checks.push(['ror identity domain:*', keys.every((key) => key.startsWith('domain:fixture-research-')), keys.join('|')]);
      }
    } finally {
      delete process.env[spec.inputFileEnvName];
    }
  } catch (error) {
    checks.push(['no exception', false, String(error?.message ?? error).slice(0, 300)]);
  }
  const failed = checks.filter(([, ok]) => !ok);
  if (failed.length > 0) failures += 1;
  results.push({ source: id, failed: failed.map(([name, , value]) => `${name} (got ${value})`) });
  console.log(`${failed.length === 0 ? 'PASS' : 'FAIL'} ${id}${failed.length ? ` -> ${failed.map(([name, , value]) => `${name} got:${value}`).join('; ')}` : ''}`);
}

console.log(`\n${results.length - failures}/${results.length} expansion sources passed fixture smoke.`);
process.exit(failures === 0 ? 0 : 1);
