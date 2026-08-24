import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { fetchHhEmployerDetails } from './adapters/hh-employer-enrichment.mjs';
import { HH_EMPLOYER_CACHE_ROOT, resolveHhEmployerDetailCachePath } from './lib/hh-employer-cache-path.mjs';

const runnerSource = readFileSync(new URL('./enrich-hh-employer-identities.mjs', import.meta.url), 'utf8');

test('runner passes HH_EMPLOYER_DETAIL_CACHE_PATH through the fixed cache root', () => {
  assert.match(runnerSource, /HH_EMPLOYER_DETAIL_CACHE_PATH/);
  assert.match(runnerSource, /resolveHhEmployerDetailCachePath\(process\.env\.HH_EMPLOYER_DETAIL_CACHE_PATH\)/);
  assert.match(runnerSource, /cachePath,\s*\n\s*maxEmployers/);
  assert.equal(resolveHhEmployerDetailCachePath('hh/details.json'), join(HH_EMPLOYER_CACHE_ROOT, 'hh', 'details.json'));
  assert.throws(
    () => resolveHhEmployerDetailCachePath('../outside.json'),
    /must stay inside/,
  );
  assert.throws(
    () => resolveHhEmployerDetailCachePath(join(tmpdir(), 'outside.json')),
    /must stay inside/,
  );
});

test('runner cache reuses persistent details across runs', async () => {

  const directory = mkdtempSync(join(tmpdir(), 'hh-employer-runner-cache-'));
  const cachePath = join(directory, 'employer-details.json');
  const env = { HH_ACCESS_TOKEN: 'token', HH_USER_AGENT: 'RecruiterRadar test' };
  const calls = [];
  const fetchJsonImpl = async (url) => {
    const id = new URL(url).pathname.split('/').pop();
    calls.push(id);
    return { id, name: `Employer ${id}`, site_url: `https://e${id}.example.ru/` };
  };

  const first = await fetchHhEmployerDetails({
    employerIds: ['10', '20'],
    userAgent: env.HH_USER_AGENT,
    env,
    fetchJsonImpl,
    oauthFetchImpl: async () => { throw new Error('access token mode must not exchange oauth'); },
    cachePath,
    maxEmployers: 10,
  });
  assert.equal(first.requested, 2);
  assert.equal(first.cacheHits, 0);
  assert.deepEqual(calls, ['10', '20']);

  const second = await fetchHhEmployerDetails({
    employerIds: ['10', '20'],
    userAgent: env.HH_USER_AGENT,
    env,
    fetchJsonImpl: async () => { throw new Error('persistent cache must avoid HTTP'); },
    cachePath,
    maxEmployers: 10,
  });
  assert.equal(second.requested, 0);
  assert.equal(second.cacheHits, 2);
  assert.equal(second.details.size, 2);
  assert.deepEqual(calls, ['10', '20']);
});

test('runner cache gracefully falls back to fresh fetch when cache JSON is corrupt', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hh-employer-runner-corrupt-cache-'));
  const cachePath = join(directory, 'employer-details.json');
  writeFileSync(cachePath, '{not-json', 'utf8');
  let calls = 0;

  const result = await fetchHhEmployerDetails({
    employerIds: ['30'],
    userAgent: 'RecruiterRadar test',
    env: { HH_ACCESS_TOKEN: 'token' },
    fetchJsonImpl: async (url) => {
      calls += 1;
      const id = new URL(url).pathname.split('/').pop();
      return { id, name: `Employer ${id}`, site_url: `https://e${id}.example.ru/` };
    },
    cachePath,
    maxEmployers: 1,
  });

  assert.equal(calls, 1);
  assert.equal(result.requested, 1);
  assert.equal(result.cacheHits, 0);
  assert.equal(result.details.size, 1);
});
