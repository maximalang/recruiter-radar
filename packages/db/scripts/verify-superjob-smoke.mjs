import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.SOURCE_ENV_FILE_DISABLED = 'true';
process.env.SUPERJOB_INPUT_FILE = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  './superjob-publisher-types-smoke-fixture.json',
);

const { buildFetchSummary, resolveSuperjobConfiguredInput } = await import('./source-superjob.mjs');
const input = await resolveSuperjobConfiguredInput();
const summary = buildFetchSummary(input);

assert.equal(summary.inputMode, 'file');
assert.equal(summary.recordsReceived, 4);
assert.equal(summary.normalizedRecords, 4);

const byVacancyId = new Map(
  input.normalizedRecords.map((record) => [record.payload.vacancy_id, record]),
);

const directVacancy = byVacancyId.get('1001');
assert.ok(directVacancy, 'expected direct-employer vacancy');
assert.equal(directVacancy.companyName, 'Direct Product Company');
assert.equal(directVacancy.jobTitle, 'Backend Developer');
assert.equal(directVacancy.sourceUrl, 'https://example.test/superjob/1001');
assert.equal(directVacancy.occurredAt, '2026-08-12T11:00:00.000Z');
assert.equal(directVacancy.payload.location, 'Москва');
assert.equal(directVacancy.payload.salary, '180000–250000–rub');
assert.equal(directVacancy.payload.salary_rub_min, 180000);
assert.equal(directVacancy.payload.salary_rub_max, 250000);
assert.equal(directVacancy.payload.employment_type, 'Полный рабочий день');

assert.deepEqual(
  pickPublisherFields(byVacancyId.get('1001')),
  {
    publisherType: 'direct-employer',
    publisherTypeId: 1,
    publisherTypeLabel: 'прямой работодатель',
    candidateEligible: true,
  },
);
assert.deepEqual(
  pickPublisherFields(byVacancyId.get('1002')),
  {
    publisherType: 'recruitment-agency',
    publisherTypeId: 2,
    publisherTypeLabel: 'кадровое агентство',
    candidateEligible: false,
  },
);
assert.deepEqual(
  pickPublisherFields(byVacancyId.get('1003')),
  {
    publisherType: 'outsourcing',
    publisherTypeId: 3,
    publisherTypeLabel: 'аутсорс/аутстаф',
    candidateEligible: false,
  },
);
assert.deepEqual(
  pickPublisherFields(byVacancyId.get('1004')),
  {
    publisherType: 'aggregator',
    publisherTypeId: 4,
    publisherTypeLabel: 'Сервис-агрегатор',
    candidateEligible: false,
  },
);

for (const record of input.normalizedRecords.filter((entry) => !entry.payload.candidate_eligible)) {
  assert.ok(
    record.payload.quality_penalties.includes('non_direct_employer_posting'),
    `${record.payload.publisher_type} must carry an explicit quality penalty`,
  );
}

console.log(JSON.stringify({
  ok: true,
  smoke: 'superjob-publisher-attribution',
  recordsReceived: summary.recordsReceived,
  normalizedRecords: summary.normalizedRecords,
  directEmployerRecords: input.normalizedRecords.filter((record) => record.payload.candidate_eligible).length,
  nonDirectRecords: input.normalizedRecords.filter((record) => !record.payload.candidate_eligible).length,
}, null, 2));

function pickPublisherFields(record) {
  assert.ok(record, 'expected normalized SuperJob record');
  return {
    publisherType: record.payload.publisher_type,
    publisherTypeId: record.payload.publisher_type_id,
    publisherTypeLabel: record.payload.publisher_type_label,
    candidateEligible: record.payload.candidate_eligible,
  };
}
