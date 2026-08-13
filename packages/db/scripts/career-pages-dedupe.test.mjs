import assert from 'node:assert/strict';
import test from 'node:test';

import { buildNormalizedInput } from './source-career-pages.mjs';

function record(adapter, sourceUrl) {
  return {
    company_name: adapter === 'greenhouse-board' ? 'Greenhouse Co' : 'Lever Co',
    company_domain: adapter === 'greenhouse-board' ? 'greenhouse.example' : 'lever.example',
    career_page_url: sourceUrl,
    job_posting_url: sourceUrl,
    job_title: 'Software Engineer',
    external_id: '123',
    raw_target_adapter: adapter,
    extraction_method: adapter,
  };
}

test('provider-local external IDs cannot suppress a different ATS provenance edge', () => {
  const greenhouse = record('greenhouse-board', 'https://greenhouse.example/jobs/123');
  const lever = record('lever-postings', 'https://lever.example/jobs/123');
  const input = buildNormalizedInput({
    records: [greenhouse, lever, { ...greenhouse }],
    inputMode: 'fetch',
    inputFilePath: null,
    targetsFilePath: null,
    fetchOutputPath: null,
    targetResults: [],
    discoverySummary: null,
  });

  assert.equal(input.normalizedRecords.length, 2);
  assert.equal(input.duplicateRecords, 1);
  assert.deepEqual(input.normalizedRecords.map((item) => item.sourceId).sort(), [
    'greenhouse',
    'lever',
  ]);
  assert.deepEqual(input.familyDuplicateCounts, {
    greenhouse: 1,
    lever: 0,
  });
});
