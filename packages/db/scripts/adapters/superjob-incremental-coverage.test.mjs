import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSuperjobVacanciesUrl,
  fetchSuperjobVacancyPages,
  resolveSuperjobSearchConfig,
  SuperjobCoverageTruncationError,
} from './superjob.mjs';

test('default SuperJob source is broad 12-hour incremental discovery, not keyword sampling', () => {
  const config = resolveSuperjobSearchConfig({}, new Date('2026-08-19T12:00:00Z'));
  assert.equal(config.keyword, null);
  assert.equal(config.perPage, 100);
  assert.equal(config.pages, 5);
  assert.equal(config.adaptiveTimePartition, true);
  assert.equal(config.lookbackHours, 12);
  assert.equal(config.extraParams.date_published_from, String(Date.parse('2026-08-19T00:00:00Z') / 1000));
  assert.equal(config.extraParams.date_published_to, String(Date.parse('2026-08-19T12:00:00Z') / 1000));
  assert.equal(config.extraParams.order_field, 'date');
  assert.equal(config.extraParams.order_direction, 'desc');

  const url = buildSuperjobVacanciesUrl(config, 0);
  assert.equal(url.searchParams.has('keyword'), false);
  assert.equal(url.searchParams.get('count'), '100');
  assert.equal(url.searchParams.get('page'), '0');
});

test('explicit SuperJob keyword preserves diagnostic search without implicit time partition', () => {
  const config = resolveSuperjobSearchConfig({
    SUPERJOB_KEYWORD: 'recruiter',
    SUPERJOB_PER_PAGE: '2',
    SUPERJOB_PAGES: '1',
  }, new Date('2026-08-19T12:00:00Z'));
  assert.equal(config.keyword, 'recruiter');
  assert.equal(config.adaptiveTimePartition, false);
  assert.equal(config.lookbackHours, null);
  assert.equal(config.extraParams.date_published_from, undefined);
});

test('SuperJob adaptive discovery splits a >500 result window and dedupes the boundary', async () => {
  const requests = [];
  const config = resolveSuperjobSearchConfig({}, new Date('2026-08-19T12:00:00Z'));
  const from = Math.floor(Date.parse('2026-08-19T00:00:00Z') / 1000);
  const mid = Math.floor(Date.parse('2026-08-19T06:00:00Z') / 1000);
  const to = Math.floor(Date.parse('2026-08-19T12:00:00Z') / 1000);

  const result = await fetchSuperjobVacancyPages({
    appId: 'test-app-id',
    config,
    fetchJsonImpl: async (url) => {
      const parsed = new URL(url);
      requests.push(parsed);
      const start = Number(parsed.searchParams.get('date_published_from'));
      const end = Number(parsed.searchParams.get('date_published_to'));
      if (start === from && end === to) {
        return { total: 701, more: true, objects: [{ id: 999 }] };
      }
      if (start === from && end === mid) {
        return { total: 2, more: false, objects: [{ id: 1 }, { id: 2 }] };
      }
      if (start === mid && end === to) {
        return { total: 2, more: false, objects: [{ id: 2 }, { id: 3 }] };
      }
      throw new Error(`unexpected SuperJob request: ${parsed}`);
    },
  });

  assert.equal(result.adaptiveTimePartition, true);
  assert.equal(result.pagesFetched, 3);
  assert.deepEqual(result.items.map((item) => item.id).sort((a, b) => a - b), [1, 2, 3]);
  assert.equal(result.partitions.filter((partition) => partition.split).length, 1);
  assert.equal(result.partitions.filter((partition) => !partition.split).length, 2);
  assert.equal(requests.length, 3);
  assert.ok(requests.every((url) => !url.searchParams.has('keyword')));
});

test('SuperJob refuses silent truncation at the minimum date partition', async () => {
  const config = {
    ...resolveSuperjobSearchConfig({}, new Date('2026-08-19T00:10:00Z')),
    minPartitionMinutes: 10,
    extraParams: {
      date_published_from: String(Math.floor(Date.parse('2026-08-19T00:00:00Z') / 1000)),
      date_published_to: String(Math.floor(Date.parse('2026-08-19T00:10:00Z') / 1000)),
      order_field: 'date',
      order_direction: 'desc',
    },
  };

  await assert.rejects(
    () => fetchSuperjobVacancyPages({
      appId: 'test-app-id',
      config,
      fetchJsonImpl: async () => ({ total: 501, more: true, objects: [{ id: 1 }] }),
    }),
    (error) => {
      assert.ok(error instanceof SuperjobCoverageTruncationError);
      assert.equal(error.code, 'superjob_coverage_truncation');
      return true;
    },
  );
});

test('bounded explicit keyword search can still be used for a production transport verifier', async () => {
  const config = resolveSuperjobSearchConfig({
    SUPERJOB_KEYWORD: 'recruiter',
    SUPERJOB_PER_PAGE: '2',
    SUPERJOB_PAGES: '1',
  });
  const result = await fetchSuperjobVacancyPages({
    appId: 'test-app-id',
    config,
    fetchJsonImpl: async (url) => {
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get('keyword'), 'recruiter');
      return { total: 1000, more: true, objects: [{ id: 1 }, { id: 2 }] };
    },
  });
  assert.equal(result.adaptiveTimePartition, false);
  assert.equal(result.items.length, 2);
});
