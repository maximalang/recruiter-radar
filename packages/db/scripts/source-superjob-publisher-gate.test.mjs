import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifySuperjobPublisher,
  normalizeSuperjobRecord,
} from './source-superjob.mjs';

const context = {
  fetchedAt: '2026-08-19T12:00:00.000Z',
  lineNumber: 1,
};

test('SuperJob publisher classifier maps official agency ids deterministically', () => {
  assert.deepEqual(classifySuperjobPublisher({ id: 1, title: 'Прямой работодатель' }), {
    id: 1,
    label: 'Прямой работодатель',
    type: 'direct-employer',
    candidateEligible: true,
  });
  assert.equal(classifySuperjobPublisher({ id: 2 }).type, 'recruitment-agency');
  assert.equal(classifySuperjobPublisher({ id: 3 }).type, 'outsourcing');
  assert.equal(classifySuperjobPublisher({ id: 4 }).type, 'aggregator');
});

test('native direct-employer vacancy survives the source boundary', () => {
  const normalized = normalizeSuperjobRecord(nativeVacancy({ agencyId: 1 }), context);
  assert.ok(normalized);
  assert.equal(normalized.payload.publisher_type, 'direct-employer');
  assert.equal(normalized.payload.candidate_eligible, true);
});

for (const [agencyId, type] of [[2, 'recruitment-agency'], [3, 'outsourcing'], [4, 'aggregator']]) {
  test(`native SuperJob ${type} vacancy is rejected before signal creation`, () => {
    const normalized = normalizeSuperjobRecord(nativeVacancy({ agencyId }), context);
    assert.equal(normalized, null);
  });
}

test('reviewed generic snapshot can explicitly mark a record ineligible', () => {
  const normalized = normalizeSuperjobRecord({
    id: 'generic-1',
    job_title: 'Backend Developer',
    company_name: 'Example',
    company_domain: 'example.ru',
    job_posting_url: 'https://example.ru/jobs/backend',
    published_at: '2026-08-19T10:00:00Z',
    candidate_eligible: false,
  }, context);
  assert.equal(normalized, null);
});

function nativeVacancy({ agencyId }) {
  return {
    id: 101,
    profession: 'Backend Developer',
    firm_name: 'Direct Example',
    client: '7707083893',
    link: 'https://www.superjob.ru/vakansii/backend-developer-101.html',
    date_published: Math.floor(Date.parse('2026-08-19T10:00:00Z') / 1000),
    town: { title: 'Москва' },
    agency: { id: agencyId, title: `Agency ${agencyId}` },
  };
}
