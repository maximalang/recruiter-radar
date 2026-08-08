import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateBaseline,
  ndcgAt,
  precisionAt,
} from '../evaluate-commercial-signal-baselines.mjs';

const sample = [
  {
    lineageId: '1', relevance: 3, score: 0.9,
    candidateStatus: 'qualified_actionable',
    accepted: true, contacted: true, replied: true, replyMature: true, meeting: true,
  },
  {
    lineageId: '2', relevance: 2, score: 0.8,
    candidateStatus: 'qualified_needs_enrichment',
    accepted: true, contacted: true, replied: false, replyMature: false, meeting: false,
  },
  {
    lineageId: '3', relevance: 0, score: 0.7,
    candidateStatus: 'rejected',
    accepted: false, contacted: false, replied: false, replyMature: false, meeting: false,
  },
  {
    lineageId: '4', relevance: 1, score: 0.6,
    candidateStatus: 'rejected',
    accepted: false, contacted: true, replied: false, replyMature: true, meeting: false,
  },
];

test('precision treats strong/acceptable as relevant', () => {
  assert.equal(precisionAt(sample, 3), 0.666667);
});

test('NDCG rewards correct top ordering', () => {
  const correctlyRanked = [...sample]
    .sort((left, right) => right.relevance - left.relevance);

  assert.equal(ndcgAt(correctlyRanked, 4), 1);
  assert.ok(ndcgAt([...correctlyRanked].reverse(), 4) < 1);
});

test('baseline evaluation exposes mature downstream descriptive rates', () => {
  const evaluated = evaluateBaseline(
    'commercial_signal_v3',
    sample,
    (row) => row.score,
  );
  assert.equal(evaluated.status, 'available');
  assert.equal(evaluated.coverageRate, 1);
  assert.equal(evaluated.precisionAt5, 0.5);
  assert.equal(evaluated.qualifiedRate, 0.5);
  assert.equal(evaluated.acceptedRate, 0.5);
  assert.equal(evaluated.contactedRate, 0.75);
  // The second contacted row is still inside the no-reply maturity window and
  // must not be counted as a negative. Only rows 1 and 4 are reply-mature.
  assert.equal(evaluated.replyRate, 0.5);
  assert.equal(evaluated.meetingRate, 0.333333);
});

test('missing persisted baseline is explicit unavailable, never zero-filled', () => {
  const evaluated = evaluateBaseline('legacy_fiur', sample, () => null);
  assert.equal(evaluated.status, 'unavailable');
  assert.equal(evaluated.reasonCode, 'NO_COMPARABLE_PERSISTED_SCORE');
  assert.equal(evaluated.coverageRate, 0);
  assert.equal(evaluated.precisionAt10, null);
  assert.equal(evaluated.replyRate, null);
});
