import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadHistoricalTransportPlan,
  recordTransportObservation,
} from './source-transport-health-store.mjs';

test('historical static failures move the static+structured chain behind healthy fallbacks', async () => {
  const client = {
    query: async () => ({
      rows: [
        observation('2026-08-19T04:00:00Z', 'static-http', 'error'),
        observation('2026-08-19T03:00:00Z', 'static-http', 'error'),
        observation('2026-08-19T02:00:00Z', 'static-http', 'error'),
        observation('2026-08-19T01:00:00Z', 'static-http', 'error'),
      ],
    }),
  };

  const plan = await loadHistoricalTransportPlan(client, {
    sourceId: 'rf-discovery:getmatch:vacancy-catalog',
    configuredStages: ['static-http', 'structured-data', 'rendered-dom', 'extraction'],
    now: new Date('2026-08-19T05:00:00Z'),
  });

  assert.equal(plan.stoppedByPolicy, false);
  assert.deepEqual(plan.health.degradedStages, ['static-http']);
  assert.deepEqual(plan.stages, ['rendered-dom', 'extraction', 'static-http', 'structured-data']);
});

test('fresh policy stop blocks historical fallback completely', async () => {
  const client = {
    query: async () => ({ rows: [observation('2026-08-19T04:00:00Z', 'static-http', 'blocked')] }),
  };
  const plan = await loadHistoricalTransportPlan(client, {
    sourceId: 'rf-discovery:rabota-ru:vacancy-catalog',
    configuredStages: ['static-http', 'structured-data', 'rendered-dom', 'extraction'],
    now: new Date('2026-08-19T05:00:00Z'),
  });
  assert.equal(plan.stoppedByPolicy, true);
  assert.equal(plan.stoppedStage, 'static-http');
  assert.deepEqual(plan.stages, []);
});

test('expired historical policy stop permits a fresh policy-checked acquisition attempt', async () => {
  const client = {
    query: async () => ({ rows: [observation('2026-08-17T00:00:00Z', 'static-http', 'blocked')] }),
  };
  const plan = await loadHistoricalTransportPlan(client, {
    sourceId: 'rf-discovery:rabota-ru:vacancy-catalog',
    configuredStages: ['static-http', 'structured-data', 'rendered-dom', 'extraction'],
    now: new Date('2026-08-19T05:00:00Z'),
  });
  assert.equal(plan.stoppedByPolicy, false);
  assert.deepEqual(plan.stages, ['static-http', 'structured-data', 'rendered-dom', 'extraction']);
});

test('transport observation persists bounded attempts in existing source health table', async () => {
  let captured = null;
  const client = {
    query: async (sql, params) => {
      captured = { sql: String(sql), params };
      return { rows: [{ id: '99', outcome: 'success', completed_at: '2026-08-19T05:00:01Z' }] };
    },
  };

  const row = await recordTransportObservation(client, {
    sourceId: 'rf-discovery:getmatch:vacancy-catalog',
    executionSourceId: 'getmatch',
    startedAt: new Date('2026-08-19T05:00:00Z'),
    completedAt: new Date('2026-08-19T05:00:01Z'),
    selectedStage: 'rendered-dom',
    attempts: [
      { stage: 'rendered-dom', outcome: 'parsed', records: 3, rejectedRecords: 0 },
    ],
    records: 3,
  });

  assert.equal(row.id, '99');
  assert.match(captured.sql, /INSERT INTO source_run_observations/);
  assert.match(captured.sql, /transport_attempts/);
  assert.equal(captured.params[0], 'rf-discovery:getmatch:vacancy-catalog');
  assert.equal(captured.params[1], 'getmatch');
  assert.equal(captured.params[4], 'success');
  assert.equal(captured.params[5], 3);
  assert.deepEqual(JSON.parse(captured.params[7]), [
    {
      stage: 'rendered-dom',
      outcome: 'parsed',
      httpStatus: null,
      records: 3,
      rejectedRecords: 0,
      reason: null,
      at: '2026-08-19T05:00:01.000Z',
    },
  ]);
});

function observation(completedAt, stage, outcome) {
  return {
    completed_at: completedAt,
    transport_attempts: [{ stage, outcome, at: completedAt }],
  };
}
