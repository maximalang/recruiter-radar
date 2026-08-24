import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHhVacanciesUrl,
  describeHhFailure,
  fetchHhVacancyPages,
  HhCoverageTruncationError,
  resolveHhVacancySearchConfig,
} from './hh.mjs';
import { resetHhApplicationTokenCache } from './hh-oauth.mjs';

test('default HH source is broad 12-hour incremental discovery, not recruiter keyword sampling', () => {
  const config = resolveHhVacancySearchConfig({}, new Date('2026-08-19T12:00:00Z'));
  assert.equal(config.searchText, null);
  assert.equal(config.perPage, 100);
  assert.equal(config.pages, 20);
  assert.equal(config.adaptiveTimePartition, true);
  assert.equal(config.lookbackHours, 12);
  assert.deepEqual(config.extraParams.label, ['not_from_agency']);
  assert.deepEqual(config.extraParams.date_from, ['2026-08-19T00:00:00.000Z']);
  assert.deepEqual(config.extraParams.date_to, ['2026-08-19T12:00:00.000Z']);

  const url = buildHhVacanciesUrl(config, 0);
  assert.equal(url.searchParams.has('text'), false);
  assert.equal(url.searchParams.get('per_page'), '100');
  assert.equal(url.searchParams.get('page'), '0');
  assert.deepEqual(url.searchParams.getAll('label'), ['not_from_agency']);
});

test('explicit HH keyword preserves bounded diagnostic search without injecting a date window', () => {
  const config = resolveHhVacancySearchConfig({
    HH_SEARCH_TEXT: 'recruiter',
    HH_PER_PAGE: '2',
    HH_PAGES: '1',
  }, new Date('2026-08-19T12:00:00Z'));
  assert.equal(config.searchText, 'recruiter');
  assert.equal(config.adaptiveTimePartition, false);
  assert.equal(config.lookbackHours, null);
  assert.equal(config.extraParams.date_from, undefined);
  assert.equal(config.extraParams.date_to, undefined);
});

test('HH adaptive discovery splits a >2000 result window and dedupes the shared boundary', async () => {
  resetHhApplicationTokenCache();
  const requested = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    requested.push(parsed);
    const from = parsed.searchParams.get('date_from');
    const to = parsed.searchParams.get('date_to');
    const page = Number(parsed.searchParams.get('page'));

    if (from === '2026-08-19T00:00:00.000Z' && to === '2026-08-19T12:00:00.000Z') {
      return jsonResponse({ found: 2501, pages: 20, items: [{ id: 'probe-only' }] });
    }
    if (from === '2026-08-19T00:00:00.000Z' && to === '2026-08-19T06:00:00.000Z') {
      return jsonResponse({
        found: 2,
        pages: 1,
        items: page === 0 ? [{ id: 'left-1' }, { id: 'boundary' }] : [],
      });
    }
    if (from === '2026-08-19T06:00:00.000Z' && to === '2026-08-19T12:00:00.000Z') {
      return jsonResponse({
        found: 2,
        pages: 1,
        items: page === 0 ? [{ id: 'boundary' }, { id: 'right-1' }] : [],
      });
    }
    throw new Error(`unexpected HH request ${parsed}`);
  };

  try {
    const config = resolveHhVacancySearchConfig({ HH_LOOKBACK_HOURS: '12' }, new Date('2026-08-19T12:00:00Z'));
    const result = await fetchHhVacancyPages({
      userAgent: 'RecruiterRadarHHIncrementalTest/1.0',
      config,
      env: {},
    });
    assert.equal(result.adaptiveTimePartition, true);
    assert.equal(result.pagesFetched, 3);
    assert.deepEqual(result.items.map((item) => item.id).sort(), ['boundary', 'left-1', 'right-1']);
    assert.equal(result.partitions.filter((partition) => partition.split === true).length, 1);
    assert.equal(result.partitions.filter((partition) => partition.split === false).length, 2);
    assert.equal(requested.length, 3);
    assert.ok(requested.every((url) => !url.searchParams.has('text')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HH refuses silent truncation when minimum time partition still exceeds 2000', async () => {
  resetHhApplicationTokenCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ found: 2501, pages: 20, items: [{ id: 'too-many' }] });

  try {
    const config = {
      ...resolveHhVacancySearchConfig({}, new Date('2026-08-19T00:10:00Z')),
      minPartitionMinutes: 10,
      maxPartitionDepth: 12,
      extraParams: {
        label: ['not_from_agency'],
        date_from: ['2026-08-19T00:00:00.000Z'],
        date_to: ['2026-08-19T00:10:00.000Z'],
      },
    };
    await assert.rejects(
      () => fetchHhVacancyPages({
        userAgent: 'RecruiterRadarHHIncrementalTest/1.0',
        config,
        env: {},
      }),
      (error) => {
        assert.ok(error instanceof HhCoverageTruncationError);
        const diagnostic = describeHhFailure(error);
        assert.equal(diagnostic.errorType, 'coverage_truncation');
        assert.equal(diagnostic.coverageTruncation, true);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
