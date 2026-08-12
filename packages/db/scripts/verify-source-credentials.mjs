#!/usr/bin/env node

import assert from 'node:assert/strict';

import credentialManifest from '../source-credentials.json' with { type: 'json' };
import { listSources } from './source-registry.mjs';

const jsonOutput = process.argv.includes('--json');
const sourceIds = listSources().map((source) => source.id).sort();
const manifestIds = Object.keys(credentialManifest.sources).sort();

assert.deepEqual(manifestIds, sourceIds, 'credential manifest must cover every registered source exactly once');
assert.deepEqual(Object.keys(credentialManifest.classes).sort(), ['A', 'B', 'C', 'D']);

const sources = sourceIds.map((id) => {
  const entry = credentialManifest.sources[id];
  assert.ok(['A', 'B', 'C', 'D'].includes(entry.accessClass), `${id}.accessClass is invalid`);
  assert.ok(Array.isArray(entry.credentialSets), `${id}.credentialSets must be an array`);
  assert.ok(['configured', 'missing', 'not-required', 'not-probed'].includes(entry.runtimeAvailability?.state), `${id}.runtimeAvailability.state is invalid`);

  for (const set of entry.credentialSets) {
    assert.ok(Array.isArray(set.names) && set.names.length > 0, `${id} credential set must name env variables`);
    assert.ok(set.names.every((name) => /^[A-Z][A-Z0-9_]+$/.test(name)), `${id} credential env name is invalid`);
  }

  const configuredNow = entry.accessClass === 'A'
    || entry.credentialSets.some((set) => set.names.every((name) => hasEnvValue(process.env, name)));

  return {
    id,
    accessClass: entry.accessClass,
    registration: entry.registration,
    credentialSets: entry.credentialSets.map((set) => ({
      names: [...set.names],
      requiredFor: set.requiredFor,
    })),
    configuredNow,
    lastKnownRuntime: entry.runtimeAvailability,
    verifier: entry.verifier,
  };
});

const report = {
  ok: true,
  classes: credentialManifest.classes,
  sources,
  summary: Object.fromEntries(['A', 'B', 'C', 'D'].map((accessClass) => [
    accessClass,
    sources.filter((source) => source.accessClass === accessClass).length,
  ])),
};

if (jsonOutput) {
  console.log(JSON.stringify(report));
} else {
  console.log(JSON.stringify(report, null, 2));
}

function hasEnvValue(env, name) {
  return typeof env[name] === 'string' && env[name].trim() !== '';
}
