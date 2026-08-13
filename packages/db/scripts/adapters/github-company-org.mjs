const API_ROOT = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const DEFAULT_LOOKBACK_DAYS = 30;
const MAX_TARGETS = 50;

export async function fetchGitHubCompanyOrganizations(targets, options = {}) {
  if (!Array.isArray(targets)) throw new TypeError('GitHub company organization targets must be an array.');
  if (targets.length > MAX_TARGETS) throw new Error(`GitHub company organization targets exceed the ${MAX_TARGETS} target limit.`);

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const token = options.token?.trim() || null;
  const now = toDate(options.now) ?? new Date();
  const lookbackDays = positiveInteger(options.lookbackDays, DEFAULT_LOOKBACK_DAYS);
  const cutoff = now.getTime() - lookbackDays * 86_400_000;
  const cache = options.cache ?? {};
  const records = [];
  const diagnostics = [];
  const cacheUpdates = [];

  for (const rawTarget of targets) {
    const target = normalizeTarget(rawTarget);
    if (!target) {
      diagnostics.push({ organizationLogin: null, ownershipVerified: false, error: 'invalid-target' });
      continue;
    }

    try {
      const organization = await fetchJson(`${API_ROOT}/orgs/${encodeURIComponent(target.organizationLogin)}`, {
        fetchImpl, token,
      });
      const ownershipVerified = isVerifiedOwner(organization.value, target);
      if (!ownershipVerified) {
        diagnostics.push({ organizationLogin: target.organizationLogin, ownershipVerified: false, error: 'ownership-not-proven' });
        continue;
      }

      const cachedEtag = cache[target.organizationLogin]?.etag;
      const repositories = await fetchJson(
        `${API_ROOT}/orgs/${encodeURIComponent(target.organizationLogin)}/repos?type=public&sort=pushed&direction=desc&per_page=100`,
        { fetchImpl, token, etag: cachedEtag },
      );
      if (repositories.notModified) {
        diagnostics.push({ organizationLogin: target.organizationLogin, ownershipVerified: true, notModified: true, records: 0 });
        continue;
      }
      if (!Array.isArray(repositories.value)) throw new Error('repository response is not an array');

      const targetRecords = repositories.value
        .filter((repo) => isOwnedPublicRepository(repo, target.organizationLogin))
        .map((repo) => toContextRecord(repo, target, cutoff))
        .filter(Boolean);
      records.push(...targetRecords);
      if (repositories.etag) cacheUpdates.push({ organizationLogin: target.organizationLogin, etag: repositories.etag });
      diagnostics.push({ organizationLogin: target.organizationLogin, ownershipVerified: true, notModified: false, records: targetRecords.length });
    } catch (error) {
      diagnostics.push({ organizationLogin: target.organizationLogin, ownershipVerified: false, error: safeError(error) });
    }
  }

  return { records, diagnostics, cacheUpdates };
}

async function fetchJson(url, { fetchImpl, token, etag }) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
    'User-Agent': 'recruiter-radar-company-context',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (etag) headers['If-None-Match'] = etag;
  const response = await fetchImpl(url, { headers, redirect: 'error' });
  if (response.status === 304) return { notModified: true, value: null, etag };
  if (!response.ok) throw new Error(`GitHub REST returned HTTP ${response.status}`);
  return { notModified: false, value: await response.json(), etag: response.headers.get('etag') };
}

function normalizeTarget(target) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) return null;
  const organizationLogin = cleanText(target.organization_login ?? target.organizationLogin);
  const companyName = cleanText(target.company_name ?? target.companyName);
  const companyDomain = normalizeDomain(target.company_domain ?? target.companyDomain);
  const companyWebsiteUrl = normalizeHttpUrl(target.company_website_url ?? target.companyWebsiteUrl);
  if (!organizationLogin || !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(organizationLogin)) return null;
  if (!companyName || !companyDomain || !companyWebsiteUrl || hostname(companyWebsiteUrl) !== companyDomain) return null;
  return { organizationLogin, companyName, companyDomain, companyWebsiteUrl };
}

function isVerifiedOwner(org, target) {
  if (!org || org.type !== 'Organization' || org.is_verified !== true) return false;
  if (String(org.login).toLowerCase() !== target.organizationLogin.toLowerCase()) return false;
  return hostname(normalizeHttpUrl(org.blog)) === target.companyDomain;
}

function isOwnedPublicRepository(repo, login) {
  return repo && repo.fork !== true && repo.private !== true
    && repo.owner?.type === 'Organization'
    && String(repo.owner?.login).toLowerCase() === login.toLowerCase()
    && normalizeHttpUrl(repo.html_url)?.startsWith(`https://github.com/${login}/`);
}

function toContextRecord(repo, target, cutoff) {
  const createdAt = toDate(repo.created_at);
  const pushedAt = toDate(repo.pushed_at);
  const isNew = createdAt && createdAt.getTime() >= cutoff;
  const isActive = pushedAt && pushedAt.getTime() >= cutoff;
  if (!isNew && !isActive) return null;
  const eventType = isNew ? 'new_project' : 'technology_activity';
  const occurredAt = isNew ? createdAt : pushedAt;
  const suffix = isNew ? 'new-repository' : 'repository-activity';
  const action = isNew ? 'opened public repository' : 'updated public repository';
  return {
    external_id: `github-repository:${repo.id}:${suffix}`,
    company_name: target.companyName,
    company_domain: target.companyDomain,
    company_website_url: target.companyWebsiteUrl,
    source_url: normalizeHttpUrl(repo.html_url),
    headline: `${target.companyName} ${action} ${cleanText(repo.name)}`,
    summary: cleanText(repo.description),
    event_type: eventType,
    published_at: occurredAt.toISOString(),
    extraction_method: 'github-rest-org-repositories',
    publisher: `GitHub verified organization ${target.organizationLogin}`,
    category: 'company-technology-context',
  };
}

function normalizeDomain(value) {
  const text = cleanText(value)?.toLowerCase().replace(/^www\./, '');
  if (!text || text.includes('/') || text.includes(':') || !text.includes('.')) return null;
  return text;
}

function normalizeHttpUrl(value) {
  try {
    const url = new URL(cleanText(value));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
}

function hostname(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}

function cleanText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toDate(value) {
  const date = value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function safeError(error) {
  return error instanceof Error ? error.message.slice(0, 300) : 'unknown-error';
}
