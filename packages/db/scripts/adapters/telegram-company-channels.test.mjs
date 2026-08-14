import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchTelegramCompanyChannels } from './telegram-company-channels.mjs';

const target = { channel_username: 'acme_career', company_name: 'Acme', company_domain: 'acme.ru', company_website_url: 'https://acme.ru/', ownership_proof_url: 'https://acme.ru/career' };

test('reads only identity-bound public broadcast channel posts', async () => {
  const calls = [];
  const client = {
    async getEntity(username) { calls.push(['getEntity', username]); return { username: 'acme_career', broadcast: true, megagroup: false }; },
    async getMessages(entity, options) { calls.push(['getMessages', entity.username, options.limit]); return [{ id: 42, date: 1786665600, message: 'Открываем новый офис и массовый найм' }]; },
  };
  const result = await fetchTelegramCompanyChannels([target], { client, now: new Date('2026-08-14T00:00:00Z'), fetchCompanyPage: async () => '<a href="https://t.me/acme_career">Telegram</a>' });
  assert.deepEqual(calls, [['getEntity', 'acme_career'], ['getMessages', 'acme_career', 50]]);
  assert.equal(result.records[0].event_type, 'mass_hiring');
  assert.equal(result.records[0].source_url, 'https://t.me/acme_career/42');
  assert.equal(JSON.stringify(result).match(/subscriber|participant|user profile/gi), null);
});

test('rejects private, group, mismatched, and unproven channels before history read', async () => {
  let historyReads = 0;
  for (const entity of [{ username: 'other', broadcast: true }, { username: 'acme_career', broadcast: false }, { username: 'acme_career', broadcast: true, megagroup: true }]) {
    const result = await fetchTelegramCompanyChannels([target], { client: { getEntity: async () => entity, getMessages: async () => { historyReads += 1; return []; } }, fetchCompanyPage: async () => '<a href="https://t.me/acme_career">x</a>' });
    assert.equal(result.records.length, 0);
  }
  const unproven = await fetchTelegramCompanyChannels([target], { client: { getEntity: async () => { throw new Error('must not resolve'); } }, fetchCompanyPage: async () => '' });
  assert.equal(unproven.diagnostics[0].ownershipVerified, false);
  assert.equal(historyReads, 0);
});

test('reads incrementally after the cached public message id', async () => {
  let requestedOptions;
  const client = {
    async getEntity() { return { username: 'acme_career', broadcast: true, megagroup: false }; },
    async getMessages(_entity, options) {
      requestedOptions = options;
      return [
        { id: 43, date: 1786665600, message: 'We are hiring for a new vacancy' },
        { id: 42, date: 1786665500, message: 'We are hiring for a new vacancy' },
      ];
    },
  };

  const result = await fetchTelegramCompanyChannels([target], {
    client,
    now: new Date('2026-08-14T00:00:00Z'),
    cache: { acme_career: { lastMessageId: 42 } },
    fetchCompanyPage: async () => '<a href="https://t.me/acme_career">Telegram</a>',
  });

  assert.deepEqual(requestedOptions, { limit: 50, minId: 42 });
  assert.deepEqual(result.records.map((record) => record.external_id), ['telegram-post:acme_career:43']);
  assert.deepEqual(result.cacheUpdates, [{ channelUsername: 'acme_career', lastMessageId: 43 }]);
});

test('redacts the MTProto session and API hash from diagnostics', async () => {
  const session = 'highly-sensitive-session-value';
  const apiHash = 'highly-sensitive-api-hash';
  const result = await fetchTelegramCompanyChannels([target], {
    client: {
      async getEntity() { throw new Error(`transport ${session} ${apiHash}`); },
    },
    sensitiveValues: [session, apiHash],
    fetchCompanyPage: async () => '<a href="https://t.me/acme_career">Telegram</a>',
  });

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(session), false);
  assert.equal(serialized.includes(apiHash), false);
  assert.match(result.diagnostics[0].error, /\[redacted\]/);
});
