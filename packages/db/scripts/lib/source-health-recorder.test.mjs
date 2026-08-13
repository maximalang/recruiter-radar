import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSourceRunMetrics, recordSourceRunObservation } from './source-health-recorder.mjs';

test('builds extraction metrics including ATS modes and classifies outcomes safely', () => {
  const metrics = buildSourceRunMetrics({ sourceId: 'career-pages', action: 'pipeline', startedAt: 100, completedAt: 350, input: { recordsReceived: 5, duplicateRecords: 1, skippedRecords: 1, normalizedRecords: [{ extractionMethod: 'static-html' }, { extractionMethod: 'rendered-dom' }, { extractionMethod: 'rss-xml' }] } });
  assert.equal(metrics.recordsAccepted, 3);
  assert.deepEqual(metrics.extractionMethods, { 'static-html': 1, 'rendered-dom': 1, 'rss-xml': 1 });
  assert.equal(metrics.latencyMs, 250);
});

test('persists append-only run and updates consecutive-failure projection', async () => {
  const queries = [];
  await recordSourceRunObservation({ query: async (sql, values) => { queries.push({ sql, values }); } }, buildSourceRunMetrics({ sourceId: 'hh', action: 'fetch', startedAt: 100, completedAt: 200, error: new Error('HTTP 429 rate limited') }));
  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /INSERT INTO source_run_observations/);
  assert.match(queries[1].sql, /consecutive_failures=CASE WHEN .*source_health_state\.consecutive_failures \+ 1/);
  assert.equal(queries[0].values.includes('rate_limited'), true);
  assert.equal(queries[0].values.some((v) => String(v).includes('HTTP 429')), false);
});
