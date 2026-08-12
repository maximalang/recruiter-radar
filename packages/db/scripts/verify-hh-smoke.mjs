#!/usr/bin/env node

import assert from 'node:assert/strict';

import {
  buildHhVacanciesUrl,
  fetchHhVacancyPages,
  HhAccessForbiddenError,
  resolveHhVacancySearchConfig,
} from './adapters/hh.mjs';
import { resetHhApplicationTokenCache } from './adapters/hh-oauth.mjs';

const config = resolveHhVacancySearchConfig({
  HH_SEARCH_TEXT: 'backend recruiter',
  HH_PER_PAGE: '2',
  HH_PAGES: '2',
  HH_AREA: '1,2',
  HH_PROFESSIONAL_ROLE: '96',
});
const pageOneUrl = buildHhVacanciesUrl(config, 1);

assert.equal(pageOneUrl.searchParams.get('text'), 'backend recruiter');
assert.equal(pageOneUrl.searchParams.get('per_page'), '2');
assert.equal(pageOneUrl.searchParams.get('page'), '1');
assert.deepEqual(pageOneUrl.searchParams.getAll('area'), ['1', '2']);
assert.deepEqual(pageOneUrl.searchParams.getAll('professional_role'), ['96']);

const originalFetch = globalThis.fetch;
const requestedPages = [];

try {
  resetHhApplicationTokenCache();
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = new URL(String(url));
    if (requestUrl.pathname === '/token') {
      return jsonResponse({ access_token: 'hh-smoke-access-token', token_type: 'bearer', expires_in: 300 });
    }
    const page = Number(requestUrl.searchParams.get('page'));
    requestedPages.push(page);
    assert.equal(options.headers?.['user-agent'], 'RecruiterRadarSmoke/1.0');
    assert.equal(options.headers?.authorization, 'Bearer hh-smoke-access-token');

    return jsonResponse({
      found: 2,
      pages: 2,
      items: [{
        id: `hh-smoke-${page + 1}`,
        name: page === 0 ? 'Recruiter' : 'Senior Recruiter',
        employer: { id: String(page + 1), name: `HH Smoke ${page + 1}` },
      }],
    });
  };

  const result = await fetchHhVacancyPages({
    userAgent: 'RecruiterRadarSmoke/1.0',
    config,
    env: {
      HH_CLIENT_ID: 'hh-smoke-client',
      HH_CLIENT_SECRET: 'hh-smoke-secret',
      HH_USER_AGENT: 'RecruiterRadarSmoke/1.0',
    },
    oauthFetchImpl: globalThis.fetch,
  });

  assert.equal(result.items.length, 2);
  assert.equal(result.pagesFetched, 2);
  assert.deepEqual(requestedPages, [0, 1]);

  resetHhApplicationTokenCache();
  let refreshTokenRequests = 0;
  let vacancyAttempts = 0;
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = new URL(String(url));
    if (requestUrl.pathname === '/token') {
      refreshTokenRequests += 1;
      return jsonResponse({
        access_token: `hh-refresh-token-${refreshTokenRequests}`,
        token_type: 'bearer',
        expires_in: 300,
      });
    }
    vacancyAttempts += 1;
    if (vacancyAttempts === 1) {
      assert.equal(options.headers?.authorization, 'Bearer hh-refresh-token-1');
      return jsonResponse({ errors: [{ type: 'token_expired' }] }, { status: 401 });
    }
    assert.equal(options.headers?.authorization, 'Bearer hh-refresh-token-2');
    return jsonResponse({ found: 1, pages: 1, items: [{ id: 'refreshed', name: 'Recruiter' }] });
  };
  const refreshed = await fetchHhVacancyPages({
    userAgent: 'RecruiterRadarSmoke/1.0',
    config: { ...config, pages: 1 },
    env: {
      HH_CLIENT_ID: 'hh-smoke-client',
      HH_CLIENT_SECRET: 'hh-smoke-secret',
    },
    oauthFetchImpl: globalThis.fetch,
  });
  assert.equal(refreshed.items.length, 1);
  assert.equal(refreshTokenRequests, 2);
  assert.equal(vacancyAttempts, 2);

  globalThis.fetch = async () => jsonResponse(
    { errors: [{ type: 'forbidden' }] },
    { status: 403 },
  );
  await assert.rejects(
    () => fetchHhVacancyPages({
      userAgent: 'RecruiterRadarSmoke/1.0',
      config: { ...config, pages: 1 },
      env: {},
    }),
    (error) => error instanceof HhAccessForbiddenError && error.status === 403,
  );

  console.log(JSON.stringify({
    ok: true,
    smoke: 'hh-adapter',
    pagesFetched: result.pagesFetched,
    recordsParsed: result.items.length,
    forbiddenMapped: true,
    unauthorizedRefreshVerified: true,
    transport: 'same-copy-undici-dispatcher',
  }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
}

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}
