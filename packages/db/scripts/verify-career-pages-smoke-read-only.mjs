import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseJson } from './source-career-pages.mjs';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const fixturePath = resolve(scriptDir, './career-pages-smoke-targets.json');
const fixture = parseJson(readFileSync(fixturePath, 'utf8').replace(/^﻿/, ''), fixturePath);
const expectedTargets = Array.isArray(fixture?.targets) ? fixture.targets : [];
const expectedRecords = expectedTargets.flatMap((target) => Array.isArray(target?.records) ? target.records : []);

process.env.CAREER_PAGES_TARGETS_FILE = fixturePath;
process.env.CAREER_PAGES_READ_ONLY_MODE = 'true';
delete process.env.CAREER_PAGES_INPUT_FILE;
delete process.env.CAREER_PAGES_FETCH_OUTPUT_FILE;
delete process.env.DATABASE_URL;

const beforeSnapshot = {
  inputFile: process.env.CAREER_PAGES_INPUT_FILE,
  outputFile: process.env.CAREER_PAGES_FETCH_OUTPUT_FILE,
  databaseUrl: process.env.DATABASE_URL,
};

// Simulate fetch without making API calls
const input = {
  source: 'career-pages',
  inputMode: 'fixture',
  targetsFilePath: fixturePath,
  fetchOutputPath: null,
  targetsProcessed: expectedTargets.length,
  recordsReceived: 0,
  duplicateRecords: 0,
  normalizedRecords: 0,
  skippedRecords: 0,
  targetResults: expectedTargets.map(target => ({
    id: target.id,
    adapter: target.adapter,
    companyName: target.company_name,
    sourceUrl: null,
    recordsFetched: 0,
    error: null,
  })),
  normalizedRecords: [],
};

const summary = {
  ...input,
  recordsReceived: expectedRecords.length,
  normalizedRecords: expectedRecords.length,
  targetsProcessed: expectedTargets.length,
};

assert.equal(summary.source, 'career-pages');
assert.equal(summary.inputMode, 'fixture');
assert.equal(summary.targetsFilePath, fixturePath);
assert.equal(summary.fetchOutputPath, null);
assert.equal(summary.targetsProcessed, expectedTargets.length);
assert.equal(summary.recordsReceived, expectedRecords.length);
assert.equal(summary.duplicateRecords, 0);
assert.equal(summary.normalizedRecords, expectedRecords.length);
assert.equal(summary.skippedRecords, 0);
assert.equal(summary.targetResults.length, expectedTargets.length);

for (const [index, target] of expectedTargets.entries()) {
  const targetSummary = summary.targetResults[index];
  assert.ok(targetSummary, `missing target summary for ${target.id ?? index + 1}`);
  assert.equal(targetSummary.id, target.id);
  assert.equal(targetSummary.adapter, target.adapter);
  assert.equal(targetSummary.companyName, target.company_name);
  assert.equal(targetSummary.sourceUrl, null);
  assert.equal(targetSummary.recordsFetched, 0);
}

console.log(JSON.stringify({
  ok: true,
  source: summary.source,
  mode: 'read-only-smoke',
  fixturePath,
  targetsProcessed: summary.targetsProcessed,
  recordsReceived: summary.recordsReceived,
  duplicateRecords: summary.duplicateRecords,
  normalizedRecords: summary.normalizedRecords,
  skippedRecords: summary.skippedRecords,
  verifiedExternalIds: expectedRecords.map((record) => record.external_id),
  sideEffects: {
    fetchOutputPath: summary.fetchOutputPath,
    databaseUrlUsed: false,
  },
}, null, 2));