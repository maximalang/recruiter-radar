import assert from 'node:assert/strict';

import {
  extractVacanciesFromMarkdown,
  validateCareerVacancyRecord,
} from '../source-career-pages.mjs';

const target = {
  companyName: 'Example Employer',
  companyDomain: 'example.com',
  companyWebsiteUrl: 'https://example.com',
  careerPageUrl: 'https://careers.example.com/jobs',
  sourceUrl: 'https://careers.example.com/jobs',
};

const records = extractVacanciesFromMarkdown(
  '[Senior Backend Engineer](https://careers.example.com/jobs/backend-1)\n'
    + '[Apply](https://careers.example.com/jobs/backend-1/apply)\n'
    + '[Unrelated role](https://attacker.example/jobs/1)',
  {
    companyName: target.companyName,
    companyDomain: target.companyDomain,
    companyWebsiteUrl: target.companyWebsiteUrl,
    careerPageUrl: target.careerPageUrl,
  },
  'crawl4ai',
);

assert.equal(records.length, 2, 'parser keeps plausible links; validator applies host boundary');
assert.equal(validateCareerVacancyRecord(records[0], target), true);
assert.equal(validateCareerVacancyRecord(records[1], target), false);
assert.equal(validateCareerVacancyRecord({
  ...records[0],
  company_name: 'Different Employer',
}, target), false, 'company identity mismatch must fail closed');
assert.equal(validateCareerVacancyRecord({
  ...records[0],
  job_title: '',
}, target), false, 'vacancy title is required');
assert.equal(validateCareerVacancyRecord({
  ...records[0],
  job_posting_url: 'http://127.0.0.1/private',
}, target), false, 'canonical public URL is required');

console.log(JSON.stringify({
  ok: true,
  smoke: 'source-career-escalation',
  parsedRecords: records.length,
}, null, 2));
