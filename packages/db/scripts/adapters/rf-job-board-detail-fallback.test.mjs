import assert from 'node:assert/strict';
import test from 'node:test';

import { extractRfJobDetailFallback } from './rf-job-board-detail-fallback.mjs';

test('GeekJob detail fallback extracts platform employer profile and agency publisher type', () => {
  const posting = extractRfJobDetailFallback(`
    <html><body>
      <h1>Senior AI / ML Engineer</h1>
      <div>Агентство / HR ресурс</div>
      <a href="/company/661d1ab166825803e30eefc2">NEWHR</a>
      <time datetime="2026-08-07T10:00:00+03:00">7 августа</time>
    </body></html>
  `, 'https://geekjob.ru/vacancy/69e2482a2215b591570d4e22', {
    id: 'geekjob',
    platformDomains: ['geekjob.ru'],
  });

  assert.ok(posting);
  assert.equal(posting.title, 'Senior AI / ML Engineer');
  assert.equal(posting.employerName, 'NEWHR');
  assert.equal(posting.employerUrl, 'https://geekjob.ru/company/661d1ab166825803e30eefc2');
  assert.equal(posting.publisherType, 'agency');
  assert.equal(posting.externalId, '69e2482a2215b591570d4e22');
  assert.equal(posting.datePosted, '2026-08-07T07:00:00.000Z');
});

test('getmatch detail fallback accepts stable numeric vacancy route', () => {
  const posting = extractRfJobDetailFallback(`
    <h1>Senior Go Developer</h1>
    <a href="/companies/N0l4OQ8J-getmatch-agency?s=vacancy">getmatch agency</a>
    <div>Сфера: Рекрутинговое агентство</div>
  `, 'https://getmatch.ru/vacancies/20541-senior-go-developer', {
    id: 'getmatch',
    platformDomains: ['getmatch.ru'],
  });

  assert.ok(posting);
  assert.equal(posting.externalId, '20541');
  assert.equal(posting.publisherType, 'agency');
  assert.equal(posting.employerName, 'getmatch agency');
});

test('listing/filter pages are never interpreted as detail postings', () => {
  const posting = extractRfJobDetailFallback(
    '<h1>Вакансии кладовщика в Москве</h1>',
    'https://www.rabota.ru/vacancy/кладовщик/75000%20руб/',
    { id: 'rabota-ru', platformDomains: ['rabota.ru'] },
  );
  assert.equal(posting, null);
});
