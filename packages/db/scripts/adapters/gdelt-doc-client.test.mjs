import assert from 'node:assert/strict';
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
