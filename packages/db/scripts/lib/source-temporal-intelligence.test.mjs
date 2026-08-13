import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveTemporalEvents } from './source-temporal-intelligence.mjs';

test('derives vacancy deltas and structural changes without inventing source ids', () => {
  const events = deriveTemporalEvents({ subjectType: 'vacancies', current: { current_count: 8, roles: ['Backend', 'Sales'], reopened_roles: ['Backend'], geographies: ['Moscow', 'Kazan'], departments: ['Engineering', 'Sales'] }, history: [
    { ageDays: 7, metrics: { current_count: 5, roles: ['Backend'], geographies: ['Moscow'], departments: ['Engineering'] } },
    { ageDays: 14, metrics: { current_count: 4 } }, { ageDays: 30, metrics: { current_count: 3 } },
  ] });
  assert.deepEqual(events.filter((e) => e.eventType === 'vacancy_count_change').map((e) => [e.windowDays, e.delta.change]), [[7, 3], [14, 4], [30, 5]]);
  assert.ok(events.some((e) => e.eventType === 'roles_newly_opened' && e.delta.added.includes('Sales')));
  assert.ok(events.some((e) => e.eventType === 'role_reopened'));
  assert.ok(events.some((e) => e.eventType === 'geography_expansion'));
  assert.ok(events.some((e) => e.eventType === 'new_department'));
  assert.equal(events.some((e) => 'sourceId' in e), false);
});

test('derives registry, procurement, and Rospatent trajectories', () => {
  assert.ok(deriveTemporalEvents({ subjectType: 'fns_company', current: { headcount: 30, revenue: 500, support_count: 2 }, history: [{ ageDays: 30, metrics: { headcount: 20, revenue: 300, support_count: 1 } }] }).some((e) => e.eventType === 'headcount_trajectory'));
  const procurement = deriveTemporalEvents({ subjectType: 'government_procurement', current: { contract_count: 3, aggregate_value: 900, customers: ['A', 'B'], regions: ['77', '16'] }, history: [{ ageDays: 30, metrics: { contract_count: 1, aggregate_value: 100, customers: ['A'], regions: ['77'] } }] });
  assert.ok(procurement.some((e) => e.eventType === 'contract_series'));
  assert.ok(procurement.some((e) => e.eventType === 'aggregate_value_acceleration'));
  assert.ok(procurement.some((e) => e.eventType === 'new_customer'));
  const patents = deriveTemporalEvents({ subjectType: 'rospatent', current: { application_count: 4, registration_count: 2 }, history: [{ ageDays: 30, metrics: { application_count: 1, registration_count: 0 } }] });
  assert.ok(patents.some((e) => e.eventType === 'new_application'));
  assert.ok(patents.some((e) => e.eventType === 'new_registration'));
});

test('treats the first observation as a baseline without derived events', () => {
  assert.deepEqual(deriveTemporalEvents({ subjectType: 'vacancies', current: { current_count: 2, roles: ['A'], geographies: ['Moscow'] }, history: [] }), []);
});
