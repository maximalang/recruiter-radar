import { fetchWithSourcePolicy } from './source-http.mjs';

const HH_TOKEN_URL = 'https://api.hh.ru/token';
const TOKEN_EXPIRY_SKEW_MS = 60_000;

let cachedToken = null;
let pendingToken = null;

export class HhOAuthError extends Error {
  constructor({ status = null, type = 'oauth_error', cause } = {}) {
    super(`HH application OAuth failed${status ? ` with HTTP ${status}` : ''} (${type}).`, { cause });
    this.name = 'HhOAuthError';
    this.status = status;
    this.type = type;
  }
}

export async function resolveHhApplicationAuthorization(env = process.env, options = {}) {
  const clientId = toText(env.HH_CLIENT_ID);
  const clientSecret = toText(env.HH_CLIENT_SECRET);

  if (!clientId && !clientSecret) return null;
  if (!clientId || !clientSecret) {
    throw new Error('HH_CLIENT_ID and HH_CLIENT_SECRET must be configured together.');
  }

  const userAgent = toText(env.HH_USER_AGENT);
  if (!userAgent) throw new Error('HH_USER_AGENT is required for application OAuth.');

  const now = Number.isFinite(options.now) ? options.now : Date.now();
  if (
    cachedToken?.clientId === clientId
    && cachedToken.expiresAt - TOKEN_EXPIRY_SKEW_MS > now
  ) {
    return `Bearer ${cachedToken.accessToken}`;
  }

  if (!pendingToken || pendingToken.clientId !== clientId) {
    pendingToken = {
      clientId,
      promise: requestApplicationToken({
        clientId,
        clientSecret,
        userAgent,
        fetchImpl: options.fetchImpl,
        now,
      }),
    };
  }

  try {
    cachedToken = await pendingToken.promise;
    return `Bearer ${cachedToken.accessToken}`;
  } finally {
    pendingToken = null;
  }
}

export function resetHhApplicationTokenCache() {
  cachedToken = null;
  pendingToken = null;
}

async function requestApplicationToken({ clientId, clientSecret, userAgent, fetchImpl, now }) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  let response;

  try {
    response = await fetchWithSourcePolicy(HH_TOKEN_URL, {
      sourceName: 'hh-oauth',
      method: 'POST',
      body,
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'hh-user-agent': userAgent,
        'user-agent': userAgent,
      },
      retries: 0,
      ...(fetchImpl ? { fetchImpl } : {}),
    });
  } catch (error) {
    throw new HhOAuthError({ type: 'oauth_transport_failure', cause: error });
  }

  const payload = await readJsonObject(response);
  if (!response.ok) {
    throw new HhOAuthError({
      status: response.status,
      type: safeErrorType(payload),
    });
  }

  const accessToken = toText(payload.access_token);
  if (!accessToken) {
    throw new HhOAuthError({ status: response.status, type: 'missing_access_token' });
  }
  const tokenType = toText(payload.token_type)?.toLowerCase() ?? 'bearer';
  if (tokenType !== 'bearer') {
    throw new HhOAuthError({ status: response.status, type: 'unsupported_token_type' });
  }

  const expiresIn = Number(payload.expires_in);
  // HH application tokens have unlimited lifetime when `expires_in` is absent.
  // Re-requesting one revokes the previous token and is rate-limited, so keep it
  // until HH explicitly rejects it with 401. Expiring token responses still use
  // their advertised TTL and the normal refresh skew.
  // Source: https://github.com/hhru/api/blob/master/docs/authorization_for_application.md
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? now + expiresIn * 1000
    : Number.POSITIVE_INFINITY;

  return {
    clientId,
    accessToken,
    expiresAt,
  };
}

async function readJsonObject(response) {
  try {
    const parsed = JSON.parse(await response.text());
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function safeErrorType(payload) {
  const candidate = toText(payload.error)
    ?? toText(payload.type)
    ?? toText(payload.errors?.[0]?.type)
    ?? 'oauth_error';
  return /^[a-z0-9_.-]{1,80}$/i.test(candidate) ? candidate : 'oauth_error';
}

function toText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
