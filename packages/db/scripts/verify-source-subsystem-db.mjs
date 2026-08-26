#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

assert.equal(process.env.SOURCE_LIVE_VERIFY, '1', 'SOURCE_LIVE_VERIFY=1 is required.');
assert.equal(
  process.env.SOURCE_IDENTITY_LINEAGE_DB_TEST_ACK,
  'isolated',
  'SOURCE_IDENTITY_LINEAGE_DB_TEST_ACK=isolated is required.',
);
assert.ok(process.env.DATABASE_URL?.trim(), 'DATABASE_URL is required.');

const verifiers = [
  'verify-source-identity-lineage.mjs',
  'verify-source-identity-boundary-quarantine.mjs',
  'verify-mixed-ranking-smoke.mjs',
  'verify-digest-selection-smoke.mjs',
  'verify-rf-context-corroboration-smoke.mjs',
  'verify-career-pages-ingest.mjs',
];
const results = [];

for (const verifier of verifiers) {
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, verifier)], {
    cwd: resolve(import.meta.dirname, '../../..'),
    env: {
      ...process.env,
      SOURCE_ENV_FILE_DISABLED: 'true',
      SOURCE_IDENTITY_LINEAGE_DB_TEST_ACK: 'isolated',
    },
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${verifier} failed: ${[result.stderr, result.stdout].filter(Boolean).join('\n').trim()}`,
    );
  }
  results.push({
    verifier,
    output: result.stdout.trim().split(/\r?\n/).slice(-12),
  });
}

console.log(JSON.stringify({
  ok: true,
  mode: 'isolated-source-subsystem-db',
  verifiers: results,
}, null, 2));
