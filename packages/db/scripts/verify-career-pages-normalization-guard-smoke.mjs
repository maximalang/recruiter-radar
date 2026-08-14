/**
 * Regression smoke for the career-pages live-mode normalization guard.
 *
 * The live crawl must fail loudly when the fetcher returns records but the
 * normalizer drops every one of them (markup drift, key mismatch) — the same
 * "N records but 0 normalized" failure mode that silently produced 0 leads for
 * habr-career. File/fixture mode stays permissive (an empty or all-skipped
 * snapshot is legitimate input, not a broken adapter).
 */

import assert from 'node:assert/strict';

import {
  buildNormalizedInput,
  resolveCareerPageTargetOutcome,
} from './source-career-pages.mjs';

assert.equal(resolveCareerPageTargetOutcome({ recordsFetched: 3 }), 'parsed');
assert.equal(resolveCareerPageTargetOutcome({ recordsFetched: 0, notModified: true }), 'not-modified');
assert.equal(resolveCareerPageTargetOutcome({
  adapter: 'same-domain-jsonld',
  recordsFetched: 0,
  pageFetched: true,
}), 'extraction-zero-unexpected');
assert.equal(resolveCareerPageTargetOutcome({
  adapter: 'same-domain-jsonld',
  recordsFetched: 0,
  fetchFailure: true,
}), 'page-unreachable');
assert.equal(resolveCareerPageTargetOutcome({
  adapter: 'same-domain-jsonld',
  recordsFetched: 0,
  contentUnsupported: true,
}), 'extractor-unsupported');
assert.equal(resolveCareerPageTargetOutcome({
  adapter: 'greenhouse-board',
  recordsFetched: 0,
  pageFetched: true,
}), 'no-vacancies-present');

// Records that look real to the fetcher but carry nothing the normalizer can
// turn into a canonical record (no company identity, no usable job fields).
const undroppableJunk = [
  { adapter: 'static-records', nonsense_key: 'a' },
  { adapter: 'static-records', nonsense_key: 'b' },
  { adapter: 'static-records', nonsense_key: 'c' },
];

// Live mode (rejectAllSkipped: true) must throw the contract error.
assert.throws(
  () => buildNormalizedInput({
    records: undroppableJunk,
    inputMode: 'fetch',
    inputFilePath: null,
    targetsFilePath: null,
    fetchOutputPath: null,
    targetResults: [],
    discoverySummary: null,
    rejectAllSkipped: true,
  }),
  (error) => {
    assert.match(error.message, /career-pages/);
    assert.match(error.message, /0 normalized records/);
    return true;
  },
  'live career-pages crawl must reject when every fetched record is dropped',
);

// File/fixture mode (rejectAllSkipped omitted) must stay permissive and return
// an empty normalized set instead of throwing.
const permissive = buildNormalizedInput({
  records: undroppableJunk,
  inputMode: 'file',
  inputFilePath: '/tmp/fixture.json',
  targetsFilePath: null,
  fetchOutputPath: null,
  targetResults: [],
  discoverySummary: null,
});

assert.equal(permissive.normalizedRecords.length, 0, 'file mode must not throw on all-skipped input');
assert.equal(permissive.recordsReceived, undroppableJunk.length);
assert.equal(permissive.skippedRecords, undroppableJunk.length);

// An empty crawl (0 records in) must NOT trip the guard even in live mode —
// the guard only fires when records were received but none normalized.
const emptyLive = buildNormalizedInput({
  records: [],
  inputMode: 'fetch',
  inputFilePath: null,
  targetsFilePath: null,
  fetchOutputPath: null,
  targetResults: [],
  discoverySummary: null,
  rejectAllSkipped: true,
});

assert.equal(emptyLive.normalizedRecords.length, 0, 'empty live fetch must not throw');
assert.equal(emptyLive.recordsReceived, 0);

console.log(JSON.stringify({
  ok: true,
  smoke: 'career-pages-normalization-guard',
  liveAllSkippedRejected: true,
  fileAllSkippedPermissive: true,
  emptyLiveAllowed: true,
  perTargetOutcomesVerified: true,
}, null, 2));
