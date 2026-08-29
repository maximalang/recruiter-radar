import assert from 'node:assert/strict';
import test from 'node:test';

import { persistTargetRunObservations } from './source-career-pages-runtime.mjs';

test('persists a source-level observation for an explicit zero-target career-pages run', async () => {
  const queries = [];
  class FakeClient {
    async connect() {}
    async end() {}
    async query(sql, values) {
      queries.push({ sql, values });
      return { rows: [] };
    }
  }

  await persistTargetRunObservations({
    summary: {
      recordsReceived: 0,
      duplicateRecords: 0,
      organizationResolutionRejects: 0,
      targetResults: [],
      zeroReason: 'no-eligible-company-targets',
    },
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    completedAt: new Date('2026-01-01T00:00:01.000Z'),
  }, {
    databaseUrl: 'postgres://test.invalid/recruiter_radar',
    ClientConstructor: FakeClient,
  });

  assert.equal(queries[0].sql, 'BEGIN');
  assert.match(queries[1].sql, /INSERT INTO source_run_observations/);
  assert.deepEqual(queries[1].values.slice(0, 2), ['career-pages', 'pipeline']);
  assert.equal(queries[1].values.includes('success'), true);
  assert.equal(queries[1].values.filter((value) => value === 0).length >= 4, true);
  assert.match(queries[2].sql, /INSERT INTO source_health_state/);
  assert.equal(queries.at(-1).sql, 'COMMIT');
});

test('rejects an unclassified zero-target run before any database write', async () => {
  const queries = [];
  class FakeClient {
    async connect() { queries.push({ sql: 'CONNECT' }); }
    async end() {}
    async query(sql, values) { queries.push({ sql, values }); return { rows: [] }; }
  }

  await assert.rejects(
    persistTargetRunObservations({
      summary: {
        recordsReceived: 0,
        targetResults: [],
      },
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
      completedAt: new Date('2026-01-01T00:00:01.000Z'),
    }, {
      databaseUrl: 'postgres://test.invalid/recruiter_radar',
      ClientConstructor: FakeClient,
    }),
    /zero-target run must report zeroReason=no-eligible-company-targets/,
  );

  assert.deepEqual(queries, []);
});
