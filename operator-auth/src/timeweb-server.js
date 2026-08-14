import http from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import argon2 from 'argon2'
import { Provider, errors } from 'oidc-provider'
import {
  assertAuthStorageReady,
  cleanupExpiredAuthState,
  clearLoginThrottle,
  createAuthPool,
  createPostgresAdapter,
  getLoginThrottle,
  recordLoginFailure,
} from './postgres-adapter.js'

export const ISSUER = 'https://recruiter-radar.ru/operator/oauth'
export const RESOURCE = 'https://recruiter-radar.ru/api/internal/timeweb-mcp'
export const OWNER_SUB = 'rr_owner'
export const TIMEWEB_SCOPE = 'rr.timeweb.manage'
export const OIDC_PREFIX = '/operator/oauth'
export const RFC8414_PATH = '/.well-known/oauth-authorization-server/operator/oauth'

const MAX_FORM_BYTES = 8192
const ACCESS_TOKEN_TTL = 15 * 60
const AUTHORIZATION_CODE_TTL = 2 * 60
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60
const SESSION_TTL = 12 * 60 * 60
const INTERACTION_TTL = 10 * 60
const CSRF_COOKIE = '__Host-rr_timeweb_mcp_csrf'

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function validateStaticConfiguration() {
  if (required('RR_OPERATOR_AUTH_PROVIDER') !== 'local_oidc') throw new Error('RR_OPERATOR_AUTH_PROVIDER must be local_oidc')
  if (required('RR_MCP_OAUTH_ISSUER') !== ISSUER) throw new Error(`RR_MCP_OAUTH_ISSUER must be exactly ${ISSUER}`)
  if (required('RR_TIMEWEB_MCP_RESOURCE') !== RESOURCE) throw new Error(`RR_TIMEWEB_MCP_RESOURCE must be exactly ${RESOURCE}`)
  if (required('RR_MCP_ALLOWED_SUBJECTS') !== OWNER_SUB) throw new Error(`RR_MCP_ALLOWED_SUBJECTS must be exactly ${OWNER_SUB}`)
  const passwordHash = required('RR_MCP_OWNER_PASSWORD_HASH')
  if (!passwordHash.startsWith('$argon2id$')) throw new Error('RR_MCP_OWNER_PASSWORD_HASH must be an Argon2id encoded hash')
  return passwordHash
}

async function readJsonFile(name) {
  return JSON.parse(await readFile(required(name), 'utf8'))
}

function validateJwks(jwks) {
  if (!jwks || !Array.isArray(jwks.keys) || jwks.keys.length < 1) throw new Error('OAuth JWK Set is required')
  const kids = new Set()
  for (const key of jwks.keys) {
    if (key?.kty !== 'EC' || key?.crv !== 'P-256' || key?.alg !== 'ES256' || key?.use !== 'sig' || !key?.kid || !key?.d) {
      throw new Error('Every OAuth signing JWK must be a private ES256 P-256 signing key with kid')
    }
    if (kids.has(key.kid)) throw new Error('OAuth signing JWK kids must be unique')
    kids.add(key.kid)
  }
  return jwks
}

function validateCookieKeys(value) {
  if (!Array.isArray(value) || value.length < 2 || value.some((key) => typeof key !== 'string' || key.length < 32)) {
    throw new Error('At least two persistent OAuth cookie keys are required')
  }
  return value
}

function safeAudit(event, fields = {}) {
  const allowed = {}
  for (const [key, value] of Object.entries(fields)) {
    if (!['client_id', 'grant_type', 'reason', 'subject', 'status'].includes(key)) continue
    if (['string', 'number', 'boolean'].includes(typeof value)) allowed[key] = String(value).slice(0, 160)
  }
  console.info(JSON.stringify({ ts: new Date().toISOString(), component: 'timeweb-mcp-auth', event, ...allowed }))
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function securityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
}

function formPage({ uid, csrf, kind, clientName, error = '' }) {
  const login = kind === 'login'
  const title = login ? 'Timeweb Cloud — Recruiter Radar' : 'Разрешить доступ к Timeweb Cloud'
  const action = login ? `${OIDC_PREFIX}/interaction/${encodeURIComponent(uid)}/login` : `${OIDC_PREFIX}/interaction/${encodeURIComponent(uid)}/confirm`
  const control = login
    ? '<label>Пароль владельца<input name="password" type="password" autocomplete="current-password" required autofocus></label>'
    : '<p>ChatGPT получит доступ к официальным Timeweb Cloud MCP tools. Эти tools могут изменять инфраструктуру — разрешайте доступ только доверенному клиенту.</p>'
  const button = login ? 'Войти' : 'Разрешить Timeweb Cloud access'
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font:15px/1.5 system-ui,sans-serif;background:#111;color:#eee;margin:0;display:grid;place-items:center;min-height:100vh}.card{width:min(440px,calc(100vw - 32px));padding:28px;border:1px solid #333;border-radius:16px;background:#171717}h1{font-size:20px;margin:0 0 8px}.muted{color:#aaa;margin:0 0 20px}label{display:grid;gap:8px;margin:18px 0}input{font:inherit;padding:12px;border-radius:10px;border:1px solid #444;background:#0f0f0f;color:#fff}button{font:inherit;width:100%;padding:12px;border:0;border-radius:10px;font-weight:650;cursor:pointer}.error{min-height:22px;color:#ff9b9b}</style></head><body><main class="card"><h1>${escapeHtml(title)}</h1><p class="muted">${escapeHtml(clientName || 'OAuth client')}</p><div class="error">${escapeHtml(error)}</div><form method="post" action="${action}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">${control}<button type="submit">${escapeHtml(button)}</button></form></main></body></html>`
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=')
    return index === -1 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
  }))
}
function setCsrfCookie(res, value) { res.setHeader('Set-Cookie', `${CSRF_COOKIE}=${encodeURIComponent(value)}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=600`) }
function equalSecret(left, right) {
  const a = Buffer.from(String(left ?? '')); const b = Buffer.from(String(right ?? ''))
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}
async function readForm(req) {
  let size = 0; const chunks = []
  for await (const chunk of req) { size += chunk.length; if (size > MAX_FORM_BYTES) throw new Error('form_too_large'); chunks.push(chunk) }
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')).entries())
}
function throttleKeys(req) {
  const ip = String(req.headers['x-real-ip'] ?? '')
  return [`ip:${createHash('sha256').update(ip || 'missing').digest('hex')}`, `account:${OWNER_SUB}`]
}
function isLocked(rows) { return rows.some((row) => row.locked_until && new Date(row.locked_until).getTime() > Date.now()) }

function validateRedirectUri(uri) {
  if (typeof uri !== 'string' || uri.length > 2048 || uri.includes('*')) throw new errors.InvalidClientMetadata('redirect_uris must be exact HTTPS URIs')
  let url; try { url = new URL(uri) } catch { throw new errors.InvalidClientMetadata('redirect_uris must be valid absolute URIs') }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new errors.InvalidClientMetadata('redirect_uris must be exact HTTPS URIs without credentials or fragments')
}
function validateDynamicClientMetadata(metadata) {
  if (metadata.token_endpoint_auth_method && metadata.token_endpoint_auth_method !== 'none') throw new errors.InvalidClientMetadata('Only public clients are accepted')
  if (metadata.response_types && (!Array.isArray(metadata.response_types) || metadata.response_types.length !== 1 || metadata.response_types[0] !== 'code')) throw new errors.InvalidClientMetadata('Only response_type=code is accepted')
  if (metadata.grant_types && (!Array.isArray(metadata.grant_types) || metadata.grant_types.some((value) => !['authorization_code', 'refresh_token'].includes(value)))) throw new errors.InvalidClientMetadata('Only authorization_code and refresh_token grants are accepted')
  if (!Array.isArray(metadata.redirect_uris) || metadata.redirect_uris.length < 1 || metadata.redirect_uris.length > 5) throw new errors.InvalidClientMetadata('One to five exact redirect_uris are required')
  metadata.redirect_uris.forEach(validateRedirectUri)
  metadata.token_endpoint_auth_method = 'none'; metadata.response_types = ['code']; metadata.grant_types = ['authorization_code', 'refresh_token']
}

export async function createTimewebAuthServer() {
  const ownerPasswordHash = validateStaticConfiguration()
  const jwks = validateJwks(await readJsonFile('RR_MCP_OAUTH_JWKS_FILE'))
  const cookieKeys = validateCookieKeys(await readJsonFile('RR_MCP_OAUTH_COOKIE_KEYS_FILE'))
  const pool = createAuthPool(); await assertAuthStorageReady(pool)
  const Adapter = createPostgresAdapter(pool)

  const provider = new Provider(ISSUER, {
    adapter: Adapter,
    clients: [],
    claims: { openid: ['sub'] },
    clientAuthMethods: ['none'],
    clientDefaults: { token_endpoint_auth_method: 'none', id_token_signed_response_alg: 'ES256', response_types: ['code'], grant_types: ['authorization_code', 'refresh_token'] },
    allowOmittingSingleRegisteredRedirectUri: false,
    cookies: { keys: cookieKeys },
    extraClientMetadata: {
      properties: ['rr_mcp_profile'],
      validator(_ctx, _key, _value, metadata) { validateDynamicClientMetadata(metadata); metadata.rr_mcp_profile = 'timeweb-cloud' },
    },
    features: {
      devInteractions: { enabled: false }, registration: { enabled: true, issueRegistrationAccessToken: false }, registrationManagement: { enabled: false }, revocation: { enabled: true },
      resourceIndicators: {
        enabled: true,
        defaultResource() { return undefined },
        useGrantedResource() { return false },
        getResourceServerInfo(_ctx, resource) {
          if (resource !== RESOURCE) throw new errors.InvalidTarget('Unknown resource')
          return { audience: RESOURCE, scope: TIMEWEB_SCOPE, accessTokenTTL: ACCESS_TOKEN_TTL, accessTokenFormat: 'jwt', jwt: { sign: { alg: 'ES256' } } }
        },
      },
    },
    findAccount(_ctx, id) { if (id !== OWNER_SUB) return undefined; return { accountId: OWNER_SUB, async claims() { return { sub: OWNER_SUB } } } },
    idTokenSigningAlgValues: ['ES256'],
    interactions: { url(_ctx, interaction) { return `${OIDC_PREFIX}/interaction/${interaction.uid}` } },
    // ChatGPT caches OAuth discovery/client metadata for an existing Dev App. A reconnect
    // can therefore repeat an authorization request created before offline_access was seen.
    // This provider is isolated to the single Timeweb MCP resource and DCR always grants
    // refresh_token, so issue a renewable session after successful Timeweb authorization
    // even when that cached request omitted the OIDC offline_access hint.
    issueRefreshToken(_ctx, client, code) {
      const renewable = client.grantTypeAllowed('refresh_token')
      if (renewable && !code.scopes.has('offline_access')) {
        safeAudit('refresh_compatibility_path', { client_id: client.clientId ?? '', reason: 'offline_access_not_requested' })
      }
      return renewable
    },
    jwks,
    pkce: { required() { return true } },
    routes: { authorization: `${OIDC_PREFIX}/auth`, jwks: `${OIDC_PREFIX}/jwks`, registration: `${OIDC_PREFIX}/reg`, revocation: `${OIDC_PREFIX}/token/revocation`, token: `${OIDC_PREFIX}/token` },
    responseTypes: ['code'], grantTypes: ['authorization_code', 'refresh_token'], rotateRefreshToken: true,
    scopes: ['openid', 'offline_access', TIMEWEB_SCOPE],
    ttl: { AccessToken: ACCESS_TOKEN_TTL, AuthorizationCode: AUTHORIZATION_CODE_TTL, Grant: REFRESH_TOKEN_TTL, IdToken: ACCESS_TOKEN_TTL, RefreshToken: REFRESH_TOKEN_TTL, Session: SESSION_TTL, Interaction: INTERACTION_TTL },
  })
  provider.proxy = true
  provider.on('authorization.success', (ctx) => safeAudit('authorization_granted', { client_id: ctx.oidc?.client?.clientId ?? '', subject: OWNER_SUB }))
  provider.on('grant.success', (ctx) => { if (ctx.oidc?.params?.grant_type === 'refresh_token') safeAudit('token_refresh', { client_id: ctx.oidc?.client?.clientId ?? '', grant_type: 'refresh_token' }) })
  provider.on('grant.error', (ctx, error) => {
    if (ctx.oidc?.params?.grant_type === 'refresh_token') {
      safeAudit('token_refresh_failed', {
        client_id: ctx.oidc?.client?.clientId ?? '',
        grant_type: 'refresh_token',
        reason: error?.error || error?.message || 'unknown_refresh_error',
      })
    }
  })
  provider.on('refresh_token.consumed', (token) => safeAudit('refresh_token_rotated', { client_id: token?.clientId ?? '' }))
  provider.on('grant.revoked', (ctx) => safeAudit('grant_revoked', {
    client_id: ctx.oidc?.client?.clientId ?? '',
    reason: ctx.oidc?.params?.grant_type === 'refresh_token' ? 'refresh_token_reuse_or_revocation' : 'revoked',
  }))
  provider.on('revocation.success', (ctx) => safeAudit('token_revoked', { client_id: ctx.oidc?.client?.clientId ?? '' }))
  provider.on('client.created', (client) => safeAudit('client_registered', { client_id: client.clientId ?? '' }))
  const providerCallback = provider.callback()

  async function renderInteraction(req, res, uid) {
    const details = await provider.interactionDetails(req, res)
    if (details.uid !== uid) throw new Error('interaction_mismatch')
    const client = await provider.Client.find(details.params.client_id); if (!client) throw new Error('client_not_found')
    const csrf = randomBytes(32).toString('base64url'); securityHeaders(res); setCsrfCookie(res, csrf); res.statusCode = 200; res.setHeader('Content-Type', 'text/html; charset=utf-8')
    if (details.prompt.name === 'login') { res.end(formPage({ uid, csrf, kind: 'login', clientName: client.clientName || client.clientId })); return }
    if (details.prompt.name === 'consent') {
      const resources = Object.keys(details.prompt.details.missingResourceScopes ?? {})
      const requested = new Set(String(details.params.scope ?? '').split(/\s+/).filter(Boolean))
      if (resources.some((resource) => resource !== RESOURCE) || !requested.has(TIMEWEB_SCOPE)) {
        await provider.interactionFinished(req, res, { error: 'access_denied', error_description: 'Requested authorization is outside the Timeweb Cloud MCP profile' }, { mergeWithLastSubmission: false }); return
      }
      res.end(formPage({ uid, csrf, kind: 'consent', clientName: client.clientName || client.clientId })); return
    }
    throw new Error('unsupported_interaction')
  }

  async function handleLogin(req, res, uid) {
    const details = await provider.interactionDetails(req, res)
    if (details.uid !== uid || details.prompt.name !== 'login') throw new Error('interaction_mismatch')
    const form = await readForm(req); const csrfCookie = parseCookies(req.headers.cookie)[CSRF_COOKIE]
    if (!equalSecret(form.csrf, csrfCookie)) { safeAudit('login_denied', { reason: 'csrf', subject: OWNER_SUB }); res.statusCode = 403; securityHeaders(res); res.end('Forbidden'); return }
    const keys = throttleKeys(req); const throttle = await getLoginThrottle(pool, keys); const locked = isLocked(throttle)
    let valid = false
    if (!locked && typeof form.password === 'string' && form.password.length <= 1024) { try { valid = await argon2.verify(ownerPasswordHash, form.password) } catch { valid = false } }
    if (!valid) {
      await recordLoginFailure(pool, keys); safeAudit('login_denied', { reason: locked ? 'rate_limited' : 'invalid_credentials', subject: OWNER_SUB })
      const client = await provider.Client.find(details.params.client_id); const csrf = randomBytes(32).toString('base64url'); securityHeaders(res); setCsrfCookie(res, csrf); res.statusCode = locked ? 429 : 401; res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(formPage({ uid, csrf, kind: 'login', clientName: client?.clientName || client?.clientId || 'OAuth client', error: 'Неверные данные или вход временно ограничен.' })); return
    }
    await clearLoginThrottle(pool, keys); safeAudit('login_success', { subject: OWNER_SUB })
    await provider.interactionFinished(req, res, { login: { accountId: OWNER_SUB, acr: 'urn:rr:owner:password', amr: ['pwd'], remember: true } }, { mergeWithLastSubmission: false })
  }

  async function handleConsent(req, res, uid) {
    const details = await provider.interactionDetails(req, res)
    if (details.uid !== uid || details.prompt.name !== 'consent' || details.session?.accountId !== OWNER_SUB) throw new Error('interaction_mismatch')
    const form = await readForm(req); const csrfCookie = parseCookies(req.headers.cookie)[CSRF_COOKIE]
    if (!equalSecret(form.csrf, csrfCookie)) { res.statusCode = 403; securityHeaders(res); res.end('Forbidden'); return }
    const requested = new Set(String(details.params.scope ?? '').split(/\s+/).filter(Boolean))
    const requestedResources = Array.isArray(details.params.resource) ? details.params.resource : [details.params.resource].filter(Boolean)
    if (requestedResources.length !== 1 || requestedResources[0] !== RESOURCE || !requested.has(TIMEWEB_SCOPE) || [...requested].some((scope) => !['openid', 'offline_access', TIMEWEB_SCOPE].includes(scope))) {
      await provider.interactionFinished(req, res, { error: 'access_denied', error_description: 'Requested authorization is outside the Timeweb Cloud MCP profile' }, { mergeWithLastSubmission: false }); return
    }
    let grantId = details.grantId; let grant = grantId ? await provider.Grant.find(grantId) : undefined
    if (!grant) grant = new provider.Grant({ accountId: OWNER_SUB, clientId: details.params.client_id })
    if (details.prompt.details.missingOIDCScope) grant.addOIDCScope(details.prompt.details.missingOIDCScope.join(' '))
    if (details.prompt.details.missingOIDCClaims) grant.addOIDCClaims(details.prompt.details.missingOIDCClaims)
    for (const [resource, scopes] of Object.entries(details.prompt.details.missingResourceScopes ?? {})) {
      if (resource !== RESOURCE || scopes.some((scope) => scope !== TIMEWEB_SCOPE)) throw new Error('unsafe_resource_scope')
      grant.addResourceScope(resource, scopes.join(' '))
    }
    grantId = await grant.save(); await provider.interactionFinished(req, res, { consent: details.grantId ? {} : { grantId } }, { mergeWithLastSubmission: true })
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'https://recruiter-radar.ru')
      if (req.method === 'GET' && url.pathname === '/healthz') { res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}'); return }
      const interactionMatch = url.pathname.match(/^\/operator\/oauth\/interaction\/([^/]+)$/)
      const loginMatch = url.pathname.match(/^\/operator\/oauth\/interaction\/([^/]+)\/login$/)
      const consentMatch = url.pathname.match(/^\/operator\/oauth\/interaction\/([^/]+)\/confirm$/)
      if (req.method === 'GET' && interactionMatch) { await renderInteraction(req, res, decodeURIComponent(interactionMatch[1])); return }
      if (req.method === 'POST' && loginMatch) { await handleLogin(req, res, decodeURIComponent(loginMatch[1])); return }
      if (req.method === 'POST' && consentMatch) { await handleConsent(req, res, decodeURIComponent(consentMatch[1])); return }
      if (url.pathname === RFC8414_PATH) { req.url = req.url.replace(RFC8414_PATH, '/.well-known/oauth-authorization-server'); providerCallback(req, res); return }
      if (url.pathname === `${OIDC_PREFIX}/.well-known/openid-configuration`) { req.url = req.url.replace(`${OIDC_PREFIX}/.well-known/openid-configuration`, '/.well-known/openid-configuration'); providerCallback(req, res); return }
      if (url.pathname.startsWith(`${OIDC_PREFIX}/`)) { providerCallback(req, res); return }
      res.statusCode = 404; res.end('Not Found')
    } catch (error) {
      safeAudit('request_denied', { reason: error instanceof Error ? error.message : 'internal_error' })
      if (!res.headersSent) { securityHeaders(res); res.statusCode = 500; res.setHeader('Content-Type', 'text/plain; charset=utf-8') }
      if (!res.writableEnded) res.end('Authentication service error')
    }
  })
  const cleanupTimer = setInterval(() => cleanupExpiredAuthState(pool).catch(() => safeAudit('storage_cleanup_failed')), 15 * 60 * 1000); cleanupTimer.unref()
  server.on('close', () => { clearInterval(cleanupTimer); pool.end().catch(() => undefined) })
  return { provider, pool, server }
}