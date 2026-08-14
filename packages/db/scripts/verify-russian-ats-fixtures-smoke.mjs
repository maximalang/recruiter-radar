import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  detectCareerPageTargetFromHtml,
  extractVacancyCardsFromSameDomainHtml,
  extractEStaffSitemapVacancyUrls,
  isHostedAtsVacancyUrl,
  validateCareerVacancyRecord,
} from './source-career-pages.mjs';

assert.deepEqual(
  extractEStaffSitemapVacancyUrls(`
    <urlset>
      <url><loc>https://job.example.ru/vacancies</loc></url>
      <url><loc>https://job.example.ru/vacancies/moscow/data-analyst--42</loc></url>
      <url><loc>https://job.example.ru/api/hr/vacancies/compact</loc></url>
    </urlset>
  `, 'https://job.example.ru/vacancies'),
  ['https://job.example.ru/vacancies/moscow/data-analyst--42'],
);

const cases = [
  ['huntflow', 'russian-ats-huntflow-smoke-fixture.html', 'hate agency', 'hateagency.com', 'https://hatehr.huntflow.io/', 'Senior account manager'],
  ['friendwork', 'russian-ats-friendwork-smoke-fixture.html', 'GGSEL', 'ggsel.net', 'https://jobs.friend.work/ggsel', 'Data Analyst'],
  ['potok', 'russian-ats-potok-smoke-fixture.html', 'B1', 'b1.ru', 'https://b1.potok.io/open/jobs', 'Бизнес-аналитик'],
  ['e-staff', 'russian-ats-estaff-smoke-fixture.html', 'Lamoda', 'lamoda.ru', 'https://job.lamoda.ru/vacancies?city=kaluga', 'Менеджер по продажам в пункт выдачи заказов'],
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

  const detectionHtml = item.family === 'e-staff'
    ? `<script type="application/json">{"hrSystem":{"name":"estaff"}}</script><a href="${item.sourceUrl}">careers</a>`
    : `<a href="${item.sourceUrl}">Вакансии</a>`;
  const detection = detectCareerPageTargetFromHtml(detectionHtml, {
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
