import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  detectCareerPageTargetFromHtml,
  extractVacancyCardsFromSameDomainHtml,
  isHostedAtsVacancyUrl,
  validateCareerVacancyRecord,
} from './source-career-pages.mjs';

const cases = [
  ['huntflow', 'russian-ats-huntflow-smoke-fixture.html', 'hate agency', 'hateagency.com', 'https://hatehr.huntflow.io/', 'Senior account manager'],
  ['friendwork', 'russian-ats-friendwork-smoke-fixture.html', 'GGSEL', 'ggsel.net', 'https://jobs.friend.work/ggsel', 'Data Analyst'],
  ['potok', 'russian-ats-potok-smoke-fixture.html', 'B1', 'b1.ru', 'https://b1.potok.io/open/jobs', 'Бизнес-аналитик'],
].map(([family, fixture, companyName, companyDomain, sourceUrl, expectedTitle]) => ({
  family, fixture, companyName, companyDomain, sourceUrl, expectedTitle,
}));

for (const item of cases) {
  const html = readFileSync(resolve(import.meta.dirname, item.fixture), 'utf8');
  const seed = {
    companyName: item.companyName,
    companyDomain: item.companyDomain,
    companyWebsiteUrl: `https://${item.companyDomain}/`,
    careerPageUrl: item.sourceUrl,
    sourceUrl: item.sourceUrl,
  };
  const records = extractVacancyCardsFromSameDomainHtml(html, seed);
  assert.equal(records.length, 1, `${item.family} fixture must yield one vacancy`);
  assert.equal(records[0].job_title, item.expectedTitle);
  assert.equal(isHostedAtsVacancyUrl(records[0].job_posting_url, item.family), true);
  assert.equal(validateCareerVacancyRecord(records[0], { ...seed, hostedAtsFamily: item.family }), true);

  const detection = detectCareerPageTargetFromHtml(`<a href="${item.sourceUrl}">Вакансии</a>`, {
    baseUrl: `https://${item.companyDomain}/career`,
    orgName: item.companyName,
    domain: item.companyDomain,
    websiteUrl: `https://${item.companyDomain}/`,
  });
  assert.equal(detection.targets[0]?.hosted_ats_family, item.family);
}

console.log(JSON.stringify({
  ok: true,
  smoke: 'russian-ats-fixtures',
  families: cases.map((item) => item.family),
}));
