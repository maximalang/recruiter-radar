import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCareerPagesHealth,
  detectCareerPagesHealthAnomalies,
} from './career-pages-health.mjs';

test('aggregates bounded per-family transport, zero-reason, and latency metrics', () => {
  const health = buildCareerPagesHealth({
    targetResults: [
      {
        id: 'greenhouse-a',
        adapter: 'greenhouse-board',
        companyName: 'A',
        recordsFetched: 5,
        outcome: 'parsed',
        extractionMethod: 'greenhouse-api',
        durationMs: 100,
      },
      {
        id: 'workday-b',
        adapter: 'hosted-career-page',
        hostedAtsFamily: 'workday',
        companyName: 'B',
        recordsFetched: 0,
        outcome: 'extraction-zero-unexpected',
        extractionMethod: 'none',
        durationMs: 900,
        escalationAttempts: [
          { stage: 'static-http', outcome: 'artifact-only' },
          { stage: 'structured-data', outcome: 'artifact-only' },
          { stage: 'rendered-dom', outcome: 'artifact-only' },
        ],
      },
      {
        id: 'teamtailor-c',
        adapter: 'teamtailor-rss',
        hostedAtsFamily: 'teamtailor',
        companyName: 'C',
        recordsFetched: 0,
        outcome: 'page-unreachable',
        errorCategory: 'http-429',
        durationMs: 500,
      },
      {
        id: 'personio-d', adapter: 'personio-xml', hostedAtsFamily: 'personio',
        companyName: 'D', recordsFetched: 0, outcome: 'not-modified',
        notModified: true, durationMs: 10,
      },
    ],
    duplicateRecords: 2,
    skippedRecords: 1,
    ingestionStats: {
      signalUpsertCount: 5,
      evidenceCreatedCount: 4,
    },
    familyIngestionStats: {
      greenhouse: { signalUpsertCount: 5, evidenceCreatedCount: 4 },
    },
    familyDuplicateCounts: { greenhouse: 2 },
  });

  assert.equal(health.totals.discoveredCompanies, 4);
  assert.equal(health.totals.discoveredBoards, 4);
  assert.equal(health.totals.jobsExtracted, 5);
  assert.equal(health.totals.duplicates, 2);
  assert.equal(health.totals.dbUpserts, 5);
  assert.equal(health.totals.evidenceCreated, 4);
  assert.equal(health.families.find((entry) => entry.family === 'greenhouse').dbUpserts, 5);
  assert.equal(health.families.find((entry) => entry.family === 'greenhouse').duplicates, 2);
  assert.equal(health.totals.browserFallbacks, 1);
  assert.equal(health.totals.throttled, 1);
  assert.equal(health.totals.notModified, 1);
  assert.equal(health.totals.zeroReasons.parserOrLayoutDrift, 1);
  assert.equal(health.totals.zeroReasons.throttled, 1);
  assert.equal(health.totals.latencyMs.p50, 100);
  assert.equal(health.totals.latencyMs.p95, 900);
  assert.deepEqual(health.families.map((entry) => entry.family), [
    'greenhouse',
    'personio',
    'teamtailor',
    'workday',
  ]);
});

test('flags a global zero and a severe drop only when board coverage is comparable', () => {
  const previous = {
    families: [
      { family: 'workday', discoveredBoards: 200, jobsExtracted: 1500 },
      { family: 'lever', discoveredBoards: 100, jobsExtracted: 500 },
    ],
  };
  const current = {
    families: [
      { family: 'workday', discoveredBoards: 200, jobsExtracted: 0 },
      { family: 'lever', discoveredBoards: 10, jobsExtracted: 0 },
    ],
  };

  assert.deepEqual(detectCareerPagesHealthAnomalies(current, previous), [
    {
      family: 'workday',
      code: 'GLOBAL_ZERO_WITH_HTTP_COVERAGE',
      severity: 'critical',
      previousBoards: 200,
      currentBoards: 200,
      previousJobs: 1500,
      currentJobs: 0,
    },
  ]);
});

test('distinguishes empty, blocked, duplicate-only, and filtered-all zero results', () => {
  const health = buildCareerPagesHealth({
    targetResults: [
      {
        id: 'empty', adapter: 'personio-xml', hostedAtsFamily: 'personio',
        companyName: 'Empty', recordsFetched: 0, outcome: 'no-vacancies-present', durationMs: 1,
      },
      {
        id: 'blocked', adapter: 'hosted-career-page', hostedAtsFamily: 'icims',
        companyName: 'Blocked', recordsFetched: 0, outcome: 'page-unreachable',
        stoppedByPolicy: true, errorCategory: 'access-policy:robots-disallowed', durationMs: 2,
      },
      {
        id: 'render-empty', adapter: 'hosted-career-page', hostedAtsFamily: 'workday',
        companyName: 'Render Empty', recordsFetched: 0,
        outcome: 'extraction-zero-unexpected', durationMs: 3,
        escalationAttempts: [{ stage: 'rendered-dom', outcome: 'empty' }],
      },
    ],
    recordsReceived: 3,
    recordsAfterDedupe: 0,
    duplicateRecords: 3,
    skippedRecords: 2,
  });

  assert.equal(health.totals.zeroReasons.noVacanciesPresent, 1);
  assert.equal(health.totals.zeroReasons.accessBlocked, 1);
  assert.equal(health.totals.zeroReasons.browserNotRendered, 1);
  assert.equal(health.totals.zeroReasons.duplicatesOnly, 1);
  assert.equal(health.totals.zeroReasons.filteredAll, 1);
});
