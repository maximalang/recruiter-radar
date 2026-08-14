import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import argon2 from 'argon2'
import pg from 'pg'

const { Pool } = pg
const ADMIN_DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/postgres'
const REDIRECT_URI = 'https://chatgpt.com/connector_platform_oauth_redirect'
const PASSWORD = 'timeweb-lifecycle-test-password-not-a-production-secret'
const RESOURCE = 'https://recruiter-radar.ru/api/internal/timeweb-mcp'
const ISSUER = 'https://recruiter-radar.ru/operator/oauth'
const SCOPE = 'rr.timeweb.manage'

function form(values) { return new URLSearchParams(values).toString() }
function decodeJwt(token) {
  const parts = String(token).split('.')
  assert.equal(parts.length, 3)
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
}
function extractCsrf(html) {
  const match = html.match(/name="csrf" value="([^"]+)"/)
  assert.ok(match, 'CSRF field must be rendered')
  return match[1]
}
function makeCookieJar() {
  const values = new Map()
  return {
    absorb(response) {
      const setCookies = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [response.headers.get('set-cookie')].filter(Boolean)
      for (const value of setCookies) {
        const first = value.split(';', 1)[0]
        const index = first.indexOf('=')
        if (index > 0) values.set(first.slice(0, index), first.slice(index + 1))
      }
    },
    header() { return [...values.entries()].map(([key, value]) => `${key}=${value}`).join('; ') },
  }
}
async function prepareStorage() {
  const pool = new Pool({ connectionString: ADMIN_DATABASE_URL })
  await pool.query('DROP SCHEMA IF EXISTS operator_auth CASCADE')
  await pool.query('CREATE SCHEMA operator_auth')
  await pool.query(`
    CREATE TABLE operator_auth.oidc_store (
      model text NOT NULL, id text NOT NULL, payload jsonb NOT NULL,
      expires_at timestamptz, consumed_at timestamptz, grant_id text, user_code text, uid text,
      PRIMARY KEY (model, id)
    );
    CREATE INDEX oidc_store_grant_idx ON operator_auth.oidc_store(model, grant_id) WHERE grant_id IS NOT NULL;
    CREATE INDEX oidc_store_user_code_idx ON operator_auth.oidc_store(model, user_code) WHERE user_code IS NOT NULL;
    CREATE INDEX oidc_store_uid_idx ON operator_auth.oidc_store(model, uid) WHERE uid IS NOT NULL;
    CREATE INDEX oidc_store_expires_idx ON operator_auth.oidc_store(expires_at) WHERE expires_at IS NOT NULL;
    CREATE TABLE operator_auth.login_throttle (
      throttle_key text PRIMARY KEY, failures integer NOT NULL DEFAULT 0,
      locked_until timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
    );
  `)
  await pool.end()
}
async function createFixtureFiles() {
  const dir = await mkdtemp(join(tmpdir(), 'rr-timeweb-lifecycle-'))
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const privateJwk = privateKey.export({ format: 'jwk' })
  const jwksFile = join(dir, 'jwks.json')
  const cookieFile = join(dir, 'cookie-keys.json')
  await writeFile(jwksFile, JSON.stringify({ keys: [{ ...privateJwk, kid: 'timeweb-lifecycle-key', alg: 'ES256', use: 'sig' }] }), { mode: 0o600 })
  await writeFile(cookieFile, JSON.stringify([randomBytes(32).toString('base64url'), randomBytes(32).toString('base64url')]), { mode: 0o600 })
  return { dir, jwksFile, cookieFile }
}
async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return `http://127.0.0.1:${address.port}`
}
async function stop(server) {
  if (!server.listening) return
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}
function client(base, jar = makeCookieJar()) {
  return {
    jar,
    async request(path, options = {}) {
      const headers = new Headers(options.headers || {})
      headers.set('host', 'recruiter-radar.ru')
      headers.set('x-forwarded-host', 'recruiter-radar.ru')
      headers.set('x-forwarded-proto', 'https')
      headers.set('x-real-ip', '203.0.113.60')
      if (jar.header()) headers.set('cookie', jar.header())
      const response = await fetch(`${base}${path}`, { ...options, headers, redirect: 'manual' })
      jar.absorb(response)
      return response
    },
  }
}
async function registerPublicClient(httpClient) {
  const response = await httpClient.request('/operator/oauth/reg', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'ChatGPT cached Timeweb MCP client',
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: 'none',
      response_types: ['code'],
      grant_types: ['authorization_code', 'refresh_token'],
    }),
  })
  const body = await response.json()
  assert.equal(response.status, 201, JSON.stringify(body))
  assert.deepEqual(body.grant_types, ['authorization_code', 'refresh_token'])
  return body.client_id
}
function authorizationPath(clientId, verifier, scope) {
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope,
    resource: RESOURCE,
    prompt: 'consent',
    state: 'state-timeweb-lifecycle',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  return `/operator/oauth/auth?${params}`
}
async function completeAuthorization(httpClient, clientId, verifier, scope) {
  let response = await httpClient.request(authorizationPath(clientId, verifier, scope))
  assert.ok([302, 303].includes(response.status))
  let location = response.headers.get('location')
  assert.ok(location?.startsWith('/operator/oauth/interaction/'))

  response = await httpClient.request(location)
  assert.equal(response.status, 200)
  let csrf = extractCsrf(await response.text())
  response = await httpClient.request(location.replace(/\/$/, '') + '/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ csrf, password: PASSWORD }),
  })
  assert.ok([302, 303].includes(response.status))
  location = response.headers.get('location')
  assert.ok(location)

  let follow = new URL(location, ISSUER)
  response = await httpClient.request(follow.pathname + follow.search)
  assert.ok([302, 303].includes(response.status))
  location = response.headers.get('location')
  assert.ok(location?.startsWith('/operator/oauth/interaction/'))

  response = await httpClient.request(location)
  assert.equal(response.status, 200)
  csrf = extractCsrf(await response.text())
  response = await httpClient.request(location.replace(/\/$/, '') + '/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ csrf }),
  })
  assert.ok([302, 303].includes(response.status))
  location = response.headers.get('location')
  assert.ok(location)

  follow = new URL(location, ISSUER)
  response = await httpClient.request(follow.pathname + follow.search)
  assert.ok([302, 303].includes(response.status))
  const callback = new URL(response.headers.get('location'))
  assert.equal(callback.origin + callback.pathname, REDIRECT_URI)
  assert.equal(callback.searchParams.get('state'), 'state-timeweb-lifecycle')
  const code = callback.searchParams.get('code')
  assert.ok(code)
  return code
}
async function exchangeCode(httpClient, clientId, code, verifier) {
  return httpClient.request('/operator/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
      resource: RESOURCE,
    }),
  })
}
async function refresh(httpClient, clientId, refreshToken) {
  return httpClient.request('/operator/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken, resource: RESOURCE }),
  })
}
async function persistedModels() {
  const pool = new Pool({ connectionString: ADMIN_DATABASE_URL })
  const { rows } = await pool.query('SELECT model, COUNT(*)::int AS count FROM operator_auth.oidc_store GROUP BY model ORDER BY model')
  await pool.end()
  return new Map(rows.map((row) => [row.model, row.count]))
}

test('ChatGPT OAuth lifecycle survives cached scope omission and application restart', async () => {
  await prepareStorage()
  const fixture = await createFixtureFiles()
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 })
  process.env.NODE_ENV = 'test'
  process.env.RR_OPERATOR_AUTH_PROVIDER = 'local_oidc'
  process.env.RR_MCP_OAUTH_ISSUER = ISSUER
  process.env.RR_TIMEWEB_MCP_RESOURCE = RESOURCE
  process.env.RR_MCP_ALLOWED_SUBJECTS = 'rr_owner'
  process.env.RR_MCP_OWNER_PASSWORD_HASH = passwordHash
  process.env.RR_MCP_AUTH_DATABASE_URL = ADMIN_DATABASE_URL
  process.env.RR_MCP_OAUTH_JWKS_FILE = fixture.jwksFile
  process.env.RR_MCP_OAUTH_COOKIE_KEYS_FILE = fixture.cookieFile

  const { createTimewebAuthServer } = await import('../src/timeweb-server.js')
  let runtime = await createTimewebAuthServer()
  let base = await listen(runtime.server)
  let httpClient = client(base)
  try {
    const discoveryResponse = await httpClient.request('/operator/oauth/.well-known/openid-configuration')
    assert.equal(discoveryResponse.status, 200)
    const discovery = await discoveryResponse.json()
    assert.ok(discovery.scopes_supported.includes('offline_access'))
    assert.deepEqual(discovery.code_challenge_methods_supported, ['S256'])
    assert.ok(discovery.grant_types_supported.includes('authorization_code'))
    assert.ok(discovery.grant_types_supported.includes('refresh_token'))

    const rfc8414Response = await httpClient.request('/.well-known/oauth-authorization-server/operator/oauth')
    assert.equal(rfc8414Response.status, 200)
    const rfc8414 = await rfc8414Response.json()
    assert.equal(rfc8414.issuer, ISSUER)
    assert.ok(rfc8414.scopes_supported.includes('offline_access'))
    assert.ok(rfc8414.grant_types_supported.includes('refresh_token'))

    const clientId = await registerPublicClient(httpClient)
    const verifier = randomBytes(48).toString('base64url')

    // Emulate an existing ChatGPT Dev App whose cached authorization request was
    // created without offline_access. Reconnect must still produce a renewable session.
    const code = await completeAuthorization(httpClient, clientId, verifier, `openid ${SCOPE}`)
    const tokenResponse = await exchangeCode(httpClient, clientId, code, verifier)
    assert.equal(tokenResponse.status, 200)
    const tokens = await tokenResponse.json()
    assert.ok(tokens.access_token)
    assert.ok(tokens.refresh_token, 'authorization-code exchange must return a refresh token')

    const accessClaims = decodeJwt(tokens.access_token)
    assert.equal(accessClaims.iss, ISSUER)
    assert.equal(accessClaims.aud, RESOURCE)
    assert.equal(accessClaims.sub, 'rr_owner')
    assert.ok(accessClaims.exp > accessClaims.iat)
    assert.ok(accessClaims.exp - accessClaims.iat <= 15 * 60 + 5)

    const models = await persistedModels()
    assert.ok((models.get('Client') || 0) >= 1, 'dynamic clients must be persisted in PostgreSQL')
    assert.ok((models.get('Grant') || 0) >= 1, 'authorization grants must be persisted in PostgreSQL')
    assert.ok((models.get('RefreshToken') || 0) >= 1, 'refresh tokens must be persisted in PostgreSQL')

    await stop(runtime.server)

    // Recreate the whole application process with the same PostgreSQL storage and
    // persistent signing/cookie key files, exactly like a Docker restart/deploy.
    runtime = await createTimewebAuthServer()
    base = await listen(runtime.server)
    httpClient = client(base)

    const refreshResponse = await refresh(httpClient, clientId, tokens.refresh_token)
    assert.equal(refreshResponse.status, 200)
    const rotated = await refreshResponse.json()
    assert.ok(rotated.access_token)
    assert.ok(rotated.refresh_token)
    assert.notEqual(rotated.refresh_token, tokens.refresh_token, 'refresh-token rotation must issue the next refresh token')
    assert.notEqual(rotated.access_token, tokens.access_token)

    const refreshedClaims = decodeJwt(rotated.access_token)
    assert.equal(refreshedClaims.iss, ISSUER)
    assert.equal(refreshedClaims.aud, RESOURCE)
    assert.equal(refreshedClaims.sub, 'rr_owner')
  } finally {
    await stop(runtime.server)
    await rm(fixture.dir, { recursive: true, force: true })
  }
})
