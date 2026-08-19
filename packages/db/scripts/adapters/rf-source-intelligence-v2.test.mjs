import assert from 'node:assert/strict';
import test from 'node:test';

import { auditOrganizationIdentityGraph } from './organization-identity-graph-audit.mjs';
import { classifyStrongIdentityKey } from './organization-resolution.mjs';
import {
  RF_DISCOVERY_FAMILY_IDS,
  listRfDiscoveryFamilies,
  validateRfDiscoveryFamilies,
} from './rf-discovery-families.mjs';
import {
  evaluateRfCoverageBenchmark,
} from './rf-coverage-benchmark.mjs';
import {
  evaluateTransportHealth,
  selectTransportStages,
} from './source-transport-health.mjs';

test('RF discovery families are explicit candidates, not fake live sources', () => {
  assert.equal(validateRfDiscoveryFamilies(), true);
  assert.deepEqual(listRfDiscoveryFamilies().map((family) => family.id), RF_DISCOVERY_FAMILY_IDS);
  assert.ok(listRfDiscoveryFamilies().every((family) => family.productionState === 'candidate'));
});

test('RF job-board domains cannot become strong employer domain identities', () => {
  for (const domain of ['avito.ru', 'www.avito.ru', 'rabota.ru', 'zarplata.ru', 'getmatch.ru', 'geekjob.ru']) {
    assert.equal(classifyStrongIdentityKey(`domain:${domain}`), null, domain);
  }
  assert.deepEqual(classifyStrongIdentityKey('domain:example.ru'), { key: 'domain:example.ru', type: 'domain' });
});

test('identity graph rejects one strong identity owned by multiple organizations', () => {
  const report = auditOrganizationIdentityGraph([
    { org_id: '10', source: 'hh', source_key: 'inn:7707083893' },
    { org_id: '11', source: 'rabota-ru', source_key: 'inn:7707083893' },
  ]);
  assert.equal(report.pass, false);
  assert.deepEqual(report.strongIdentityConflicts, [{ strongKey: 'inn:7707083893', orgIds: ['10', '11'] }]);
});

test('identity graph rejects job-board platform domains as employer identity', () => {
  const report = auditOrganizationIdentityGraph([
    { org_id: '10', source: 'getmatch', source_key: 'domain:getmatch.ru' },
  ]);
  assert.equal(report.pass, false);
  assert.equal(report.platformDomainRefs.length, 1);
  assert.equal(report.invalidStrongRefs.length, 0);
});

test('transport degradation reorders ordinary failures but never bypasses policy stops', () => {
  const attempts = [
    { at: '2026-08-19T00:00:00Z', stage: 'static-http', outcome: 'error' },
    { at: '2026-08-19T01:00:00Z', stage: 'static-http', outcome: 'error' },
    { at: '2026-08-19T02:00:00Z', stage: 'static-http', outcome: 'error' },
    { at: '2026-08-19T03:00:00Z', stage: 'static-http', outcome: 'error' },
  ];
  const health = evaluateTransportHealth(attempts);
  const selected = selectTransportStages(['static-http', 'structured-data', 'rendered-dom'], health);
  assert.deepEqual(selected.stages, ['structured-data', 'rendered-dom', 'static-http']);

  const blockedHealth = evaluateTransportHealth([
    { at: '2026-08-19T04:00:00Z', stage: 'static-http', outcome: 'blocked' },
  ]);
  const blockedSelection = selectTransportStages(['static-http', 'rendered-dom'], blockedHealth);
  assert.equal(blockedSelection.stoppedByPolicy, true);
  assert.deepEqual(blockedSelection.stages, []);
});

test('RF benchmark evaluates the V2 Definition of Done as measurable gates', () => {
  const benchmarkCompanies = Array.from({ length: 100 }, (_, index) => ({
    id: String(index + 1),
    hiringActive: true,
    evidenceAppearedAt: '2026-08-18T00:00:00Z',
    detectedAt: index < 96
      ? `2026-08-18T${String(index < 95 ? 6 : 11).padStart(2, '0')}:00:00Z`
      : null,
  }));
  const attributionAudits = Array.from({ length: 200 }, (_, index) => ({ wrongCompany: index === 0 }));
  const demandRows = Array.from({ length: 100 }, (_, index) => ({ canonicalDemandId: index === 99 ? 'demand-99' : `demand-${index + 1}` }));
  const priorityOpportunities = Array.from({ length: 100 }, (_, index) => ({
    directEvidence: index < 70,
    independentCorroboration: index >= 70 && index < 92,
  }));

  const report = evaluateRfCoverageBenchmark({
    benchmarkCompanies,
    attributionAudits,
    demandRows,
    priorityOpportunities,
  });

  assert.equal(report.metrics.weeklyRecall, 0.96);
  assert.equal(report.metrics.discoveryLatencyP95Hours, 6);
  assert.equal(report.metrics.wrongCompanyAttributionRate, 0.005);
  assert.equal(report.metrics.duplicateHiringDemandRate, 0.01);
  assert.equal(report.metrics.priorityCorroborationRate, 0.92);
  assert.equal(report.pass, true);
});
