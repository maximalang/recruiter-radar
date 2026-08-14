import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SMARTRECRUITERS_CONFIDENCE_THRESHOLDS,
  buildSmartRecruitersGoldSet,
  evaluateSmartRecruitersGoldSet,
} from './smartrecruiters-confidence.mjs';

test('representative SmartRecruiters gold set clears every promotion threshold', () => {
  const goldSet = buildSmartRecruitersGoldSet();
  const report = evaluateSmartRecruitersGoldSet(goldSet);

  assert.ok(goldSet.length >= SMARTRECRUITERS_CONFIDENCE_THRESHOLDS.minimumCases);
  assert.ok(report.positiveCases >= SMARTRECRUITERS_CONFIDENCE_THRESHOLDS.minimumPositiveCases);
  assert.ok(report.negativeCases >= SMARTRECRUITERS_CONFIDENCE_THRESHOLDS.minimumNegativeCases);
  assert.ok(report.precision >= SMARTRECRUITERS_CONFIDENCE_THRESHOLDS.minimumPrecision);
  assert.ok(report.recall >= SMARTRECRUITERS_CONFIDENCE_THRESHOLDS.minimumRecall);
  assert.equal(report.falsePositives, 0);
  assert.equal(report.falseNegatives, 0);
  assert.equal(report.organizationFidelity, 1);
  assert.equal(report.officialEvidenceRate, 1);
  assert.equal(report.sensitiveFieldsPersisted, 0);
  assert.equal(report.dedupeRate, 1);
  assert.deepEqual(report.missingCoverage, []);
  assert.equal(report.passed, true);
});

test('gate fails closed when a representative case is misclassified', () => {
  const goldSet = buildSmartRecruitersGoldSet();
  const firstPositive = goldSet.find((entry) => entry.expectedAccept);
  assert.ok(firstPositive);
  firstPositive.posting.name = '';

  const report = evaluateSmartRecruitersGoldSet(goldSet);

  assert.equal(report.falseNegatives, 1);
  assert.equal(report.passed, false);
});
