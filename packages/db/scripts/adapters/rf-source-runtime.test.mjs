import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSuccessfulIngestZeroReason } from './rf-source-runtime.mjs';

test('marks a successful idempotent replay only when a normalized record passed identity resolution', () => {
  const input = { normalizedRecords: [{}, {}, {}] };

  assert.equal(resolveSuccessfulIngestZeroReason(input, {
    signalUpsertCount: 0,
    organizationResolutionRejects: 2,
  }), 'no-new-signals');
  assert.equal(resolveSuccessfulIngestZeroReason(input, {
    signalUpsertCount: 0,
    organizationResolutionRejects: 3,
  }), undefined);
  assert.equal(resolveSuccessfulIngestZeroReason(input, {
    signalUpsertCount: 1,
    organizationResolutionRejects: 2,
  }), undefined);
});

test('preserves a source-owned expected-zero reason', () => {
  assert.equal(resolveSuccessfulIngestZeroReason({
    normalizedRecords: [],
    zeroReason: 'no-eligible-company-targets',
  }, { signalUpsertCount: 0 }), 'no-eligible-company-targets');
});
