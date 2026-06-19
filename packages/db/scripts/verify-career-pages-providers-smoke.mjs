import assert from 'node:assert/strict';

import { mapGreenhouseBoardPayload, mapLeverPostingsPayload } from './source-career-pages.mjs';

// Offline coverage for the greenhouse-board / lever-postings response mappers.
// These adapters used to be exercised only by hitting the live boards in the
// career-pages fetch smoke, which was network-dependent and flaky (a live board
// returns hundreds of postings, never the fixture count). Mapping is now pure
// and verified here against canonical API payloads.

const greenhousePayload = {
  meta: { name: 'Discord', url: 'https://boards.greenhouse.io/discord' },
  jobs: [
    {
      id: 123,
      title: 'Software Engineer',
      absolute_url: 'https://boards.greenhouse.io/discord/jobs/123',
      location: { name: 'San Francisco' },
      metadata: [{ name: 'Employment Type', value: 'FULL_TIME' }],
      updated_at: '2026-05-26T00:00:00.000Z',
    },
  ],
};

const greenhouseTarget = {
  id: 'discord-greenhouse',
  adapter: 'greenhouse-board',
  companyName: 'Discord',
  companyDomain: 'discord.com',
  companyWebsiteUrl: 'https://discord.com/',
  careerPageUrl: 'https://boards.greenhouse.io/discord',
};

const greenhouseRecords = mapGreenhouseBoardPayload(greenhousePayload, greenhouseTarget);
assert.equal(greenhouseRecords.length, 1);
assert.deepEqual(
  {
    company_name: greenhouseRecords[0].company_name,
    company_domain: greenhouseRecords[0].company_domain,
    job_posting_url: greenhouseRecords[0].job_posting_url,
    job_title: greenhouseRecords[0].job_title,
    external_id: greenhouseRecords[0].external_id,
    location: greenhouseRecords[0].location,
    employment_type: greenhouseRecords[0].employment_type,
    occurred_at: greenhouseRecords[0].occurred_at,
    source_record_type: greenhouseRecords[0].source_record_type,
  },
  {
    company_name: 'Discord',
    company_domain: 'discord.com',
    job_posting_url: 'https://boards.greenhouse.io/discord/jobs/123',
    job_title: 'Software Engineer',
    external_id: '123',
    location: 'San Francisco',
    employment_type: 'FULL_TIME',
    occurred_at: '2026-05-26T00:00:00.000Z',
    source_record_type: 'job_posting',
  },
);

// Empty / malformed payloads must yield zero records, not throw.
assert.deepEqual(mapGreenhouseBoardPayload(null, greenhouseTarget), []);
assert.deepEqual(mapGreenhouseBoardPayload({}, greenhouseTarget), []);

const leverPayload = [
  {
    id: '456',
    text: 'Data Analyst',
    hostedUrl: 'https://jobs.lever.co/dnb/456',
    categories: { location: 'New York', commitment: 'FULL_TIME' },
    updatedAt: 1779408000000,
  },
];

const leverTarget = {
  id: 'dnb-lever',
  adapter: 'lever-postings',
  companyName: 'Dun & Bradstreet',
  companyDomain: 'dnb.com',
  companyWebsiteUrl: 'https://www.dnb.com/',
  careerPageUrl: 'https://jobs.lever.co/dnb',
};

const leverRecords = mapLeverPostingsPayload(leverPayload, leverTarget);
assert.equal(leverRecords.length, 1);
assert.equal(leverRecords[0].company_name, 'Dun & Bradstreet');
assert.equal(leverRecords[0].job_posting_url, 'https://jobs.lever.co/dnb/456');
assert.equal(leverRecords[0].job_title, 'Data Analyst');
assert.equal(leverRecords[0].external_id, '456');
assert.equal(leverRecords[0].location, 'New York');
assert.equal(leverRecords[0].employment_type, 'FULL_TIME');
assert.equal(leverRecords[0].source_record_type, 'job_posting');

assert.deepEqual(mapLeverPostingsPayload(null, leverTarget), []);
assert.deepEqual(mapLeverPostingsPayload({}, leverTarget), []);

console.log(JSON.stringify({
  ok: true,
  smoke: 'career-pages-providers',
  mode: 'offline-parse',
  greenhouseRecords: greenhouseRecords.length,
  leverRecords: leverRecords.length,
}, null, 2));
