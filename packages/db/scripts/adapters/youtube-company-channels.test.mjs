import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchYouTubeCompanyChannels } from './youtube-company-channels.mjs';

const target = { channel_id: 'UC_COMPANY', company_name: 'Acme', company_domain: 'acme.ru', company_website_url: 'https://acme.ru/', ownership_proof_url: 'https://acme.ru/media' };

test('uses only the owned uploads playlist and emits context events', async () => {
  const urls = [];
  const result = await fetchYouTubeCompanyChannels([target], {
    apiKey: 'fixture-key', now: new Date('2026-08-14T00:00:00Z'),
    fetchCompanyPage: async () => '<a href="https://www.youtube.com/channel/UC_COMPANY">YouTube</a>',
    fetchImpl: async (url, options) => {
      urls.push(String(url));
      if (String(url).includes('/channels?')) return json({ items: [{ id: 'UC_COMPANY', snippet: { title: 'Acme' }, contentDetails: { relatedPlaylists: { uploads: 'UU_COMPANY' } } }] });
      assert.equal(options.headers['If-None-Match'], '"uploads-v1"');
      return json({ items: [{ id: 'item-1', snippet: { title: 'Acme opens a new office', description: 'Regional expansion', resourceId: { videoId: 'video-1' }, videoOwnerChannelId: 'UC_COMPANY' }, contentDetails: { videoPublishedAt: '2026-08-12T00:00:00Z' } }] }, { etag: '"uploads-v2"' });
    },
    cache: { UC_COMPANY: { etag: '"uploads-v1"' } }, quota: { remainingUnits: 2 },
  });
  assert.equal(urls.length, 2);
  assert.equal(urls.some((url) => url.includes('/search?')), false);
  assert.equal(result.quotaUsed, 2);
  assert.equal(result.records[0].event_type, 'company_expansion');
  assert.equal(result.records[0].source_url, 'https://www.youtube.com/watch?v=video-1');
  assert.equal(result.records[0].context_only, true);
});

test('does not spend quota when budget or automatic ownership proof is absent', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return json({}); };
  const noBudget = await fetchYouTubeCompanyChannels([target], { apiKey: 'key', fetchImpl, quota: { remainingUnits: 1 }, fetchCompanyPage: async () => 'youtube.com/channel/UC_COMPANY' });
  const noProof = await fetchYouTubeCompanyChannels([target], { apiKey: 'key', fetchImpl, quota: { remainingUnits: 2 }, fetchCompanyPage: async () => '<html></html>' });
  assert.equal(calls, 0);
  assert.equal(noBudget.diagnostics[0].deferred, 'quota-budget');
  assert.equal(noProof.diagnostics[0].ownershipVerified, false);
});

test('resolves an exact company-linked handle through channels.list before reading uploads', async () => {
  const urls = [];
  const result = await fetchYouTubeCompanyChannels([{
    channel_handle: '@AcmeOfficial',
    company_name: 'Acme',
    company_domain: 'acme.ru',
    company_website_url: 'https://acme.ru/',
    ownership_proof_url: 'https://acme.ru/media',
  }], {
    apiKey: 'fixture-key',
    now: new Date('2026-08-14T00:00:00Z'),
    fetchCompanyPage: async () => '<a href="https://youtube.com/@AcmeOfficial">YouTube</a>',
    fetchImpl: async (url) => {
      urls.push(String(url));
      if (String(url).includes('/channels?')) {
        return json({ items: [{ id: 'UC_RESOLVED', snippet: { title: 'Acme' }, contentDetails: { relatedPlaylists: { uploads: 'UU_RESOLVED' } } }] });
      }
      return json({ items: [] }, { etag: '"empty"' });
    },
    quota: { remainingUnits: 2 },
  });

  assert.match(urls[0], /forHandle=%40AcmeOfficial/);
  assert.match(urls[1], /playlistId=UU_RESOLVED/);
  assert.equal(result.diagnostics[0].channelId, 'UC_RESOLVED');
  assert.equal(result.diagnostics[0].ownershipVerified, true);
});

function json(value, { etag } = {}) { return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json', ...(etag ? { etag } : {}) } }); }
