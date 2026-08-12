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
export const RESOURCE = 'https://recruiter-radar.ru/api/internal/mcp'
export const OWNER_SUB = 'rr_owner'
export const READ_SCOPE = 'rr.operator.read'
export const OIDC_PREFIX = '/operator/oauth'
export const RFC8414_PATH = '/.well-known/oauth-authorization-server/operator/oauth'

const MAX_FORM_BYTES = 8192
const ACCESS_TOKEN_TTL = 15 * 60
const AUTHORIZATION_CODE_TTL = 2 * 60
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60
const SESSION_TTL = 12 * 60 * 60
const INTERACTION_TTL = 10 * 60
const CSRF_COOKIE = '__Host-rr_mcp_csrf'

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function validateStaticConfiguration() {
  if (required('RR_OPERATOR_AUTH_PROVIDER') !== 'local_oidc') {
    throw new Error('RR_OPERATOR_AUTH_PROVIDER must be local_oidc')
  }
  if (required('RR_MCP_OAUTH_ISSUER') !== ISSUER) {
    throw new Error(`RR_MCP_OAUTH_ISSUER must be exactly ${ISSUER}`)
  }
  if (required('RR_MCP_RESOURCE') !== RESOURCE) {
    throw new Error(`RR_MCP_RESOURCE must be exactly ${RESOURCE}`)
  }
  if (required('RR_MCP_ALLOWED_SUBJECTS') !== OWNER_SUB) {
    throw new Error(`RR_MCP_ALLOWED_SUBJECTS must be exactly ${OWNER_SUB}`)
  }
  const passwordHash = required('RR_MCP_OWNER_PASSWORD_HASH')
  if (!passwordHash.startsWith('$argon2id$')) {
    throw new Error('RR_MCP_OWNER_PASSWORD_HASH must be an Argon2id encoded hash')
  }
  return passwordHash
}

async function readJsonFile(name) {
  const file = required(name)
  const raw = await readFile(file, 'utf8')
  return JSON.parse(raw)
}

function validateJwks(jwks) {
  if (!jwks || !Array.isArray(jwks.keys) || jwks.keys.length < 1) {
    throw new Error('RR_MCP_OAUTH_JWKS_FILE must contain a JWK Set')
  }
  const kids = new Set()
  for (const key of jwks.keys) {
    if (
      key?.kty !== 'EC'
      || key?.crv !== 'P-256'
      || key?.alg !== 'ES256'
      || key?.use !== 'sig'
      || typeof key?.kid !== 'string'
      || !key.kid
      || typeof key?.d !== 'string'
      || !key.d
    ) {
      throw new Error('Every OAuth signing JWK must be a private ES256 P-256 signing key with kid')
    }
    if (kids.has(key.kid)) throw new Error('OAuth signing JWK kids must be unique')
    kids.add(key.kid)
  }
  return jwks
}

function validateCookieKeys(value) {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error('RR_MCP_OAUTH_COOKIE_KEYS_FILE must contain at least two persistent cookie keys')
  }
  for (const key of value) {
    if (typeof key !== 'string' || key.length < 32) {
      throw new Error('OAuth cookie keys must be strings of at least 32 characters')
    }
  }
  return value
}

function safeAudit(event, fields = {}) {
  const allowed = {}
  for (const [key, value] of Object.entries(fields)) {
    if (!['client_id', 'grant_type', 'reason', 'route', 'subject', 'status'].includes(key)) continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      allowed[key] = String(value).slice(0, 160)
    }
  }
  console.info(JSON.stringify({
    ts: new Date().toISOString(),
    component: 'operator-auth',
    event,
    ...allowed,
  }))
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
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
  const title = kind === 'login' ? 'Recruiter Radar Operator' : 'Разрешить доступ'
  const action = kind === 'login'
    ? `${OIDC_PREFIX}/interaction/${encodeURIComponent(uid)}/login`
    : `${OIDC_PREFIX}/interaction/${encodeURIComponent(uid)}/confirm`
  const control = kind === 'login'
    ? '<label>Пароль владельца<input name="password" type="password" autocomplete="current-password" required autofocus></label>'
    : '<p>ChatGPT получит только read-only доступ к диагностике Recruiter Radar.</p>'
  const button = kind === 'login' ? 'Войти' : 'Разрешить read-only доступ'
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font:15px/1.5 system-ui,sans-serif;background:#111;color:#eee;margin:0;display:grid;place-items:center;min-height:100vh}.card{width:min(420px,calc(100vw - 32px));padding:28px;border:1px solid #333;border-radius:16px;background:#171717}h1{font-size:20px;margin:0 0 8px}.muted{color:#aaa;margin:0 0 20px}label{display:grid;gap:8px;margin:18px 0}input{font:inherit;padding:12px;border-radius:10px;border:1px solid #444;background:#0f0f0f;color:#fff}button{font:inherit;width:100%;padding:12px;border:0;border-radius:10px;font-weight:650;cursor:pointer}.error{min-height:22px;color:#ff9b9b}</style></head><body><main class="card"><h1>${escapeHtml(title)}</h1><p class="muted">${escapeHtml(clientName || 'OAuth client')}</p><div class="error">${escapeHtml(error)}</div><form method="post" action="${action}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">${control}<button type="submit">${escapeHtml(button)}</button></form></main></body></html>`
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=')
    return index === -1 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
  }))
}

function setCsrfCookie(res, value) {
  res.setHeader('Set-Cookie', `${CSRF_COOKIE}=${encodeURIComponent(value)}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=600`)
}

function equalSecret(left, right) {
  const a = Buffer.from(String(left ?? ''))
  const b = Buffer.from(String(right ?? ''))
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}

async function readForm(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_FORM_BYTES) throw new Error('form_too_large')
    chunks.push(chunk)
  }
  const body = new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
  return Object.fromEntries(body.entries())
}

function hashedIp(req) {
  const ip = String(req.headers['x-real-ip'] ?? '')
  return createHash('sha256').update(ip || 'missing').digest('hex')
}

function throttleKeys(req) {
  return [`ip:${hashedIp(req)}`, `account:${OWNER_SUB}`]
}

function isLocked(rows) {
  const now = Date.now()
  return rows.some((row) => row.locked_until && new Date(row.locked_until).getTime() > now)
}

function validateRedirectUri(uri) {
  if (typeof uri !== 'string' || uri.length > 2048 || uri.includes('*')) {
    throw new errors.InvalidClientMetadata('redirect_uris must be exact HTTPS URIs')
  }
  let url
  try {
    url = new URL(uri)
  } catch {
    throw new errors.InvalidClientMetadata('redirect_uris must be valid absolute URIs')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new errors.InvalidClientMetadata('redirect_uris must be exact HTTPS URIs without credentials or fragments')
  }
}

function validateDynamicClientMetadata(metadata) {
  if (metadata.token_endpoint_auth_method && metadata.token_endpoint_auth_method !== 'none') {
    throw new errors.InvalidClientMetadata('Only public clients are accepted')
  }
  if (metadata.response_types && (
    !Array.isArray(metadata.response_types)
    || metadata.response_types.length !== 1
    || metadata.response_types[0] !== 'code'
  )) {
    throw new errors.InvalidClientMetadata('Only response_type=code is accepted')
  }
  if (metadata.grant_types && (
    !Array.isArray(metadata.grant_types)
    || metadata.grant_types.some((value) => !['authorization_code', 'refresh_token'].includes(value))
  )) {
    throw new errors.InvalidClientMetadata('Only authorization_code and refresh_token grants are accepted')
  }
  if (!Array.isArray(metadata.redirect_uris) || metadata.redirect_uris.length < 1 || metadata.redirect_uris.length > 5) {
    throw new errors.InvalidClientMetadata('One to five exact redirect_uris are required')
  }
  metadata.redirect_uris.forEach(validateRedirectUri)
  metadata.token_endpoint_auth_method = 'none'
  metadata.response_types = ['code']
  metadata.grant_types = ['authorization_code', 'refresh_token']
}

export async function createOperatorAuthServer() {
  const ownerPasswordHash = validateStaticConfiguration()
  const jwks = validateJwks(await readJsonFile('RR_MCP_OAUTH_JWKS_FILE'))
  const cookieKeys = validateCookieKeys(await readJsonFile('RR_MCP_OAUTH_COOKIE_KEYS_FILE'))
  const pool = createAuthPool()
  await assertAuthStorageReady(pool)
  const Adapter = createPostgresAdapter(pool)

  const provider = new Provider(ISSUER, {
    adapter: Adapter,
    clients: [],
    claims: { openid: ['sub'] },
    clientAuthMethods: ['none'],
    clientDefaults: {
      token_endpoint_auth_method: 'none',
      response_types: ['code'],
      grant_types: ['authorization_code', 'refresh_token'],
    },
    cookies: { keys: cookieKeys },
    extraClientMetadata: {
      properties: ['rr_mcp_profile'],
      validator(_ctx, _key, _value, metadata) {
        validateDynamicClientMetadata(metadata)
        metadata.rr_mcp_profile = 'read-only'
      },
    },
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: true, issueRegistrationAccessToken: false },
      registrationManagement: { enabled: false },
      revocation: { enabled: true },
      resourceIndicators: {
        enabled: true,
        defaultResource() {
          return undefined
        },
        useGrantedResource() {
          return false
        },
        getResourceServerInfo(_ctx, resource) {
          if (resource !== RESOURCE) throw new errors.InvalidTarget('Unknown resource')
          return {
            audience: RESOURCE,
            scope: READ_SCOPE,
            accessTokenTTL: ACCESS_TOKEN_TTL,
            accessTokenFormat: 'jwt',
            jwt: { sign: { alg: 'ES256' } },
          }
        },
      },
    },
    findAccount(_ctx, id) {
      if (id !== OWNER_SUB) return undefined
      return {
        accountId: OWNER_SUB,
        async claims() {
          return { sub: OWNER_SUB }
        },
      }
    },
    idTokenSigningAlgValues: ['ES256'],
    interactions: {
      url(_ctx, interaction) {
        return `${OIDC_PREFIX}/interaction/${interaction.uid}`
      },
    },
    issueRefreshToken(_ctx, client, code) {
      return client.grantTypeAllowed('refresh_token') && code.scopes.has('offline_access')
    },
    jwks,
    pkce: {
      required() {
        return true
      },
    },
    routes: {
      authorization: `${OIDC_PREFIX}/auth`,
      jwks: `${OIDC_PREFIX}/jwks`,
      registration: `${OIDC_PREFIX}/reg`,
      revocation: `${OIDC_PREFIX}/token/revocation`,
      token: `${OIDC_PREFIX}/token`,
    },
    responseTypes: ['code'],
    grantTypes: ['authorization_code', 'refresh_token'],
    rotateRefreshToken: true,
    scopes: ['openid', 'offline_access', READ_SCOPE],
    ttl: {
      AccessToken: ACCESS_TOKEN_TTL,
      AuthorizationCode: AUTHORIZATION_CODE_TTL,
      RefreshToken: REFRESH_TOKEN_TTL,
      Session: SESSION_TTL,
      Interaction: INTERACTION_TTL,
    },
  })
  provider.proxy = true

  provider.on('authorization.success', (ctx) => {
    safeAudit('authorization_granted', {
      client_id: ctx.oidc?.client?.clientId ?? '',
      subject: ctx.oidc?.entities?.Account?.accountId ?? OWNER_SUB,
    })
  })
  provider.on('grant.success', (ctx) => {
    if (ctx.oidc?.params?.grant_type === 'refresh_token') {
      safeAudit('token_refresh', { client_id: ctx.oidc?.client?.clientId ?? '', grant_type: 'refresh_token' })
    }
  })
  provider.on('revocation.success', (ctx) => {
    safeAudit('token_revoked', { client_id: ctx.oidc?.client?.clientId ?? '' })
  })
  provider.on('client.created', (client) => {
    safeAudit('client_registered', { client_id: client.clientId ?? '' })
  })

  const providerCallback = provider.callback()

  async function renderInteraction(req, res, uid) {
    const details = await provider.interactionDetails(req, res)
    if (details.uid !== uid) throw new Error('interaction_mismatch')
    const client = await provider.Client.find(details.params.client_id)
    if (!client) throw new Error('client_not_found')
    const csrf = randomBytes(32).toString('base64url')
    securityHeaders(res)
    setCsrfCookie(res, csrf)
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    if (details.prompt.name === 'login') {
      res.end(formPage({ uid, csrf, kind: 'login', clientName: client.clientName || client.clientId }))
      return
    }
    if (details.prompt.name === 'consent') {
      const resources = Object.keys(details.prompt.details.missingResourceScopes ?? {})
      const requested = new Set(String(details.params.scope ?? '').split(/\s+/).filter(Boolean))
      if (resources.some((resource) => resource !== RESOURCE) || !requested.has(READ_SCOPE)) {
        await provider.interactionFinished(req, res, {
          error: 'access_denied',
          error_description: 'Requested authorization is outside the Recruiter Radar operator profile',
        }, { mergeWithLastSubmission: false })
        return
      }
      res.end(formPage({ uid, csrf, kind: 'consent', clientName: client.clientName || client.clientId }))
      return
    }
    throw new Error('unsupported_interaction')
  }

  async function handleLogin(req, res, uid) {
    const details = await provider.interactionDetails(req, res)
    if (details.uid !== uid || details.prompt.name !== 'login') throw new Error('interaction_mismatch')
    const form = await readForm(req)
    const csrfCookie = parseCookies(req.headers.cookie)[CSRF_COOKIE]
    if (!equalSecret(form.csrf, csrfCookie)) {
      safeAudit('login_denied', { reason: 'csrf', subject: OWNER_SUB })
      res.statusCode = 403
      securityHeaders(res)
      res.end('Forbidden')
      return
    }

    const keys = throttleKeys(req)
    const throttle = await getLoginThrottle(pool, keys)
    const locked = isLocked(throttle)
    let valid = false
    if (!locked && typeof form.password === 'string' && form.password.length <= 1024) {
      try {
        valid = await argon2.verify(ownerPasswordHash, form.password)
      } catch {
        valid = false
      }
    }

    if (!valid) {
      await recordLoginFailure(pool, keys)
      safeAudit('login_denied', { reason: locked ? 'rate_limited' : 'invalid_credentials', subject: OWNER_SUB })
      const client = await provider.Client.find(details.params.client_id)
      const csrf = randomBytes(32).toString('base64url')
      securityHeaders(res)
      setCsrfCookie(res, csrf)
      res.statusCode = locked ? 429 : 401
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(formPage({
        uid,
        csrf,
        kind: 'login',
        clientName: client?.clientName || client?.clientId || 'OAuth client',
        error: 'Неверные данные или вход временно ограничен.',
      }))
      return
    }

    await clearLoginThrottle(pool, keys)
    safeAudit('login_success', { subject: OWNER_SUB })
    await provider.interactionFinished(req, res, {
      login: {
        accountId: OWNER_SUB,
        acr: 'urn:rr:owner:password',
        amr: ['pwd'],
        remember: true,
      },
    }, { mergeWithLastSubmission: false })
  }

  async function handleConsent(req, res, uid) {
    const details = await provider.interactionDetails(req, res)
    if (details.uid !== uid || details.prompt.name !== 'consent' || details.session?.accountId !== OWNER_SUB) {
      throw new Error('interaction_mismatch')
    }
    const form = await readForm(req)
    const csrfCookie = parseCookies(req.headers.cookie)[CSRF_COOKIE]
    if (!equalSecret(form.csrf, csrfCookie)) {
      res.statusCode = 403
      securityHeaders(res)
      res.end('Forbidden')
      return
    }

    const requested = new Set(String(details.params.scope ?? '').split(/\s+/).filter(Boolean))
    const requestedResources = Array.isArray(details.params.resource)
      ? details.params.resource
      : [details.params.resource].filter(Boolean)
    if (
      requestedResources.length !== 1
      || requestedResources[0] !== RESOURCE
      || !requested.has(READ_SCOPE)
      || [...requested].some((scope) => !['openid', 'offline_access', READ_SCOPE].includes(scope))
    ) {
      await provider.interactionFinished(req, res, {
        error: 'access_denied',
        error_description: 'Requested authorization is outside the Recruiter Radar operator profile',
      }, { mergeWithLastSubmission: false })
      return
    }

    let grantId = details.grantId
    let grant = grantId ? await provider.Grant.find(grantId) : undefined
    if (!grant) {
      grant = new provider.Grant({ accountId: OWNER_SUB, clientId: details.params.client_id })
    }
    if (details.prompt.details.missingOIDCScope) {
      grant.addOIDCScope(details.prompt.details.missingOIDCScope.join(' '))
    }
    if (details.prompt.details.missingOIDCClaims) {
      grant.addOIDCClaims(details.prompt.details.missingOIDCClaims)
    }
    for (const [resource, scopes] of Object.entries(details.prompt.details.missingResourceScopes ?? {})) {
      if (resource !== RESOURCE || scopes.some((scope) => scope !== READ_SCOPE)) {
        throw new Error('unsafe_resource_scope')
      }
      grant.addResourceScope(resource, scopes.join(' '))
    }
    grantId = await grant.save()
    const consent = details.grantId ? {} : { grantId }
    await provider.interactionFinished(req, res, { consent }, { mergeWithLastSubmission: true })
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'https://recruiter-radar.ru')
      if (req.method === 'GET' && url.pathname === '/healthz') {
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end('{"ok":true}')
        return
      }

      const interactionMatch = url.pathname.match(/^\/operator\/oauth\/interaction\/([^/]+)$/)
      const loginMatch = url.pathname.match(/^\/operator\/oauth\/interaction\/([^/]+)\/login$/)
      const consentMatch = url.pathname.match(/^\/operator\/oauth\/interaction\/([^/]+)\/confirm$/)
      if (req.method === 'GET' && interactionMatch) {
        await renderInteraction(req, res, decodeURIComponent(interactionMatch[1]))
        return
      }
      if (req.method === 'POST' && loginMatch) {
        await handleLogin(req, res, decodeURIComponent(loginMatch[1]))
        return
      }
      if (req.method === 'POST' && consentMatch) {
        await handleConsent(req, res, decodeURIComponent(consentMatch[1]))
        return
      }

      if (url.pathname === RFC8414_PATH) {
        req.url = req.url.replace(RFC8414_PATH, '/.well-known/oauth-authorization-server')
        providerCallback(req, res)
        return
      }
      if (url.pathname === `${OIDC_PREFIX}/.well-known/openid-configuration`) {
        req.url = req.url.replace(
          `${OIDC_PREFIX}/.well-known/openid-configuration`,
          '/.well-known/openid-configuration',
        )
        providerCallback(req, res)
        return
      }
      if (url.pathname.startsWith(`${OIDC_PREFIX}/`)) {
        providerCallback(req, res)
        return
      }

      res.statusCode = 404
      res.end('Not Found')
    } catch (error) {
      safeAudit('request_denied', { reason: error instanceof Error ? error.message : 'internal_error' })
      if (!res.headersSent) {
        securityHeaders(res)
        res.statusCode = 500
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      }
      if (!res.writableEnded) res.end('Authentication service error')
    }
  })

  const cleanupTimer = setInterval(() => {
    cleanupExpiredAuthState(pool).catch(() => safeAudit('storage_cleanup_failed'))
  }, 15 * 60 * 1000)
  cleanupTimer.unref()

  server.on('close', () => {
    clearInterval(cleanupTimer)
    pool.end().catch(() => undefined)
  })

  return { provider, pool, server }
}

if (process.env.NODE_ENV !== 'test') {
  createOperatorAuthServer().then(({ server }) => {
    server.listen(3002, '127.0.0.1', () => safeAudit('service_started', { status: 'ready' }))
  }).catch((error) => {
    safeAudit('service_start_failed', { reason: error instanceof Error ? error.message : 'startup_error' })
    process.exitCode = 1
  })
}
