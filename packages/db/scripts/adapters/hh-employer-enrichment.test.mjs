import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  collectHhEmployerIds,
  fetchHhEmployerDetails,
  mergeHhEmployerDetails,
} from './hh-employer-enrichment.mjs';

test('collects each HH employer once and skips vacancies that already contain site_url', () => {
  const ids = collectHhEmployerIds([
    { employer: { id: '2' } },
    { employer: { id: '1' } },
    { employer: { id: '1' } },
    { employer: { id: '3', site_url: 'https://known.example/' } },
  ]);
  assert.deepEqual(ids, ['1', '2']);
});

test('official employer details are persisted to cache and reused without another HTTP call', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hh-employer-cache-'));
  const cachePath = join(directory, 'cache.json');
  let calls = 0;
  const env = { HH_ACCESS_TOKEN: 'token', HH_USER_AGENT: 'RecruiterRadar test' };
  const fetchJsonImpl = async (url) => {
    calls += 1;
    const id = new URL(url).pathname.split('/').pop();
    return {
      id,
      name: `Employer ${id}`,
      site_url: `https://employer-${id}.example.ru/`,
      trusted: true,
      type: 'company',
      open_vacancies: 3,
    };
  };

  const first = await fetchHhEmployerDetails({
    employerIds: ['10', '20'],
    userAgent: 'RecruiterRadar test',
    env,
    fetchJsonImpl,
    oauthFetchImpl: async () => { throw new Error('access token mode must not exchange oauth'); },
    cachePath,
    maxEmployers: 10,
    now: new Date('2026-08-19T12:00:00Z'),
  });
  assert.equal(first.requested, 2);
  assert.equal(first.enriched, 2);
  assert.equal(first.cacheHits, 0);
  assert.equal(calls, 2);
  assert.equal(JSON.parse(readFileSync(cachePath, 'utf8')).version, 1);

  const second = await fetchHhEmployerDetails({
    employerIds: ['10', '20'],
    userAgent: 'RecruiterRadar test',
    env,
    fetchJsonImpl: async () => { throw new Error('fresh cache must avoid HTTP'); },
    cachePath,
    maxEmployers: 10,
    now: new Date('2026-08-20T12:00:00Z'),
  });
  assert.equal(second.requested, 0);
  assert.equal(second.cacheHits, 2);
  assert.equal(second.details.size, 2);
  assert.equal(calls, 2);
});

test('bounded detail budget converges across runs because cached employers leave the queue', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hh-employer-budget-'));
  const cachePath = join(directory, 'cache.json');
  const calls = [];
  const request = async (url) => {
    const id = new URL(url).pathname.split('/').pop();
    calls.push(id);
    return { id, name: `Employer ${id}`, site_url: `https://e${id}.example.ru/` };
  };
  const env = { HH_ACCESS_TOKEN: 'token' };

  const first = await fetchHhEmployerDetails({
    employerIds: ['1', '2', '3'],
    userAgent: 'RecruiterRadar test',
    env,
    fetchJsonImpl: request,
    cachePath,
    maxEmployers: 2,
    now: new Date('2026-08-19T00:00:00Z'),
  });
  assert.equal(first.truncated, true);
  assert.equal(first.truncatedEmployers, 1);
  assert.deepEqual(calls, ['1', '2']);

  const second = await fetchHhEmployerDetails({
    employerIds: ['1', '2', '3'],
    userAgent: 'RecruiterRadar test',
    env,
    fetchJsonImpl: request,
    cachePath,
    maxEmployers: 2,
    now: new Date('2026-08-19T01:00:00Z'),
  });
  assert.equal(second.cacheHits, 2);
  assert.equal(second.requested, 1);
  assert.equal(second.truncated, false);
  assert.deepEqual(calls, ['1', '2', '3']);
});

test('merge adds identity detail without changing the vacancy evidence itself', () => {
  const vacancy = {
    id: 'v1',
    name: 'Backend Developer',
    alternate_url: 'https://hh.ru/vacancy/v1',
    employer: { id: '10', name: 'Example' },
  };
  const merged = mergeHhEmployerDetails([vacancy], new Map([['10', {
    id: '10',
    name: 'Example',
    siteUrl: 'https://example.ru/',
    trusted: true,
    type: 'company',
    openVacancies: 4,
    accreditedItEmployer: false,
  }]]));
  assert.equal(merged.enrichedVacancies, 1);
  assert.equal(merged.records[0].id, 'v1');
  assert.equal(merged.records[0].alternate_url, 'https://hh.ru/vacancy/v1');
  assert.equal(merged.records[0].employer.site_url, 'https://example.ru/');
  assert.equal(merged.records[0].employer.employer_detail_enriched, true);
});
