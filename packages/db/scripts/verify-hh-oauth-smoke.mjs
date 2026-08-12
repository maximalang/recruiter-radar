#!/usr/bin/env node

import assert from 'node:assert/strict';

import {
  HhOAuthError,
  resetHhApplicationTokenCache,
  resolveHhApplicationAuthorization,
} from './adapters/hh-oauth.mjs';

const credentials = {
  HH_CLIENT_ID: 'smoke-client',
  HH_CLIENT_SECRET: 'smoke-secret',
  HH_USER_AGENT: 'RecruiterRadarOAuthSmoke/1.0',
};
let tokenRequests = 0;

resetHhApplicationTokenCache();
const fetchImpl = async (url, options = {}) => {
  assert.equal(String(url), 'https://api.hh.ru/token');
  tokenRequests += 1;
  assert.equal(options.method, 'POST');
  assert.equal(options.headers['hh-user-agent'], credentials.HH_USER_AGENT);
  const body = new URLSearchParams(options.body);
  assert.equal(body.get('grant_type'), 'client_credentials');
  assert.equal(body.get('client_id'), credentials.HH_CLIENT_ID);
  assert.equal(body.get('client_secret'), credentials.HH_CLIENT_SECRET);
  return jsonResponse({
    access_token: `smoke-token-${tokenRequests}`,
    token_type: 'bearer',
    expires_in: 120,
  });
};

const first = await resolveHhApplicationAuthorization(credentials, { fetchImpl, now: 1_000_000 });
const cached = await resolveHhApplicationAuthorization(credentials, { fetchImpl, now: 1_030_000 });
const refreshed = await resolveHhApplicationAuthorization(credentials, { fetchImpl, now: 1_061_000 });
assert.equal(first, 'Bearer smoke-token-1');
assert.equal(cached, first);
assert.equal(refreshed, 'Bearer smoke-token-2');
assert.equal(tokenRequests, 2);

resetHhApplicationTokenCache();
await assert.rejects(
  () => resolveHhApplicationAuthorization(credentials, {
    fetchImpl: async () => jsonResponse({ error: 'invalid_client' }, { status: 401 }),
    now: 2_000_000,
  }),
  (error) => (
    error instanceof HhOAuthError
    && error.status === 401
    && error.type === 'invalid_client'
    && !error.message.includes(credentials.HH_CLIENT_SECRET)
  ),
);

await assert.rejects(
  () => resolveHhApplicationAuthorization({ HH_CLIENT_ID: 'partial', HH_USER_AGENT: credentials.HH_USER_AGENT }),
  /HH_CLIENT_ID and HH_CLIENT_SECRET must be configured together/,
);

assert.equal(
  await resolveHhApplicationAuthorization({ HH_USER_AGENT: credentials.HH_USER_AGENT }),
  null,
);

console.log(JSON.stringify({
  ok: true,
  smoke: 'hh-application-oauth',
  tokenRequests,
  cacheVerified: true,
  expirationRefreshVerified: true,
  safeOauthFailureVerified: true,
}, null, 2));

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}
