import {
  createPublicKey,
  verify as verifySignature,
} from 'node:crypto'

export const OPERATOR_MCP_RESOURCE =
  'https://recruiter-radar.ru/api/internal/mcp'
export const OPERATOR_MCP_OAUTH_ISSUER =
  'https://recruiter-radar.ru/operator/oauth'
export const OPERATOR_MCP_OWNER_SUBJECT = 'rr_owner'
export const OPERATOR_MCP_PROTECTED_RESOURCE_METADATA_URL =
  'https://recruiter-radar.ru/.well-known/oauth-protected-resource/api/internal/mcp'
export const OPERATOR_MCP_COMPAT_PROTECTED_RESOURCE_METADATA_URL =
  'https://recruiter-radar.ru/.well-known/oauth-protected-resource'

export const OPERATOR_MCP_READ_SCOPE = 'rr.operator.read'
export const OPERATOR_MCP_RESTART_SCOPE = 'rr.operator.restart'
export const OPERATOR_MCP_PROXY_SCOPE = 'rr.operator.proxy'
export const OPERATOR_MCP_REQUIRED_SCOPE = OPERATOR_MCP_READ_SCOPE
export const OPERATOR_MCP_READ_SCOPES = [OPERATOR_MCP_READ_SCOPE] as const
export const OPERATOR_MCP_RESTART_SCOPES = [
  OPERATOR_MCP_READ_SCOPE,
  OPERATOR_MCP_RESTART_SCOPE,
] as const
export const OPERATOR_MCP_PROXY_SCOPES = [
  OPERATOR_MCP_READ_SCOPE,
  OPERATOR_MCP_PROXY_SCOPE,
] as const

export const OPERATOR_MCP_RATE_LIMIT = 60
export const OPERATOR_MCP_PREAUTH_RATE_LIMIT = 120
export const OPERATOR_MCP_RATE_WINDOW_MS = 60_000

const OAUTH_CACHE_TTL_MS = 5 * 60_000
const OAUTH_FETCH_TIMEOUT_MS = 5_000
const JWT_CLOCK_SKEW_SECONDS = 30
const JWT_IAT_MAX_AGE_SECONDS = 24 * 60 * 60
const SUPPORTED_JWT_ALGORITHMS = new Set(['ES256'])

type JsonObject = Record<string, unknown>

type OAuthConfig = {
  issuer: string
  allowedSubjects: Set<string>
}

type OAuthMetadata = {
  issuer: string
  jwksUri: string
}

type JsonWebKeyRecord = JsonObject & {
  kid?: string
  alg?: string
  use?: string
}

type CachedValue<T> = {
  expiresAt: number
  value: T
}

type RateBucket = {
  windowStartedAt: number
  count: number
}

const metadataCache = new Map<string, CachedValue<OAuthMetadata>>()
const jwksCache = new Map<string, CachedValue<JsonWebKeyRecord[]>>()
const rateBuckets = new Map<string, RateBucket>()

export type OperatorMcpAuthResult =
  | { ok: true; subject: string; scopes: Set<string> }
  | { ok: false; reason: string }

export function getOperatorMcpOAuthConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): OAuthConfig | null {
  const issuer = env.RR_MCP_OAUTH_ISSUER?.trim() ?? ''
  const rawAllowedSubjects = env.RR_MCP_ALLOWED_SUBJECTS?.trim() ?? ''

  if (!issuer || !rawAllowedSubjects || !isIssuerUrl(issuer)) return null
  if (issuer !== OPERATOR_MCP_OAUTH_ISSUER) return null

  const allowedSubjects = new Set(
    rawAllowedSubjects
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )
  if (allowedSubjects.size !== 1 || !allowedSubjects.has(OPERATOR_MCP_OWNER_SUBJECT)) return null

  return { issuer, allowedSubjects }
}

export function getOperatorMcpSupportedScopes(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  const scopes = [OPERATOR_MCP_READ_SCOPE]
  if (env.RR_MCP_MUTATIONS_ENABLED === 'true') {
    scopes.push(OPERATOR_MCP_RESTART_SCOPE, OPERATOR_MCP_PROXY_SCOPE)
  }
  return scopes
}

export function getOperatorMcpProtectedResourceMetadata(
  env: Readonly<Record<string, string | undefined>> = process.env,
): JsonObject | null {
  const config = getOperatorMcpOAuthConfig(env)
  if (!config) return null

  return {
    resource: OPERATOR_MCP_RESOURCE,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: [OPERATOR_MCP_READ_SCOPE],
  }
}

export function getOperatorMcpAuthenticateChallenge(
  error?: 'invalid_token' | 'insufficient_scope',
  requiredScopes: readonly string[] = OPERATOR_MCP_READ_SCOPES,
): string {
  const scope = requiredScopes.join(' ')
  const suffix = error
    ? `, error="${error}", error_description="OAuth authorization is required for Recruiter Radar operator access"`
    : ''
  return `Bearer resource_metadata="${OPERATOR_MCP_PROTECTED_RESOURCE_METADATA_URL}", scope="${scope}"${suffix}`
}

export async function verifyOperatorMcpAccessToken(
  authorization: string | null,
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetchImpl: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<OperatorMcpAuthResult> {
  const config = getOperatorMcpOAuthConfig(env)
  if (!config) return { ok: false, reason: 'oauth_not_configured' }
  if (!authorization?.startsWith('Bearer ')) {
    return { ok: false, reason: 'missing_bearer_token' }
  }

  const token = authorization.slice('Bearer '.length).trim()
  const parts = token.split('.')
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    return { ok: false, reason: 'malformed_access_token' }
  }

  let header: JsonObject
  let claims: JsonObject
  try {
    header = decodeJsonSegment(parts[0])
    claims = decodeJsonSegment(parts[1])
  } catch {
    return { ok: false, reason: 'malformed_access_token' }
  }

  const alg = typeof header.alg === 'string' ? header.alg : ''
  const kid = typeof header.kid === 'string' ? header.kid : ''
  if (!SUPPORTED_JWT_ALGORITHMS.has(alg) || !kid) {
    return { ok: false, reason: 'unsupported_access_token' }
  }

  try {
    const metadata = await loadOAuthMetadata(config.issuer, fetchImpl, nowMs)
    let jwks = await loadJwks(metadata.jwksUri, fetchImpl, nowMs, false)
    let jwk = findSigningKey(jwks, kid, alg)
    if (!jwk) {
      jwks = await loadJwks(metadata.jwksUri, fetchImpl, nowMs, true)
      jwk = findSigningKey(jwks, kid, alg)
    }
    if (!jwk) return { ok: false, reason: 'signing_key_not_found' }

    const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`)
    const signature = Buffer.from(parts[2], 'base64url')
    if (!verifyJwtSignature(alg, signingInput, signature, jwk)) {
      return { ok: false, reason: 'invalid_signature' }
    }
  } catch {
    return { ok: false, reason: 'oauth_discovery_failed' }
  }

  const nowSeconds = Math.floor(nowMs / 1000)
  if (claims.iss !== config.issuer) {
    return { ok: false, reason: 'issuer_mismatch' }
  }
  if (!hasExactAudience(claims.aud, OPERATOR_MCP_RESOURCE)) {
    return { ok: false, reason: 'audience_mismatch' }
  }
  if (
    typeof claims.exp !== 'number' ||
    !Number.isFinite(claims.exp) ||
    claims.exp <= nowSeconds - JWT_CLOCK_SKEW_SECONDS
  ) {
    return { ok: false, reason: 'token_expired' }
  }
  if (
    typeof claims.iat !== 'number' ||
    !Number.isFinite(claims.iat) ||
    claims.iat > nowSeconds + JWT_CLOCK_SKEW_SECONDS ||
    claims.iat < nowSeconds - JWT_IAT_MAX_AGE_SECONDS ||
    claims.iat >= claims.exp
  ) {
    return { ok: false, reason: 'invalid_issued_at' }
  }
  if (
    claims.nbf !== undefined &&
    (typeof claims.nbf !== 'number' ||
      !Number.isFinite(claims.nbf) ||
      claims.nbf > nowSeconds + JWT_CLOCK_SKEW_SECONDS)
  ) {
    return { ok: false, reason: 'token_not_yet_valid' }
  }

  const scopes = getTokenScopes(claims)
  if (!scopes.has(OPERATOR_MCP_READ_SCOPE)) {
    return { ok: false, reason: 'insufficient_scope' }
  }
  if (scopes.has('rr.operator.admin') || scopes.has('rr.operator.*')) {
    return { ok: false, reason: 'unsupported_scope' }
  }

  const subject = typeof claims.sub === 'string' ? claims.sub.trim() : ''
  if (!subject || !config.allowedSubjects.has(subject)) {
    return { ok: false, reason: 'subject_not_allowed' }
  }

  return { ok: true, subject, scopes }
}

export function hasOperatorMcpScopes(
  tokenScopes: ReadonlySet<string>,
  requiredScopes: readonly string[],
): boolean {
  return requiredScopes.every((scope) => tokenScopes.has(scope))
}

export function checkOperatorMcpRateLimit(
  key: string,
  nowMs = Date.now(),
  limit = OPERATOR_MCP_RATE_LIMIT,
): { allowed: boolean; retryAfterSeconds: number } {
  const normalizedKey = key.trim() || 'unknown'
  let bucket = rateBuckets.get(normalizedKey)

  if (!bucket || nowMs - bucket.windowStartedAt >= OPERATOR_MCP_RATE_WINDOW_MS) {
    bucket = { windowStartedAt: nowMs, count: 0 }
    rateBuckets.set(normalizedKey, bucket)
  }

  bucket.count += 1
  const windowEndsAt = bucket.windowStartedAt + OPERATOR_MCP_RATE_WINDOW_MS
  const retryAfterSeconds = Math.max(1, Math.ceil((windowEndsAt - nowMs) / 1000))

  if (rateBuckets.size > 5_000) cleanupRateBuckets(nowMs)

  return {
    allowed: bucket.count <= limit,
    retryAfterSeconds,
  }
}

export function resetOperatorMcpSecurityCachesForTests() {
  metadataCache.clear()
  jwksCache.clear()
  rateBuckets.clear()
}

async function loadOAuthMetadata(
  issuer: string,
  fetchImpl: typeof fetch,
  nowMs: number,
): Promise<OAuthMetadata> {
  const cached = metadataCache.get(issuer)
  if (cached && cached.expiresAt > nowMs) return cached.value

  const issuerUrl = new URL(issuer)
  const issuerBase = issuer.endsWith('/') ? issuer.slice(0, -1) : issuer
  const rfc8414Path = `/.well-known/oauth-authorization-server${issuerUrl.pathname}`
  const candidates = [
    `${issuerBase}/.well-known/openid-configuration`,
    `${issuerUrl.origin}${rfc8414Path}`,
  ]

  let lastError: unknown = new Error('OAuth discovery failed')
  for (const url of candidates) {
    try {
      const body = await fetchJsonObject(url, fetchImpl)
      if (body.issuer !== issuer) throw new Error('OAuth issuer mismatch')
      const jwksUri = typeof body.jwks_uri === 'string' ? body.jwks_uri : ''
      if (!isSecureHttpsUrl(jwksUri)) {
        throw new Error('OAuth metadata does not expose a secure JWKS URL')
      }
      if (jwksUri !== `${issuerBase}/jwks`) {
        throw new Error('OAuth metadata exposes an unexpected JWKS URL')
      }
      const value = { issuer, jwksUri }
      metadataCache.set(issuer, { expiresAt: nowMs + OAUTH_CACHE_TTL_MS, value })
      return value
    } catch (error) {
      lastError = error
    }
  }

  throw lastError
}

async function loadJwks(
  jwksUri: string,
  fetchImpl: typeof fetch,
  nowMs: number,
  forceRefresh: boolean,
): Promise<JsonWebKeyRecord[]> {
  const cached = jwksCache.get(jwksUri)
  if (!forceRefresh && cached && cached.expiresAt > nowMs) return cached.value

  const body = await fetchJsonObject(jwksUri, fetchImpl)
  if (!Array.isArray(body.keys)) throw new Error('JWKS keys are missing')
  const keys = body.keys.filter(isJsonObject) as JsonWebKeyRecord[]
  if (keys.length === 0) throw new Error('JWKS is empty')
  jwksCache.set(jwksUri, { expiresAt: nowMs + OAUTH_CACHE_TTL_MS, value: keys })
  return keys
}

async function fetchJsonObject(url: string, fetchImpl: typeof fetch): Promise<JsonObject> {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(OAUTH_FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`OAuth endpoint returned ${response.status}`)
  const body = await response.json() as unknown
  if (!isJsonObject(body)) throw new Error('OAuth endpoint returned invalid JSON')
  return body
}

function findSigningKey(
  keys: JsonWebKeyRecord[],
  kid: string,
  alg: string,
): JsonWebKeyRecord | undefined {
  return keys.find((key) =>
    key.kid === kid &&
    key.kty === 'EC' &&
    key.crv === 'P-256' &&
    key.use === 'sig' &&
    key.alg === alg &&
    typeof key.x === 'string' && key.x.length > 0 &&
    typeof key.y === 'string' && key.y.length > 0 &&
    key.d === undefined,
  )
}

function verifyJwtSignature(
  alg: string,
  signingInput: Buffer,
  signature: Buffer,
  jwk: JsonWebKeyRecord,
): boolean {
  let key
  try {
    key = createPublicKey({ key: jwk as never, format: 'jwk' })
  } catch {
    return false
  }

  if (alg === 'ES256') {
    return verifySignature(
      'sha256',
      signingInput,
      { key, dsaEncoding: 'ieee-p1363' },
      signature,
    )
  }
  return false
}

function decodeJsonSegment(segment: string): JsonObject {
  const parsed = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as unknown
  if (!isJsonObject(parsed)) throw new Error('JWT segment is not an object')
  return parsed
}

function hasExactAudience(value: unknown, expected: string): boolean {
  if (typeof value === 'string') return value === expected
  return Array.isArray(value) && value.length === 1 && value[0] === expected
}

function getTokenScopes(claims: JsonObject): Set<string> {
  const scopes = new Set<string>()
  if (typeof claims.scope === 'string') {
    for (const scope of claims.scope.split(/\s+/)) if (scope) scopes.add(scope)
  }
  if (typeof claims.scp === 'string') {
    for (const scope of claims.scp.split(/\s+/)) if (scope) scopes.add(scope)
  } else if (Array.isArray(claims.scp)) {
    for (const scope of claims.scp) if (typeof scope === 'string') scopes.add(scope)
  }
  if (Array.isArray(claims.permissions)) {
    for (const scope of claims.permissions) if (typeof scope === 'string') scopes.add(scope)
  }
  return scopes
}

function isIssuerUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !url.pathname.endsWith('/')
    )
  } catch {
    return false
  }
}

function isSecureHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.hash
    )
  } catch {
    return false
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cleanupRateBuckets(nowMs: number) {
  for (const [key, bucket] of rateBuckets) {
    if (nowMs - bucket.windowStartedAt >= OPERATOR_MCP_RATE_WINDOW_MS * 2) {
      rateBuckets.delete(key)
    }
  }
}
