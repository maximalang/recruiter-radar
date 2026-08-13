import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveTrackedCompanyInns } from './tracked-company-inns.mjs';

test('uses a reviewed explicit INN list without opening the database', async () => {
  const result = await resolveTrackedCompanyInns({
    explicitInns: '7707083893, 9102013580, 7707083893',
    clientFactory: () => { throw new Error('database must not be opened'); },
  });

  assert.deepEqual(result, ['7707083893', '9102013580']);
});

test('derives bounded legal-entity INNs from current hiring evidence', async () => {
  const events = [];
  const result = await resolveTrackedCompanyInns({
    databaseUrl: 'postgresql://local/test',
    limit: 2,
    clientFactory: () => ({
      async connect() { events.push('connect'); },
      async query(sql, params) {
        events.push({ sql, params });
        return { rows: [{ inn: '7707083893' }, { inn: '9102013580' }, { inn: 'not-an-inn' }] };
      },
      async end() { events.push('end'); },
    }),
  });

  assert.deepEqual(result, ['7707083893', '9102013580']);
  assert.equal(events[0], 'connect');
  assert.match(events[1].sql, /signal_type = 'job_posting'/);
  assert.equal(events[1].params[0], 2);
  assert.ok(events[1].params[1].includes('career-pages'));
  assert.ok(events[1].params[1].includes('rabota-rossii'));
  assert.ok(!events[1].params[1].includes('fns-open-data'));
  assert.equal(events.at(-1), 'end');
});

test('fails closed when neither an override nor tracked DB companies exist', async () => {
  await assert.rejects(
    resolveTrackedCompanyInns(),
    /DATABASE_URL is required/,
  );
  await assert.rejects(
    resolveTrackedCompanyInns({
      databaseUrl: 'postgresql://local/test',
      clientFactory: () => ({
        async connect() {},
        async query() { return { rows: [] }; },
        async end() {},
      }),
    }),
    /no tracked legal-entity INNs/i,
  );
});
