#!/usr/bin/env node
/** Regression guards for the durable missing-snapshot path in capture/workflow code. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'source-refresh-evidence-capture.yml'), 'utf8');
const capture = fs.readFileSync(path.join(repoRoot, 'scripts', 'capture-source-refresh-evidence.mjs'), 'utf8');

test('W1: pre-capture collection/build failures execute the durable missing-snapshot capture path', () => {
  assert.match(workflow, /id: persist/);
  assert.match(workflow, /name: Persist durable missing-snapshot alert when collection\/build stopped/);
  assert.match(workflow, /if: \$\{\{ failure\(\) && steps\.persist\.outcome == 'skipped' \}\}/);
  assert.match(workflow, /DATABASE_URL: \$\{\{ secrets\.RR_EVIDENCE_DATABASE_URL \}\}/);
  assert.match(workflow, /Persist durable missing-snapshot alert when collection\/build stopped[\s\S]*?node scripts\/capture-source-refresh-evidence\.mjs/);
});

test('W2: absent snapshot records the requested UTC day, never a shifted day', () => {
  assert.match(capture, /deriveMissingSnapshotAlert\(DAY, \{ nowMs: Date\.now\(\) \}\)/);
  assert.doesNotMatch(capture, /deriveMissingSnapshotAlert\(yesterday,/);
});
