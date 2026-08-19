import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createGdeltDocClient } from './gdelt-doc-client.mjs';

test('GDELT scheduler honors Retry-After and then caches the response', async () => {
  let currentTime = 1_000_000;
  const sleeps = [];
  let requests = 0;
  const client = createGdeltDocClient({
    persist: false,
    minIntervalMs: 5_000,
    cacheTtlMs: 60_000,
    now: () => currentTime,
    sleep: async (ms) => {
      sleeps.push(ms);
      currentTime += ms;
    },
    random: () => 0.5,
    requestImpl: async () => {
      requests += 1;
      if (requests === 1) {
        return {
          status: 429,
          headers: { get: () => '12' },
          json: async () => ({}),
        };
      }
      return {
        status: 200,
        headers: { get: () => null },
        json: async () => ({ articles: [{ title: 'Result' }] }),
      };
    },
  });

  const first = await client.request('https://api.gdeltproject.org/api/v2/doc/doc?query=one');
  const cached = await client.request('https://api.gdeltproject.org/api/v2/doc/doc?query=one');
  assert.equal(requests, 2);
  assert.deepEqual(sleeps, [12_000]);
  assert.equal(first.attempts, 2);
  assert.equal(cached.cacheHit, true);
  assert.deepEqual(cached.body, first.body);
});

test('GDELT scheduler serializes distinct queries through one reservation clock', async () => {
  let currentTime = 10_000;
  const sleeps = [];
  const client = createGdeltDocClient({
    persist: false,
    minIntervalMs: 6_000,
    cacheTtlMs: 60_000,
    now: () => currentTime,
    sleep: async (ms) => {
      sleeps.push(ms);
      currentTime += ms;
    },
    requestImpl: async () => ({
      status: 200,
      headers: { get: () => null },
      json: async () => ({ articles: [] }),
    }),
  });

  await client.request('https://api.gdeltproject.org/api/v2/doc/doc?query=one');
  await client.request('https://api.gdeltproject.org/api/v2/doc/doc?query=two');
  assert.deepEqual(sleeps, [6_000]);
});

test('controlled verifier can stop after one throttled request with machine-readable state', async () => {
  const client = createGdeltDocClient({
    persist: false,
    maxAttempts: 1,
    requestImpl: async () => ({
      status: 429,
      headers: { get: (name) => name === 'retry-after' ? '30' : null },
      json: async () => ({}),
    }),
  });

  await assert.rejects(
    () => client.request('https://api.gdeltproject.org/api/v2/doc/doc?query=controlled'),
    (error) => error.status === 429 && error.retryAfter === '30' && error.attempts === 1,
  );
});

test('GDELT scheduler persists no-Retry-After cooldown across processes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rr-gdelt-cooldown-'));
  const cachePath = join(directory, 'gdelt-cache.json');
  let requests = 0;
  try {
    const firstClient = createGdeltDocClient({
      cachePath,
      maxAttempts: 4,
      now: () => 1_000_000,
      random: () => 0.5,
      requestImpl: async () => {
        requests += 1;
        return {
          status: 429,
          headers: { get: () => null },
          json: async () => ({}),
        };
      },
    });
    await assert.rejects(
      () => firstClient.request('https://api.gdeltproject.org/api/v2/doc/doc?query=controlled'),
      (error) => error.status === 429 && error.attempts === 1 && error.retryAt === 2_800_000,
    );

    const secondClient = createGdeltDocClient({
      cachePath,
      now: () => 1_060_000,
      requestImpl: async () => {
        requests += 1;
        throw new Error('network request must not run during persistent cooldown');
      },
    });
    await assert.rejects(
      () => secondClient.request('https://api.gdeltproject.org/api/v2/doc/doc?query=another'),
      (error) => (
        error.status === 429
        && error.attempts === 0
        && error.deferred === true
        && error.retryAt === 2_800_000
      ),
    );
    assert.equal(requests, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('GDELT DOC throttle falls back to identity-bound GAL RSS records', async () => {
  const client = createGdeltDocClient({
    persist: false,
    maxAttempts: 1,
    now: () => Date.parse('2026-08-19T12:00:00.000Z'),
    requestImpl: async () => ({
      status: 429,
      headers: { get: () => null },
      json: async () => ({}),
    }),
    galItems: [
      {
        title: 'RocketScale raises Series B and expands engineering hiring',
        summary: null,
        url: 'https://news.example/rocketscale-series-b',
        publishedAt: '2026-08-19T11:55:00.000Z',
      },
      {
        title: 'Unrelated Company raises Series B',
        summary: null,
        url: 'https://news.example/unrelated-series-b',
        publishedAt: '2026-08-19T11:56:00.000Z',
      },
    ],
  });

  const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  url.searchParams.set('query', '"RocketScale" (funding OR investment OR hiring)');
  url.searchParams.set('maxrecords', '10');

  const result = await client.request(url);
  assert.equal(result.transport, 'gdelt-gal-rss');
  assert.equal(result.fallback, true);
  assert.equal(result.attempts, 1);
  assert.equal(result.body.articles.length, 1);
  assert.equal(result.body.articles[0].title, 'RocketScale raises Series B and expands engineering hiring');
  assert.equal(result.body.articles[0].domain, 'news.example');
});

test('GDELT GAL fallback rejects unrelated and non-business stories', async () => {
  const client = createGdeltDocClient({
    persist: false,
    maxAttempts: 1,
    now: () => Date.parse('2026-08-19T12:00:00.000Z'),
    requestImpl: async () => ({
      status: 429,
      headers: { get: () => null },
      json: async () => ({}),
    }),
    galItems: [
      {
        title: 'RocketScale publishes its summer playlist',
        summary: null,
        url: 'https://media.example/rocketscale-playlist',
        publishedAt: '2026-08-19T11:55:00.000Z',
      },
      {
        title: 'OtherCo announces hiring expansion',
        summary: null,
        url: 'https://media.example/otherco-hiring',
        publishedAt: '2026-08-19T11:55:00.000Z',
      },
    ],
  });

  const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  url.searchParams.set('query', '"RocketScale" (funding OR investment OR hiring)');

  const result = await client.request(url);
  assert.equal(result.transport, 'gdelt-gal-rss');
  assert.deepEqual(result.body.articles, []);
});
