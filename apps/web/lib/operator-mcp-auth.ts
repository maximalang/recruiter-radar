import {
  constants as cryptoConstants,
  createPublicKey,
  verify as verifySignature,
} from 'node:crypto'

export const OPERATOR_MCP_RESOURCE =
  'https://recruiter-radar.ru/api/internal/mcp'
export const OPERATOR_MCP_PROTECTED_RESOURCE_METADATA_URL =
  'https://recruiter-radar.ru/.well-known/oauth-protected-resource'
export const OPERATOR_MCP_REQUIRED_SCOPE = 'rr.operator.read'
export const OPERATOR_MCP_RATE_LIMIT = 60
export const OPERATOR_MCP_RATE_WINDOW_MS = 60_000

const OAUTH_CACHE_TTL_MS = 5 * 60_000
const OAUTH_FETCH_TIMEOUT_MS = 5_000
const JWT_CLOCK_SKEW_SECONDS = 30
const SUPPORTED_JWT_ALGORITHMS = new Set(['RS256', 'PS256', 'ES256'])

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
  | { ok: true; subject: string }
  | { ok: false; reason: string }

export function getOperatorMcpOAuthConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): OAuthConfig | null {
  const rawIssuer = env.RR_MCP_OAUTH_ISSUER?.trim() ?? ''
  const rawAllowedSubjects = env.RR_MCP_OAUTH_ALLOWED_SUBJECTS?.trim() ?? ''

  if (!rawIssuer || !rawAllowedSubjects) return null

  let issuerUrl: URL
  try {
    issuerUrl = new URL(rawIssuer)
  } catch {
    return null
  }

  if (
    issuerUrl.protocol !== 'https:' ||
    issuerUrl.username ||
    issuerUrl.password ||
    issuerUrl.search ||
    issuerUrl.hash
  ) {
    return null
  }

  // URL#toString canonicalizes an origin-only issuer to the RFC-compatible
  // trailing-slash form used by providers such as Auth0. Keep that exact issuer
  // identifier for protected-resource metadata and access-token validation.
  const issuer = issuerUrl.toString()
  const allowedSubjects = new Set(
    rawAllowedSubjects
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )

  if (allowedSubjects.size === 0) return null

  return { issuer, allowedSubjects }
}

export function getOperatorMcpProtectedResourceMetadata(
  env: Readonly<Record<string, string | undefined>> = process.env,
): JsonObject | null {
  const config = getOperatorMcpOAuthConfig(env)
  if (!config) return null

  return {
    resource: OPERATOR_MCP_RESOURCE,
    authorization_servers: [config.issuer],
    scopes_supported: [OPERATOR_MCP_REQUIRED_SCOPE],
  }
}

export function getOperatorMcpAuthenticateChallenge(
  error?: 'invalid_token' | 'insufficient_scope',
): string {
  const suffix = error
    ? `, error="${error}", error_description="OAuth authorization is required for Recruiter Radar operator diagnostics"`
    : ''
  return `Bearer resource_metadata="${OPERATOR_MCP_PROTECTED_RESOURCE_METADATA_URL}", scope="${OPERATOR_MCP_REQUIRED_SCOPE}"${suffix}`
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
  if (canonicalizeIssuer(claims.iss) !== config.issuer) {
    return { ok: false, reason: 'issuer_mismatch' }
  }
  if (!hasAudience(claims.aud, OPERATOR_MCP_RESOURCE)) {
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
    claims.nbf !== undefined &&
    (typeof claims.nbf !== 'number' ||
      !Number.isFinite(claims.nbf) ||
      claims.nbf > nowSeconds + JWT_CLOCK_SKEW_SECONDS)
  ) {
    return { ok: false, reason: 'token_not_yet_valid' }
  }

  const scopes = getTokenScopes(claims)
  if (!scopes.has(OPERATOR_MCP_REQUIRED_SCOPE)) {
    return { ok: false, reason: 'insufficient_scope' }
  }

  const subject = typeof claims.sub === 'string' ? claims.sub.trim() : ''
  if (!subject || !config.allowedSubjects.has(subject)) {
    return { ok: false, reason: 'subject_not_allowed' }
  }

  return { ok: true, subject }
}

export function checkOperatorMcpRateLimit(
  key: string,
  nowMs = Date.now(),
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
    allowed: bucket.count <= OPERATOR_MCP_RATE_LIMIT,
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

  const issuerBase = issuer.replace(/\/$/, '')
  const candidates = [
    `${issuerBase}/.well-known/openid-configuration`,
    `${issuerBase}/.well-known/oauth-authorization-server`,
  ]

  let lastError: unknown = new Error('OAuth discovery failed')
  for (const url of candidates) {
    try {
      const body = await fetchJsonObject(url, fetchImpl)
      const discoveredIssuer = canonicalizeIssuer(body.issuer)
      const jwksUri = typeof body.jwks_uri === 'string' ? body.jwks_uri : ''
      if (discoveredIssuer !== issuer || !isSecureHttpsUrl(jwksUri)) {
        throw new Error('OAuth metadata is inconsistent')
      }
      const value = { issuer: discoveredIssuer, jwksUri }
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
    (key.use === undefined || key.use === 'sig') &&
    (key.alg === undefined || key.alg === alg),
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

  if (alg === 'RS256') {
    return verifySignature('RSA-SHA256', signingInput, key, signature)
  }
  if (alg === 'PS256') {
    return verifySignature(
      'sha256',
      signingInput,
      {
        key,
        padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32,
      },
      signature,
    )
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

function hasAudience(value: unknown, expected: string): boolean {
  if (typeof value === 'string') return value === expected
  return Array.isArray(value) && value.some((item) => item === expected)
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

function canonicalizeIssuer(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return ''
  try {
    const url = new URL(value.trim())
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return ''
    }
    return url.toString()
  } catch {
    return ''
  }
}

function isSecureHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
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
