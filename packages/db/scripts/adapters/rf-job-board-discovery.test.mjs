import assert from 'node:assert/strict';
import test from 'node:test';

import {
  discoverRfJobBoardSurface,
  extractPublicJobPostingsFromHtml,
  extractPublicPaginationLinks,
  extractPublicVacancyLinks,
} from './rf-job-board-discovery.mjs';

const FAMILY = {
  id: 'getmatch',
  platformDomains: ['getmatch.ru'],
  transportStages: ['static-http', 'structured-data', 'rendered-dom', 'extraction'],
};

const HTML = `<!doctype html>
<html>
<head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "JobPosting",
  "title": "Senior Backend Developer",
  "datePosted": "2026-08-19",
  "validThrough": "2026-09-19T23:59:59+03:00",
  "identifier": {"value": "vac-42"},
  "hiringOrganization": {"name": "Example", "sameAs": "https://example.ru"},
  "jobLocation": {"address": {"addressLocality": "Москва", "addressCountry": "RU"}},
  "employmentType": ["FULL_TIME"],
  "url": "https://getmatch.ru/vacancies/42?utm_source=test"
}
</script>
</head>
<body>
<a href="/vacancies/42?utm_source=catalog">Senior Backend Developer</a>
<a href="https://evil.example/vacancies/42">offsite</a>
<a href="/companies/example">company</a>
<a href="/vacancies?page=2">2</a>
<a href="/vacancies?page=3">3</a>
</body>
</html>`;

test('extracts bounded public JobPosting evidence without evaluating scripts', () => {
  const postings = extractPublicJobPostingsFromHtml(HTML, 'https://getmatch.ru/vacancies');
  assert.equal(postings.length, 1);
  assert.equal(postings[0].title, 'Senior Backend Developer');
  assert.equal(postings[0].employerName, 'Example');
  assert.equal(postings[0].vacancyUrl, 'https://getmatch.ru/vacancies/42');
  assert.equal(postings[0].externalId, 'vac-42');
  assert.equal(postings[0].location, 'Москва, RU');
  assert.deepEqual(postings[0].employmentType, ['FULL_TIME']);
});

test('keeps only same-platform vacancy links', () => {
  const links = extractPublicVacancyLinks(HTML, 'https://getmatch.ru/vacancies', FAMILY);
  assert.deepEqual(links, [
    'https://getmatch.ru/vacancies/42',
    'https://getmatch.ru/vacancies?page=2',
    'https://getmatch.ru/vacancies?page=3',
  ]);
});

test('extracts only pagination links belonging to the configured listing root', () => {
  const html = `
    <a href="/vacancies/2">2</a>
    <a rel="next" href="/vacancies/3">Далее</a>
    <a href="/vacancies/20541-senior-go-developer">Senior Go Developer</a>
    <a href="/companies/2">2</a>
    <a href="https://evil.example/vacancies/4">4</a>
  `;
  const geekjob = { id: 'geekjob', platformDomains: ['geekjob.ru'] };
  const links = extractPublicPaginationLinks(
    html,
    'https://geekjob.ru/vacancies/',
    geekjob,
    { baseUrl: 'https://geekjob.ru/vacancies/' },
  );
  assert.deepEqual(links, [
    'https://geekjob.ru/vacancies/2',
    'https://geekjob.ru/vacancies/3',
  ]);
});

test('paginationBaseUrl preserves the root when crawling a later page', () => {
  const geekjob = { id: 'geekjob', platformDomains: ['geekjob.ru'] };
  const links = extractPublicPaginationLinks(
    '<a href="/vacancies/3">3</a>',
    'https://geekjob.ru/vacancies/2',
    geekjob,
    {
      baseUrl: 'https://geekjob.ru/vacancies/2',
      paginationBaseUrl: 'https://geekjob.ru/vacancies/',
    },
  );
  assert.deepEqual(links, ['https://geekjob.ru/vacancies/3']);
});

test('robots disallow is terminal before the target page is fetched', async () => {
  const calls = [];
  const result = await discoverRfJobBoardSurface(FAMILY, { baseUrl: 'https://getmatch.ru/vacancies' }, {
    fetchTextImpl: async (url) => {
      calls.push(url);
      if (url.endsWith('/robots.txt')) {
        return {
          response: { url },
          body: 'User-agent: *\nDisallow: /vacancies',
        };
      }
      throw new Error('target page must not be fetched after robots denial');
    },
  });
  assert.equal(result.blocked, true);
  assert.equal(result.reason, 'robots-disallow');
  assert.equal(calls.length, 1);
});

test('robots-allowed surface produces postings, discovery links and pagination', async () => {
  const result = await discoverRfJobBoardSurface(FAMILY, { baseUrl: 'https://getmatch.ru/vacancies' }, {
    fetchTextImpl: async (url) => {
      if (url.endsWith('/robots.txt')) {
        return {
          response: { url },
          body: 'User-agent: *\nAllow: /',
        };
      }
      return {
        response: { url: 'https://getmatch.ru/vacancies' },
        body: HTML,
      };
    },
  });
  assert.equal(result.blocked, false);
  assert.equal(result.selectedStage, 'structured-data');
  assert.equal(result.structuredPostings.length, 1);
  assert.ok(result.vacancyLinks.includes('https://getmatch.ru/vacancies/42'));
  assert.deepEqual(result.paginationLinks, [
    'https://getmatch.ru/vacancies?page=2',
    'https://getmatch.ru/vacancies?page=3',
  ]);
});
