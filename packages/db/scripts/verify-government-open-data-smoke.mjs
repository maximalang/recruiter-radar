import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildFetchSummary as buildFnsSummary, resolveFnsOpenDataConfiguredInput } from './source-fns-open-data.mjs';
import { buildFetchSummary as buildProcurementSummary, resolveGovernmentProcurementConfiguredInput } from './source-government-procurement.mjs';
import { buildFetchSummary as buildCbrSummary, resolveCbrRegistryConfiguredInput } from './source-cbr-registry.mjs';
import { buildFetchSummary as buildRosstatSummary, resolveRosstatOpenDataConfiguredInput } from './source-rosstat-open-data.mjs';
import { buildFetchSummary as buildRospatentSummary, resolveRospatentOpenDataConfiguredInput } from './source-rospatent-open-data.mjs';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const fixturePath = resolve(scriptDir, './government-open-data-smoke-fixture.json');

delete process.env.DATABASE_URL;
process.env.FNS_OPEN_DATA_INPUT_FILE = fixturePath;
process.env.GOVERNMENT_PROCUREMENT_INPUT_FILE = fixturePath;
process.env.CBR_REGISTRY_INPUT_FILE = fixturePath;
process.env.ROSSTAT_OPEN_DATA_INPUT_FILE = fixturePath;
process.env.ROSPATENT_OPEN_DATA_INPUT_FILE = fixturePath;
process.env.GOVERNMENT_ENRICHMENT_INNS = '7707083893';

const fns = await resolveFnsOpenDataConfiguredInput();
assert.equal(buildFnsSummary(fns).source, 'fns-open-data');
assert.equal(fns.normalizedRecords.some((record) => record.payload.event_type === 'headcount_growth'), true);
assert.equal(fns.normalizedRecords.some((record) => record.payload.event_type === 'revenue_growth'), true);
assert.equal(fns.normalizedRecords.some((record) => record.payload.event_type === 'new_government_support'), true);
assert.equal(fns.normalizedRecords.every((record) => record.inn === '7707083893'), true);
assert.equal(fns.normalizedRecords.every((record) => record.payload.context_only === true), true);

const procurement = await resolveGovernmentProcurementConfiguredInput();
assert.equal(buildProcurementSummary(procurement).source, 'government-procurement');
assert.equal(procurement.normalizedRecords.some((record) => record.payload.event_type === 'large_contract_award'), true);
assert.equal(procurement.normalizedRecords.some((record) => record.payload.event_type === 'new_region'), true);
assert.equal(procurement.normalizedRecords.every((record) => record.sourceUrl?.startsWith('https://zakupki.gov.ru/')), true);

const cbr = await resolveCbrRegistryConfiguredInput();
assert.equal(buildCbrSummary(cbr).source, 'cbr-registry');
assert.equal(cbr.normalizedRecords[0].payload.context_only, true);
assert.equal(cbr.normalizedRecords[0].payload.intent_signal, false);
assert.equal(cbr.normalizedRecords[0].payload.licenses[0].number, '1481');

const rosstat = await resolveRosstatOpenDataConfiguredInput();
assert.equal(buildRosstatSummary(rosstat).source, 'rosstat-open-data');
assert.equal(rosstat.normalizedRecords[0].sourceEntityType, 'aggregate_market');
assert.equal(rosstat.normalizedRecords[0].payload.company_attributed, false);
assert.equal(rosstat.normalizedRecords[0].inn, null);

const rospatent = await resolveRospatentOpenDataConfiguredInput();
assert.equal(buildRospatentSummary(rospatent).source, 'rospatent-open-data');
assert.equal(rospatent.normalizedRecords.length, 1);
assert.equal(rospatent.normalizedRecords[0].payload.context_strength, 'weak');
assert.equal(rospatent.normalizedRecords[0].payload.hiring_proof, false);

for (const input of [fns, procurement, cbr, rosstat, rospatent]) {
  assert.equal(input.sensitiveFieldsDropped, 0);
  assert.equal(input.normalizedRecords.every((record) => record.evidenceRole === 'context'), true);
}

console.log(JSON.stringify({
  ok: true,
  smoke: 'government-open-data',
  sources: ['fns-open-data', 'government-procurement', 'cbr-registry', 'rosstat-open-data', 'rospatent-open-data'],
  records: {
    fns: fns.normalizedRecords.length,
    procurement: procurement.normalizedRecords.length,
    cbr: cbr.normalizedRecords.length,
    rosstat: rosstat.normalizedRecords.length,
    rospatent: rospatent.normalizedRecords.length,
  },
  evidenceBoundary: 'all government sources are context-only and never standalone hiring proof',
}, null, 2));
