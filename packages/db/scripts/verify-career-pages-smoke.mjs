import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildFetchSummary, fetchCareerPagesInput, parseJson } from './source-career-pages.mjs';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const fixturePath = resolve(scriptDir, './career-pages-smoke-targets.json');
const fixture = parseJson(readFileSync(fixturePath, 'utf8').replace(/^\uFEFF/, ''), fixturePath);
const expectedTargets = Array.isArray(fixture?.targets) ? fixture.targets : [];
const expectedRecords = expectedTargets.flatMap((target) => Array.isArray(target?.records) ? target.records : []);

process.env.CAREER_PAGES_TARGETS_FILE = fixturePath;
delete process.env.CAREER_PAGES_INPUT_FILE;
delete process.env.CAREER_PAGES_FETCH_OUTPUT_FILE;
delete process.env.DATABASE_URL;

const beforeSnapshot = {
  inputFile: process.env.CAREER_PAGES_INPUT_FILE,
  outputFile: process.env.CAREER_PAGES_FETCH_OUTPUT_FILE,
  databaseUrl: process.env.DATABASE_URL,
};

const input = await fetchCareerPagesInput({ persistSnapshot: false });
const summary = buildFetchSummary(input);

assert.equal(summary.source, 'career-pages');
assert.equal(summary.action, 'fetch');
assert.equal(summary.inputMode, 'fetch');
assert.equal(summary.targetsFilePath, fixturePath);
assert.equal(summary.fetchOutputPath, null);
assert.equal(summary.targetsProcessed, expectedTargets.length);
assert.equal(summary.recordsReceived, expectedRecords.length);
assert.equal(summary.normalizedRecords, expectedRecords.length);
assert.equal(summary.skippedRecords, 0);
assert.equal(summary.targetResults.length, expectedTargets.length);
assert.deepEqual(beforeSnapshot, {
  inputFile: undefined,
  outputFile: undefined,
  databaseUrl: undefined,
});

for (const [index, target] of expectedTargets.entries()) {
  const targetSummary = summary.targetResults[index];
  assert.ok(targetSummary, `missing target summary for ${target.id ?? index + 1}`);
  assert.equal(targetSummary.id, target.id);
  assert.equal(targetSummary.adapter, target.adapter);
  assert.equal(targetSummary.companyName, target.company_name);
  assert.equal(targetSummary.sourceUrl, null);
  assert.equal(targetSummary.recordsFetched, Array.isArray(target.records) ? target.records.length : 0);
}

for (const record of expectedRecords) {
  const normalizedRecord = input.normalizedRecords.find((candidate) => candidate.signalExternalId === record.external_id);
  assert.ok(normalizedRecord, `missing normalized record ${record.external_id}`);
  assert.equal(normalizedRecord.companyName, 'Smoke Company');
  assert.equal(normalizedRecord.companyDomain, 'smoke.example');
  assert.equal(normalizedRecord.companyWebsiteUrl, 'https://smoke.example/');
  assert.equal(normalizedRecord.careerPageUrl, 'https://smoke.example/careers');
  assert.equal(normalizedRecord.jobPostingUrl, record.job_posting_url);
  assert.equal(normalizedRecord.jobTitle, record.job_title);
  assert.equal(normalizedRecord.location, record.location);
  assert.equal(normalizedRecord.employmentType, record.employment_type);
  assert.equal(normalizedRecord.occurredAt, record.occurred_at);
  assert.equal(normalizedRecord.primarySourceKey, 'domain:smoke.example');
}

console.log(JSON.stringify({
  ok: true,
  source: summary.source,
  mode: 'read-only-smoke',
  fixturePath,
  targetsProcessed: summary.targetsProcessed,
  recordsReceived: summary.recordsReceived,
  normalizedRecords: summary.normalizedRecords,
  skippedRecords: summary.skippedRecords,
  verifiedExternalIds: expectedRecords.map((record) => record.external_id),
  sideEffects: {
    fetchOutputPath: summary.fetchOutputPath,
    databaseUrlUsed: false,
  },
}, null, 2));
