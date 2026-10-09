// Corpus test: model-generated edge-case job posts (Q2 quality program,
// fleet-ops t_d081e2c7). Expected normalizations are computed by the
// deterministic oracle packages/db/scripts/build-job-post-parser-corpus.mjs
// (independent reimplementation; no product imports) — never model-claimed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { normalizeJobPostingRecord } from './rf-source-normalizers.mjs';

const corpus = JSON.parse(readFileSync(
  new URL('./rf-source-normalizers.edge-cases.json', import.meta.url), 'utf-8'));

test('corpus integrity: unique digests and non-empty', () => {
  assert.ok(corpus.fixtures.length >= 30, 'corpus should carry a meaningful number of fixtures');
  const digests = new Set(corpus.fixtures.map((f) => f.input_digest));
  assert.equal(digests.size, corpus.fixtures.length, 'input digests must be unique');
});

for (const fixture of corpus.fixtures) {
  test(`corpus ${corpus.corpus_version}: ${fixture.id} [${fixture.kind}]`, () => {
    const actual = normalizeJobPostingRecord(fixture.input.record, {
      fetchedAt: fixture.input.fetchedAt,
      lineNumber: fixture.input.lineNumber,
      sourceId: fixture.input.sourceId,
    });
    assert.deepEqual(actual, fixture.expected.normalized);
  });
}
