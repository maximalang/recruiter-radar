import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRabotaRossiiApiUrl,
  buildRabotaRossiiPageOffsets,
  resolveRabotaRossiiLiveInput,
} from './source-rabota-rossii.mjs';

test('trudvsem offset advances by page number rather than record count', () => {
  assert.deepEqual(buildRabotaRossiiPageOffsets({ offset: 0, pages: 5 }), [0, 1, 2, 3, 4]);
  assert.deepEqual(buildRabotaRossiiPageOffsets({ offset: 7, pages: 3 }), [7, 8, 9]);
});

test('region is encoded in the official endpoint path and modifiedFrom works without keyword sampling', () => {
  const url = new URL(buildRabotaRossiiApiUrl({
    regionCode: '7700000000000',
    offset: 1,
    limit: 100,
    modifiedFrom: '2026-08-19T00:00:00Z',
  }));
  assert.equal(url.pathname, '/api/v1/vacancies/region/7700000000000');
  assert.equal(url.searchParams.get('offset'), '1');
  assert.equal(url.searchParams.get('limit'), '100');
  assert.equal(url.searchParams.get('modifiedFrom'), '2026-08-19T00:00:00.000Z');
  assert.equal(url.searchParams.has('text'), false);
  assert.equal(url.searchParams.has('region_code'), false);
});

test('federal incremental URL has no artificial region or text filter', () => {
  const url = new URL(buildRabotaRossiiApiUrl({
    offset: 0,
    limit: 100,
    modifiedFrom: '2026-08-18T12:00:00Z',
    modifiedTo: '2026-08-19T12:00:00Z',
  }));
  assert.equal(url.pathname, '/api/v1/vacancies');
  assert.equal(url.searchParams.has('text'), false);
  assert.equal(url.searchParams.get('modifiedFrom'), '2026-08-18T12:00:00.000Z');
  assert.equal(url.searchParams.get('modifiedTo'), '2026-08-19T12:00:00.000Z');
});

test('live pagination requests consecutive page offsets and normalizes wrapped vacancy records', async () => {
  const requested = [];
  const pages = new Map([
    ['0', {
      status: '200',
      meta: { total: '3' },
      results: { vacancies: [wrappedVacancy('vac-1', 'Инженер'), wrappedVacancy('vac-2', 'Аналитик')] },
    }],
    ['1', {
      status: '200',
      meta: { total: '3' },
      results: { vacancies: [wrappedVacancy('vac-3', 'Разработчик')] },
    }],
  ]);

  const input = await resolveRabotaRossiiLiveInput({
    modifiedFrom: '2026-08-19T00:00:00Z',
    offset: 0,
    limit: 2,
    pages: 5,
    fetchJsonImpl: async (url) => {
      const parsed = new URL(url);
      requested.push(parsed);
      return pages.get(parsed.searchParams.get('offset')) ?? {
        status: '200', meta: { total: '3' }, results: { vacancies: [] },
      };
    },
  });

  assert.deepEqual(requested.map((url) => url.searchParams.get('offset')), ['0', '1']);
  assert.ok(requested.every((url) => url.searchParams.get('modifiedFrom') === '2026-08-19T00:00:00.000Z'));
  assert.equal(input.recordsReceived, 3);
  assert.equal(input.normalizedRecords.length, 3);
  assert.equal(input.normalizedRecords[0].headline, 'Инженер');
  assert.equal(input.normalizedRecords[0].inn, '7707083893');
  assert.equal(input.pagesFetched, 2);
  assert.equal(input.apiTotal, 3);
});

test('region fan-out uses independent official path partitions', async () => {
  const requested = [];
  await resolveRabotaRossiiLiveInput({
    regionCodes: ['7700000000000', '7800000000000'],
    modifiedFrom: '2026-08-19T00:00:00Z',
    limit: 100,
    pages: 1,
    fetchJsonImpl: async (url) => {
      const parsed = new URL(url);
      requested.push(parsed.pathname);
      return { status: '200', meta: { total: '0' }, results: { vacancies: [] } };
    },
  });
  assert.deepEqual(requested, [
    '/api/v1/vacancies/region/7700000000000',
    '/api/v1/vacancies/region/7800000000000',
  ]);
});

function wrappedVacancy(id, title) {
  return {
    vacancy: {
      id,
      'job-name': title,
      vac_url: `https://trudvsem.ru/vacancy/card/7707083893/${id}`,
      date_modify: '2026-08-19T10:00:00Z',
      'creation-date': '2026-08-18T10:00:00Z',
      region: { name: 'Москва', region_code: '7700000000000' },
      company: {
        name: 'ПАО Сбербанк',
        inn: '7707083893',
        ogrn: '1027700132195',
        site: 'https://www.sberbank.ru/',
      },
    },
  };
}
