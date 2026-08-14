import assert from 'node:assert/strict';
import test from 'node:test';
import { renderSourceStatusDocs } from './generate-source-status-docs.mjs';

const readiness = {
  sources: {
    hh: { implementation: 'implemented', configuration: { mode: 'credential-required' }, live: { state: 'pending' }, blockers: ['credential-not-supplied'] },
    superjob: { implementation: 'implemented', configuration: { mode: 'credential-required' }, live: { state: 'verified' }, blockers: [] },
  },
};
const policy = {
  hh: { priority: 'P1', leadEligibility: 'digest-lead-originating', promotionStatus: 'digest-allowed' },
  superjob: { priority: 'P2', leadEligibility: 'confidence-gated-evidence', promotionStatus: 'digest-allowed' },
};
const credentials = {
  classes: { A: 'free-public', B: 'free-registration', C: 'partner-or-paid', D: 'unsafe-or-disallowed' },
  sources: {
    hh: { accessClass: 'B', registration: 'free', credentialSets: [{ names: ['HH_CLIENT_ID', 'HH_CLIENT_SECRET'] }], runtimeAvailability: { state: 'missing' }, verifier: 'npm run verify:hh:live-pipeline' },
    superjob: { accessClass: 'B', registration: 'free', credentialSets: [{ names: ['SUPERJOB_API_APP_ID'] }], runtimeAvailability: { state: 'configured' }, verifier: 'npm run verify:superjob:live-db' },
  },
};

test('renders policy, readiness and credential facts without secret values', () => {
  const output = renderSourceStatusDocs({ readiness, policy, credentials });

  assert.match(output, /Canonical sources: 2/);
  assert.match(output, /\| hh \| P1 \| digest-lead-originating \| digest-allowed \| implemented \| credential-required \| pending \|/);
  assert.match(output, /HH_CLIENT_ID, HH_CLIENT_SECRET/);
  assert.match(output, /Wait for the current HH application review; do not submit another registration/);
  assert.match(output, /SuperJob is already registered and configured; no user action/);
  assert.doesNotMatch(output, /credential-not-supplied.*credential-not-supplied/);
});

test('rejects drift between the three canonical source sets', () => {
  assert.throws(
    () => renderSourceStatusDocs({ readiness, policy: { ...policy, extra: policy.hh }, credentials }),
    /source sets differ/,
  );
});
