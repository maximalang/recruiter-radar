import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
    return { id, name: `Employer ${id}`, site_url: `https://employer-${id}.example.ru/`, trusted: true, type: 'company', open_vacancies: 3 };
  };
  const first = await fetchHhEmployerDetails({ employerIds: ['10', '20'], userAgent: 'RecruiterRadar test', env, fetchJsonImpl, oauthFetchImpl: async () => { throw new Error('access token mode must not exchange oauth'); }, cachePath, maxEmployers: 10, now: new Date('2026-08-19T12:00:00Z') });
  assert.equal(first.requested, 2);
  assert.equal(first.enriched, 2);
  assert.equal(first.cacheHits, 0);
  assert.equal(calls, 2);
  assert.equal(JSON.parse(readFileSync(cachePath, 'utf8')).version, 1);
  const second = await fetchHhEmployerDetails({ employerIds: ['10', '20'], userAgent: 'RecruiterRadar test', env, fetchJsonImpl: async () => { throw new Error('fresh cache must avoid HTTP'); }, cachePath, maxEmployers: 10, now: new Date('2026-08-20T12:00:00Z') });
  assert.equal(second.requested, 0);
  assert.equal(second.cacheHits, 2);
  assert.equal(second.details.size, 2);
  assert.equal(calls, 2);
});

test('bounded detail budget converges across runs because cached employers leave the queue', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hh-employer-budget-'));
  const cachePath = join(directory, 'cache.json');
  const calls = [];
  const request = async (url) => { const id = new URL(url).pathname.split('/').pop(); calls.push(id); return { id, name: `Employer ${id}`, site_url: `https://e${id}.example.ru/` }; };
  const env = { HH_ACCESS_TOKEN: 'token' };
  const first = await fetchHhEmployerDetails({ employerIds: ['1', '2', '3'], userAgent: 'RecruiterRadar test', env, fetchJsonImpl: request, cachePath, maxEmployers: 2, now: new Date('2026-08-19T00:00:00Z') });
  assert.equal(first.truncated, true);
  assert.equal(first.truncatedEmployers, 1);
  assert.deepEqual(calls, ['1', '2']);
  const second = await fetchHhEmployerDetails({ employerIds: ['1', '2', '3'], userAgent: 'RecruiterRadar test', env, fetchJsonImpl: request, cachePath, maxEmployers: 2, now: new Date('2026-08-19T01:00:00Z') });
  assert.equal(second.cacheHits, 2);
  assert.equal(second.requested, 1);
  assert.equal(second.truncated, false);
  assert.deepEqual(calls, ['1', '2', '3']);
});

test('merge adds identity detail without changing the vacancy evidence itself', () => {
  const vacancy = { id: 'v1', name: 'Backend Developer', alternate_url: 'https://hh.ru/vacancy/v1', employer: { id: '10', name: 'Example' } };
  const merged = mergeHhEmployerDetails([vacancy], new Map([['10', { id: '10', name: 'Example', siteUrl: 'https://example.ru/', trusted: true, type: 'company', openVacancies: 4, accreditedItEmployer: false }]]));
  assert.equal(merged.enrichedVacancies, 1);
  assert.equal(merged.records[0].id, 'v1');
  assert.equal(merged.records[0].alternate_url, 'https://hh.ru/vacancy/v1');
  assert.equal(merged.records[0].employer.site_url, 'https://example.ru/');
  assert.equal(merged.records[0].employer.employer_detail_enriched, true);
});

test('stale cache entries are misses and pruned when fresh details are persisted', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hh-employer-ttl-'));
  const cachePath = join(directory, 'cache.json');
  writeFileSync(cachePath, JSON.stringify({ version: 1, entries: {
    '10': { storedAt: '2026-01-01T00:00:00.000Z', detail: { id: '10', name: 'Stale', siteUrl: 'https://stale.example.ru/' } },
    '99': { storedAt: '2026-01-01T00:00:00.000Z', detail: { id: '99', name: 'Orphan stale', siteUrl: 'https://orphan.example.ru/' } },
  } }), 'utf8');
  let calls = 0;
  const result = await fetchHhEmployerDetails({ employerIds: ['10'], userAgent: 'RecruiterRadar test', env: { HH_ACCESS_TOKEN: 'token' }, fetchJsonImpl: async (url) => { calls += 1; const id = new URL(url).pathname.split('/').pop(); return { id, name: 'Fresh', site_url: 'https://fresh.example.ru/' }; }, cachePath, cacheTtlHours: 168, now: new Date('2026-01-10T00:00:00.000Z'), maxEmployers: 1 });
  assert.equal(calls, 1);
  assert.equal(result.cacheHits, 0);
  assert.equal(result.requested, 1);
  const persisted = JSON.parse(readFileSync(cachePath, 'utf8'));
  assert.equal(persisted.entries['10'].detail.name, 'Fresh');
  assert.equal(persisted.entries['99'], undefined);
});

test('entry age exactly at TTL is stale, while TTL minus 1ms remains a cache hit', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hh-employer-ttl-boundary-'));
  const cachePath = join(directory, 'cache.json');
  const now = new Date('2026-01-08T00:00:00.000Z');
  const exactTtl = new Date(now.getTime() - 168 * 3_600_000).toISOString();
  writeFileSync(cachePath, JSON.stringify({ version: 1, entries: { '10': { storedAt: exactTtl, detail: { id: '10', name: 'Exactly old', siteUrl: 'https://old.example.ru/' } } } }), 'utf8');
  const stale = await fetchHhEmployerDetails({ employerIds: ['10'], userAgent: 'RecruiterRadar test', env: { HH_ACCESS_TOKEN: 'token' }, fetchJsonImpl: async () => ({ id: '10', name: 'Fresh at boundary', site_url: 'https://fresh.example.ru/' }), cachePath, cacheTtlHours: 168, now, maxEmployers: 1 });
  assert.equal(stale.cacheHits, 0);
  assert.equal(stale.requested, 1);
  assert.equal(JSON.parse(readFileSync(cachePath, 'utf8')).entries['10'].detail.name, 'Fresh at boundary');
  const almostFreshPath = join(directory, 'almost-fresh.json');
  const oneMsFresh = new Date(now.getTime() - (168 * 3_600_000 - 1)).toISOString();
  writeFileSync(almostFreshPath, JSON.stringify({ version: 1, entries: { '10': { storedAt: oneMsFresh, detail: { id: '10', name: 'Still fresh', siteUrl: 'https://fresh.example.ru/' } } } }), 'utf8');
  const fresh = await fetchHhEmployerDetails({ employerIds: ['10'], userAgent: 'RecruiterRadar test', env: { HH_ACCESS_TOKEN: 'token' }, fetchJsonImpl: async () => { throw new Error('TTL-minus-1ms entry must hit cache'); }, cachePath: almostFreshPath, cacheTtlHours: 168, now, maxEmployers: 1 });
  assert.equal(fresh.cacheHits, 1);
  assert.equal(fresh.requested, 0);
});

test('fresh write ages from injected now and becomes a TTL miss', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hh-employer-ttl-write-clock-'));
  const cachePath = join(directory, 'cache.json');
  const firstNow = new Date('2026-01-01T00:00:00.000Z');
  const secondNow = new Date('2026-01-01T02:00:00.000Z');
  let calls = 0;
  const fetchJsonImpl = async (url) => {
    calls += 1;
    const id = new URL(url).pathname.split('/').pop();
    return { id, name: `Employer ${calls}`, site_url: `https://e${calls}.example.ru/` };
  };

  const first = await fetchHhEmployerDetails({
    employerIds: ['10'],
    userAgent: 'RecruiterRadar test',
    env: { HH_ACCESS_TOKEN: 'token' },
    fetchJsonImpl,
    cachePath,
    cacheTtlHours: 1,
    now: firstNow,
  });
  assert.equal(first.cacheHits, 0);
  assert.equal(JSON.parse(readFileSync(cachePath, 'utf8')).entries['10'].storedAt, firstNow.toISOString());

  const second = await fetchHhEmployerDetails({
    employerIds: ['10'],
    userAgent: 'RecruiterRadar test',
    env: { HH_ACCESS_TOKEN: 'token' },
    fetchJsonImpl,
    cachePath,
    cacheTtlHours: 1,
    now: secondNow,
  });
  assert.equal(second.cacheHits, 0);
  assert.equal(second.requested, 1);
  assert.equal(calls, 2);
});

test('future cache timestamps fail closed as misses', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hh-employer-future-cache-'));
  const cachePath = join(directory, 'cache.json');
  const now = new Date('2026-01-01T00:00:00.000Z');
  writeFileSync(cachePath, JSON.stringify({ version: 1, entries: {
    '10': { storedAt: '2026-01-01T01:00:00.000Z', detail: { id: '10', name: 'Future', siteUrl: 'https://future.example.ru/' } },
  } }), 'utf8');

  let calls = 0;
  const result = await fetchHhEmployerDetails({
    employerIds: ['10'],
    userAgent: 'RecruiterRadar test',
    env: { HH_ACCESS_TOKEN: 'token' },
    fetchJsonImpl: async () => {
      calls += 1;
      return { id: '10', name: 'Fresh', site_url: 'https://fresh.example.ru/' };
    },
    cachePath,
    cacheTtlHours: 168,
    now,
  });
  assert.equal(result.cacheHits, 0);
  assert.equal(result.requested, 1);
  assert.equal(calls, 1);
});

test('mixed cache pruning keeps fresh entries and removes stale entries from persisted file', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hh-employer-mixed-pruning-'));
  const cachePath = join(directory, 'cache.json');
  const now = new Date('2026-01-10T00:00:00.000Z');
  writeFileSync(cachePath, JSON.stringify({ version: 1, entries: {
    '10': { storedAt: '2026-01-09T12:00:00.000Z', detail: { id: '10', name: 'Fresh', siteUrl: 'https://fresh.example.ru/' } },
    '20': { storedAt: '2026-01-01T00:00:00.000Z', detail: { id: '20', name: 'Stale', siteUrl: 'https://stale.example.ru/' } },
  } }), 'utf8');
  const result = await fetchHhEmployerDetails({ employerIds: ['10'], userAgent: 'RecruiterRadar test', env: { HH_ACCESS_TOKEN: 'token' }, fetchJsonImpl: async () => { throw new Error('fresh entry must hit cache'); }, cachePath, cacheTtlHours: 168, now, maxEmployers: 1 });
  assert.equal(result.cacheHits, 1);
  assert.equal(result.requested, 0);
  const persisted = JSON.parse(readFileSync(cachePath, 'utf8'));
  assert.equal(persisted.entries['10'].detail.name, 'Fresh');
  assert.equal(persisted.entries['20'], undefined);
});

test('cache max entries prunes the oldest fresh entry first', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hh-employer-cache-limit-'));
  const cachePath = join(directory, 'cache.json');
  const now = new Date('2026-02-01T00:00:00.000Z');
  const entries = Object.fromEntries([
    ['10', '2026-01-31T00:00:00.000Z'],
    ['20', '2026-01-31T01:00:00.000Z'],
    ['30', '2026-01-31T02:00:00.000Z'],
    ['40', '2026-01-31T03:00:00.000Z'],
  ].map(([id, storedAt]) => [id, { storedAt, detail: { id, name: `Employer ${id}`, siteUrl: `https://e${id}.example.ru/` } }]));
  writeFileSync(cachePath, JSON.stringify({ version: 1, entries }), 'utf8');
  const result = await fetchHhEmployerDetails({ employerIds: ['20'], userAgent: 'RecruiterRadar test', env: { HH_ACCESS_TOKEN: 'token' }, fetchJsonImpl: async () => { throw new Error('fresh entries must hit cache'); }, cachePath, cacheTtlHours: 168 * 2, cacheMaxEntries: 3, now, maxEmployers: 1 });
  assert.equal(result.cacheHits, 1);
  assert.equal(result.requested, 0);
  const persisted = JSON.parse(readFileSync(cachePath, 'utf8'));
  assert.deepEqual(Object.keys(persisted.entries).sort(), ['20', '30', '40']);
  assert.equal(persisted.entries['10'], undefined);
});
