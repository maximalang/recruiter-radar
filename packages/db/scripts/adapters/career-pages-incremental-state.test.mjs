import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createCareerPagesIncrementalState,
  shouldSkipExpensiveCareerFallback,
} from './career-pages-incremental-state.mjs';

test('skips expensive fallback only for a previously static result with unchanged content', () => {
  const sameHash = 'a'.repeat(64);
  const previous = { contentHash: sameHash, reusableStatic: true, extractionVersion: 'v1' };
  assert.equal(shouldSkipExpensiveCareerFallback(previous, {
    contentHash: sameHash, notModified: false, extractionVersion: 'v1',
  }), true);
  assert.equal(shouldSkipExpensiveCareerFallback(previous, {
    contentHash: 'different', notModified: false, extractionVersion: 'v1',
  }), false);
  assert.equal(shouldSkipExpensiveCareerFallback(previous, {
    contentHash: sameHash, notModified: true, extractionVersion: 'v2',
  }), false);
  assert.equal(shouldSkipExpensiveCareerFallback({
    contentHash: sameHash, reusableStatic: false, extractionVersion: 'v1',
  }, { contentHash: sameHash, notModified: true, extractionVersion: 'v1' }), false);
});

test('persists bounded validators and canonical URL state without credentials', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rr-career-incremental-'));
  const filePath = join(directory, 'state.json');
  try {
    const state = createCareerPagesIncrementalState({ filePath, now: () => 123 });
    state.update('https://Example.test/jobs?utm_source=x', {
      etag: '"v1"',
      lastModified: 'Wed, 01 Jan 2025 00:00:00 GMT',
      contentHash: 'a'.repeat(64),
      reusableStatic: true,
      selectedStage: 'structured-data',
      extractionVersion: 'v1',
    });
    state.flush();

    const reloaded = createCareerPagesIncrementalState({ filePath, now: () => 456 });
    assert.deepEqual(reloaded.get('https://example.test/jobs'), {
      etag: '"v1"',
      lastModified: 'Wed, 01 Jan 2025 00:00:00 GMT',
      contentHash: 'a'.repeat(64),
      reusableStatic: true,
      selectedStage: 'structured-data',
      extractionVersion: 'v1',
      checkedAt: '1970-01-01T00:00:00.123Z',
    });
    assert.doesNotMatch(readFileSync(filePath, 'utf8'), /utm_source|@/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
