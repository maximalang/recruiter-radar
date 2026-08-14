import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFetchSummary,
  resolveCbrRegistryInput,
} from './source-cbr-registry.mjs';

test('CBR reports expected zero when no eligible company INNs exist', async () => {
  const previousFile = process.env.CBR_REGISTRY_INPUT_FILE;
  const previousInns = process.env.CBR_REGISTRY_INNS;
  const previousGovernmentInns = process.env.GOVERNMENT_ENRICHMENT_INNS;
  delete process.env.CBR_REGISTRY_INPUT_FILE;
  delete process.env.CBR_REGISTRY_INNS;
  delete process.env.GOVERNMENT_ENRICHMENT_INNS;

  try {
    const input = await resolveCbrRegistryInput();
    const summary = buildFetchSummary(input);
    assert.equal(summary.inputMode, 'expected-zero');
    assert.equal(summary.recordsReceived, 0);
    assert.equal(summary.zeroReason, 'no-eligible-company-inns');
  } finally {
    restore('CBR_REGISTRY_INPUT_FILE', previousFile);
    restore('CBR_REGISTRY_INNS', previousInns);
    restore('GOVERNMENT_ENRICHMENT_INNS', previousGovernmentInns);
  }
});

function restore(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
