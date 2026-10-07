import assert from 'node:assert/strict'
import test from 'node:test'

import {
  calculatePrecisionAt5,
  validateLabels,
} from './export-manual-lead-labeling-session.mjs'

test('precision@5 stays unavailable until the first five are labeled', () => {
  const rows = Array.from({ length: 5 }, (_, index) => ({
    reviewOrder: index + 1,
    label: index === 0 ? 'accepted' : null,
  }))
  assert.equal(calculatePrecisionAt5(rows), null)
  assert.equal(calculatePrecisionAt5(rows.map((row, index) => ({
    ...row,
    label: index < 2 ? 'accepted' : 'badfit',
  }))), 0.4)
})

test('labels are closed to accepted or badfit', () => {
  assert.deepEqual(validateLabels([{ label: '' }, { label: 'accepted' }]), [
    { label: null },
    { label: 'accepted' },
  ])
  assert.throws(() => validateLabels([{ label: 'maybe' }]), /invalid label/)
})
