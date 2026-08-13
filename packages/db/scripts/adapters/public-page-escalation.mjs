import { fetchText } from './source-http.mjs';
import { runSourceEscalation } from './source-escalation.mjs';
import { fetchExtractionMarkdown } from './source-extraction-fallback.mjs';
import { createPlaywrightBrowserPool } from './playwright-browser-pool.mjs';
import {
  canonicalizePublicUrl,
  isRobotsPathAllowed,
  resolvePublicRobotsPolicy,
} from './site-discovery.mjs';

let publicPageRenderPool = null;
const accessPolicyCache = new Map();

/** Canonical guarded escalation for company-owned public HTML surfaces. */
export async function fetchPublicPageWithEscalation({
  url,
  sourceName,
  parseHtml,
  parseMarkdown,
  validateRecord,
  officialFeed,
  signal,
  timeoutMs = 15_000,
  headers = {},
  dependencies = {},
}) {
  const publicUrl = canonicalizePublicUrl(url, { keepTracking: true });
  if (!publicUrl && !dependencies.allowPrivateForTests) {
    return blockedResult(url, 'invalid-public-url');
  }
  const resolvedUrl = publicUrl ?? url;
  const policy = dependencies.accessPolicy
    ?? await resolveAccessPolicy(resolvedUrl, dependencies);
  if (policy.blocked || !isRobotsPathAllowed(resolvedUrl, policy.robots)) {
    return blockedResult(
      resolvedUrl,
      policy.blocked ? `access-policy:${policy.reason}` : 'access-policy:robots-disallowed',
      policy,
    );
  }

  const fetchTextImpl = dependencies.fetchText ?? fetchText;
  let staticArtifact = null;
  const escalation = await runSourceEscalation({
    context: { url: resolvedUrl, sourceName },
    validateRecord,
    stages: {
      'official-feed': typeof officialFeed === 'function'
        ? async () => ({ records: await officialFeed() })
        : undefined,
      'static-http': async () => {
        const { response, body } = await fetchTextImpl(resolvedUrl, {
          sourceName,
          headers,
          signal,
          timeoutMs,
          redirect: 'follow',
        });
        const responseUrl = canonicalizePublicUrl(response.url || resolvedUrl, { keepTracking: true });
        if (publicUrl && (!responseUrl || !isSameCompanyHost(responseUrl, publicUrl))) {
          return { status: 'blocked', accessControl: true, reason: 'cross-company-redirect' };
        }
        if (looksLikeAccessChallenge(body)) {
          return { status: 'blocked', accessControl: true, reason: 'access-challenge-page' };
        }
        staticArtifact = { html: body, url: responseUrl ?? resolvedUrl };
        return { artifact: staticArtifact };
      },
      'structured-data': async ({ artifact }) => ({
        records: parseHtml?.(artifact?.html ?? staticArtifact?.html, artifact?.url ?? resolvedUrl) ?? [],
      }),
      'rendered-dom': dependencies.rendered === false ? undefined : async () => {
        const page = await (dependencies.renderPool ?? getPublicPageRenderPool()).fetchPage({
          url: resolvedUrl,
          timeoutMs: resolveRenderTimeout(timeoutMs),
          headers,
        });
        if ([401, 403, 451].includes(page.status)) {
          return { status: 'blocked', httpStatus: page.status, reason: `http-${page.status}` };
        }
        if (page.status === 429) {
          return { status: 'deferred', httpStatus: 429, reason: 'http-429' };
        }
        if (page.status < 200 || page.status >= 400) {
          return { status: 'error', httpStatus: page.status, reason: `http-${page.status}` };
        }
        if (looksLikeAccessChallenge(page.html)) {
          return { status: 'blocked', accessControl: true, reason: 'access-challenge-page' };
        }
        return {
          artifact: { html: page.html, url: page.url },
          records: parseHtml?.(page.html, page.url) ?? [],
        };
      },
      extraction: typeof parseMarkdown === 'function' ? async () => {
        const extracted = await (dependencies.fetchExtractionMarkdown ?? fetchExtractionMarkdown)(resolvedUrl);
        if (!extracted.available) {
          return { status: 'empty', reason: summarizeExtractionAttempts(extracted.attempts) };
        }
        return {
          artifact: { provider: extracted.provider, url: resolvedUrl },
          records: parseMarkdown(extracted.markdown, resolvedUrl, extracted.provider) ?? [],
        };
      } : undefined,
    },
  });

  return {
    ...escalation,
    url: resolvedUrl,
    robotsState: policy.robotsState,
    error: escalation.records.length > 0
      ? null
      : escalation.attempts.at(-1)?.reason ?? 'no-validated-records',
  };
}

export function looksLikeAccessChallenge(html) {
  const sample = typeof html === 'string' ? html.slice(0, 200_000) : '';
  return /(?:cf-chl-|cloudflare\s+ray\s+id|<title[^>]*>[^<]*(?:captcha|verify\s+(?:you\s+are\s+)?human|access\s+denied|attention\s+required)|id=["'](?:captcha|challenge)["'])/i.test(sample);
}

export async function closePublicPageRenderPool() {
  const pool = publicPageRenderPool;
  publicPageRenderPool = null;
  if (pool) await pool.close();
}

async function resolveAccessPolicy(url, dependencies) {
  if (dependencies.allowPrivateForTests) {
    return { blocked: false, reason: null, robotsState: 'test-only', robots: { rules: [] } };
  }
  const origin = new URL(url).origin;
  let pending = accessPolicyCache.get(origin);
  if (!pending) {
    pending = resolvePublicRobotsPolicy(origin);
    accessPolicyCache.set(origin, pending);
  }
  const discovery = await pending;
  return {
    blocked: discovery.blocked,
    reason: discovery.reason ?? discovery.errors?.[0] ?? null,
    robotsState: discovery.robotsState,
    robots: discovery.robots ?? { rules: [] },
  };
}

function getPublicPageRenderPool() {
  publicPageRenderPool ??= createPlaywrightBrowserPool();
  return publicPageRenderPool;
}

function blockedResult(url, reason, policy = {}) {
  return {
    url,
    records: [],
    selectedStage: null,
    artifact: null,
    stoppedByPolicy: true,
    robotsState: policy.robotsState ?? 'blocked',
    attempts: [{
      stage: 'static-http',
      outcome: 'blocked',
      httpStatus: null,
      records: 0,
      rejectedRecords: 0,
      reason,
    }],
    error: reason,
  };
}

function isSameCompanyHost(left, right) {
  const leftHost = new URL(left).hostname.toLowerCase().replace(/^www\./, '');
  const rightHost = new URL(right).hostname.toLowerCase().replace(/^www\./, '');
  return leftHost === rightHost
    || leftHost.endsWith(`.${rightHost}`)
    || rightHost.endsWith(`.${leftHost}`);
}

function resolveRenderTimeout(timeoutMs) {
  const configured = Number(process.env.PUBLIC_PAGE_RENDER_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured >= 1_000) {
    return Math.min(Math.floor(configured), 120_000);
  }
  return Math.max(1_000, Math.min(timeoutMs * 2, 60_000));
}

function summarizeExtractionAttempts(attempts) {
  if (!Array.isArray(attempts) || attempts.length === 0) return 'extraction-provider-not-configured';
  return attempts.map((attempt) => `${attempt.provider}:${attempt.outcome}`).join(',').slice(0, 240);
}
