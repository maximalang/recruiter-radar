import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateBaseline,
  ndcgAt,
  precisionAt,
} from '../evaluate-commercial-signal-baselines.mjs';

const sample = [
  { lineageId: '1', relevance: 3, score: 0.9, accepted: true, contacted: true, replied: true, meeting: true },
  { lineageId: '2', relevance: 2, score: 0.8, accepted: true, contacted: true, replied: false, meeting: false },
  { lineageId: '3', relevance: 0, score: 0.7, accepted: false, contacted: false, replied: false, meeting: false },
  { lineageId: '4', relevance: 1, score: 0.6, accepted: false, contacted: true, replied: false, meeting: false },
];

test('precision treats strong/acceptable as relevant', () => {
  assert.equal(precisionAt(sample, 3), 0.666667);
});

test('NDCG rewards correct top ordering', () => {
  assert.equal(ndcgAt(sample, 4), 1);
  assert.ok(ndcgAt([...sample].reverse(), 4) < 1);
});

test('baseline evaluation exposes downstream descriptive rates', () => {
  const evaluated = evaluateBaseline(
    'commercial_signal_v3',
    sample,
    (row) => row.score,
  );
  assert.equal(evaluated.status, 'available');
  assert.equal(evaluated.precisionAt5, 0.5);
  assert.equal(evaluated.acceptedRate, 0.5);
  assert.equal(evaluated.contactedRate, 0.75);
  assert.equal(evaluated.replyRate, 0.333333);
  assert.equal(evaluated.meetingRate, 0.333333);
});

test('missing persisted baseline is explicit unavailable, never zero-filled', () => {
  const evaluated = evaluateBaseline('legacy_fiur', sample, () => null);
  assert.equal(evaluated.status, 'unavailable');
  assert.equal(evaluated.reasonCode, 'NO_COMPARABLE_PERSISTED_SCORE');
  assert.equal(evaluated.precisionAt10, null);
});
