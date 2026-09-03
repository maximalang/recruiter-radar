import assert from 'node:assert/strict'
import test from 'node:test'

import {
  aggregateDailyYield,
  deriveLawfulContactPathIndicator,
} from './measure-daily-yield.mjs'

const base = {
  profile_id: '10',
  day: '2026-08-26',
  confidence_gate: 'A',
  source_families: ['career-pages'],
  reasons: [],
  payload: { contact_paths: [{ type: 'contact_page' }] },
}

test('dedupes one company per profile/day using the highest score', () => {
  const rows = aggregateDailyYield([
    { ...base, candidate_id: '1', org_id: '100', total_score: 40, created_at: '2026-08-26T09:00:00Z' },
    { ...base, candidate_id: '2', org_id: '100', total_score: 90, created_at: '2026-08-26T08:00:00Z' },
    { ...base, candidate_id: '3', org_id: '101', confidence_gate: 'C', payload: {}, total_score: 80, created_at: '2026-08-26T07:00:00Z' },
  ])

  assert.deepEqual(rows, [{
    profileId: '10',
    day: '2026-08-26',
    candidateRowsAfterDedupe: 2,
    uniqueCompanies: 2,
    abGateCandidates: 1,
    unknownGateCandidates: 0,
    lawfulContactPathCandidates: 1,
    abGateShare: 0.5,
    lawfulContactPathShare: 0.5,
  }])
})

test('lawful path follows persisted contact surface, reasons, then registry families', () => {
  assert.equal(deriveLawfulContactPathIndicator({ payload: { contact_paths: [{}] } }), 'contact-surface')
  assert.equal(deriveLawfulContactPathIndicator({ reasons: [{ key: 'reachability.career-page' }] }), 'reason-derived')
  assert.equal(deriveLawfulContactPathIndicator({ source_families: ['egrul-fns'] }), 'registry-data')
  assert.equal(deriveLawfulContactPathIndicator({ source_families: ['hh'], payload: {} }), null)
})

test('keeps profiles and days separate', () => {
  const rows = aggregateDailyYield([
    { ...base, profile_id: '10', candidate_id: '1', org_id: '100', total_score: 10, created_at: '2026-08-26T08:00:00Z' },
    { ...base, profile_id: '11', candidate_id: '2', org_id: '100', total_score: 10, created_at: '2026-08-26T08:00:00Z' },
    { ...base, profile_id: '10', day: '2026-08-27', candidate_id: '3', org_id: '100', total_score: 10, created_at: '2026-08-27T08:00:00Z' },
  ])
  assert.equal(rows.length, 3)
  assert.deepEqual(rows.map((row) => `${row.profileId}:${row.day}`), [
    '10:2026-08-26',
    '10:2026-08-27',
    '11:2026-08-26',
  ])
})
