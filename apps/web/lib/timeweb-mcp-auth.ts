import { createPublicKey, verify as verifySignature } from 'node:crypto'

export const TIMEWEB_MCP_RESOURCE = 'https://recruiter-radar.ru/api/internal/timeweb-mcp'
export const TIMEWEB_MCP_OAUTH_ISSUER = 'https://recruiter-radar.ru/operator/oauth'
export const TIMEWEB_MCP_SCOPE = 'rr.timeweb.manage'
export const TIMEWEB_MCP_OWNER_SUBJECT = 'rr_owner'
export const TIMEWEB_MCP_PROTECTED_RESOURCE_METADATA_URL =
  'https://recruiter-radar.ru/.well-known/oauth-protected-resource/api/internal/timeweb-mcp'

const OAUTH_FETCH_TIMEOUT_MS = 5_000
const JWT_CLOCK_SKEW_SECONDS = 30
const JWT_IAT_MAX_AGE_SECONDS = 24 * 60 * 60
const RATE_WINDOW_MS = 60_000
const RATE_LIMIT = 60
const PREAUTH_RATE_LIMIT = 120

type JsonObject = Record<string, unknown>
type RateBucket = { windowStartedAt: number; count: number }
const rateBuckets = new Map<string, RateBucket>()

export type TimewebMcpAuthResult =
  | { ok: true; subject: string; scopes: Set<string> }
  | { ok: false; reason: string }

export function isTimewebMcpConfigured(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.RR_TIMEWEB_MCP_ENABLED === 'true'
    && Boolean(env.RR_TIMEWEB_MCP_TOKEN?.trim())
    && env.RR_MCP_OAUTH_ISSUER?.trim() === TIMEWEB_MCP_OAUTH_ISSUER
    && env.RR_MCP_OAUTH_ALLOWED_SUBJECTS?.trim() === TIMEWEB_MCP_OWNER_SUBJECT
}

export function getTimewebMcpProtectedResourceMetadata() {
  return {
    resource: TIMEWEB_MCP_RESOURCE,
    authorization_servers: [TIMEWEB_MCP_OAUTH_ISSUER],
    bearer_methods_supported: ['header'],
    scopes_supported: [TIMEWEB_MCP_SCOPE],
  }
}

export function getTimewebMcpAuthenticateChallenge(
  error?: 'invalid_token' | 'insufficient_scope',
): string {
  const suffix = error
    ? `, error="${error}", error_description="OAuth authorization is required for Timeweb Cloud MCP access"`
    : ''
  return `Bearer resource_metadata="${TIMEWEB_MCP_PROTECTED_RESOURCE_METADATA_URL}", scope="${TIMEWEB_MCP_SCOPE}"${suffix}`
}

export function checkTimewebMcpRateLimit(
  key: string,
  nowMs = Date.now(),
  limit = RATE_LIMIT,
): { allowed: boolean; retryAfterSeconds: number } {
  const normalized = key.trim() || 'unknown'
  let bucket = rateBuckets.get(normalized)
  if (!bucket || nowMs - bucket.windowStartedAt >= RATE_WINDOW_MS) {
    bucket = { windowStartedAt: nowMs, count: 0 }
    rateBuckets.set(normalized, bucket)
  }
  bucket.count += 1
  if (rateBuckets.size > 5_000) {
    for (const [candidate, value] of rateBuckets) {
      if (nowMs - value.windowStartedAt >= RATE_WINDOW_MS) rateBuckets.delete(candidate)
    }
  }
  return {
    allowed: bucket.count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.windowStartedAt + RATE_WINDOW_MS - nowMs) / 1000)),
  }
}

export const TIMEWEB_MCP_PREAUTH_RATE_LIMIT = PREAUTH_RATE_LIMIT

export async function verifyTimewebMcpAccessToken(
  authorization: string | null,
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetchImpl: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<TimewebMcpAuthResult> {
  if (env.RR_MCP_OAUTH_ISSUER?.trim() !== TIMEWEB_MCP_OAUTH_ISSUER) {
    return { ok: false, reason: 'oauth_not_configured' }
  }
  if (env.RR_MCP_OAUTH_ALLOWED_SUBJECTS?.trim() !== TIMEWEB_MCP_OWNER_SUBJECT) {
    return { ok: false, reason: 'oauth_not_configured' }
  }
  if (!authorization?.startsWith('Bearer ')) return { ok: false, reason: 'missing_bearer_token' }

  const token = authorization.slice(7).trim()
  const parts = token.split('.')
  if (parts.length !== 3 || parts.some((part) => !part)) return { ok: false, reason: 'malformed_access_token' }

  let header: JsonObject
  let claims: JsonObject
  try {
    header = decodeJson(parts[0])
    claims = decodeJson(parts[1])
  } catch {
    return { ok: false, reason: 'malformed_access_token' }
  }

  if (header.alg !== 'ES256' || typeof header.kid !== 'string' || !header.kid) {
    return { ok: false, reason: 'unsupported_access_token' }
  }

  try {
    const metadata = await fetchJson(`${TIMEWEB_MCP_OAUTH_ISSUER}/.well-known/openid-configuration`, fetchImpl)
    if (metadata.issuer !== TIMEWEB_MCP_OAUTH_ISSUER) throw new Error('issuer mismatch')
    const jwksUri = typeof metadata.jwks_uri === 'string' ? metadata.jwks_uri : ''
    if (jwksUri !== `${TIMEWEB_MCP_OAUTH_ISSUER}/jwks`) throw new Error('unexpected jwks uri')
    const jwks = await fetchJson(jwksUri, fetchImpl)
    if (!Array.isArray(jwks.keys)) throw new Error('invalid jwks')
    const jwk = jwks.keys.find((candidate) => {
      if (!isObject(candidate)) return false
      return candidate.kid === header.kid
        && candidate.kty === 'EC'
        && candidate.crv === 'P-256'
        && candidate.use === 'sig'
        && candidate.alg === 'ES256'
        && typeof candidate.x === 'string'
        && typeof candidate.y === 'string'
        && candidate.d === undefined
    })
    if (!jwk || !isObject(jwk)) return { ok: false, reason: 'signing_key_not_found' }
    const publicKey = createPublicKey({ key: jwk as never, format: 'jwk' })
    const valid = verifySignature(
      'sha256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(parts[2], 'base64url'),
    )
    if (!valid) return { ok: false, reason: 'invalid_signature' }
  } catch {
    return { ok: false, reason: 'oauth_discovery_failed' }
  }

  const now = Math.floor(nowMs / 1000)
  if (claims.iss !== TIMEWEB_MCP_OAUTH_ISSUER) return { ok: false, reason: 'issuer_mismatch' }
  if (!hasExactAudience(claims.aud, TIMEWEB_MCP_RESOURCE)) return { ok: false, reason: 'audience_mismatch' }
  if (typeof claims.exp !== 'number' || claims.exp <= now - JWT_CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: 'token_expired' }
  }
  if (
    typeof claims.iat !== 'number'
    || claims.iat > now + JWT_CLOCK_SKEW_SECONDS
    || claims.iat < now - JWT_IAT_MAX_AGE_SECONDS
    || claims.iat >= claims.exp
  ) return { ok: false, reason: 'invalid_issued_at' }
  if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > now + JWT_CLOCK_SKEW_SECONDS)) {
    return { ok: false, reason: 'token_not_yet_valid' }
  }

  const scopes = tokenScopes(claims)
  if (!scopes.has(TIMEWEB_MCP_SCOPE)) return { ok: false, reason: 'insufficient_scope' }
  const subject = typeof claims.sub === 'string' ? claims.sub.trim() : ''
  if (subject !== TIMEWEB_MCP_OWNER_SUBJECT) return { ok: false, reason: 'subject_not_allowed' }
  return { ok: true, subject, scopes }
}

async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<JsonObject> {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(OAUTH_FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`OAuth endpoint returned ${response.status}`)
  const body = await response.json() as unknown
  if (!isObject(body)) throw new Error('invalid json')
  return body
}

function decodeJson(segment: string): JsonObject {
  const value = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as unknown
  if (!isObject(value)) throw new Error('not object')
  return value
}

function hasExactAudience(value: unknown, expected: string): boolean {
  return typeof value === 'string'
    ? value === expected
    : Array.isArray(value) && value.length === 1 && value[0] === expected
}

function tokenScopes(claims: JsonObject): Set<string> {
  const result = new Set<string>()
  for (const key of ['scope', 'scp']) {
    const value = claims[key]
    if (typeof value === 'string') for (const scope of value.split(/\s+/)) if (scope) result.add(scope)
    if (Array.isArray(value)) for (const scope of value) if (typeof scope === 'string') result.add(scope)
  }
  return result
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
