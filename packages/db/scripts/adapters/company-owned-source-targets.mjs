const SUPPORTED_SOURCES = new Set([
  'github-company-org',
  'youtube-company-channels',
  'telegram-company-channels',
]);

export async function loadCompanyOwnedSourceTargets(client, sourceId, { limit = 50 } = {}) {
  if (!SUPPORTED_SOURCES.has(sourceId)) {
    throw new Error(`Unsupported company-owned source: ${sourceId}`);
  }
  const boundedLimit = Math.min(50, Math.max(1, Number.parseInt(limit, 10) || 50));
  const result = await client.query(`
    SELECT
      ref.source,
      ref.source_key,
      ref.external_id,
      ref.metadata,
      org.name AS company_name,
      org.domain AS company_domain,
      org.website_url AS company_website_url
    FROM org_source_refs ref
    JOIN orgs org ON ref.org_id = org.id
    WHERE ref.source = $1
      AND ref.metadata->>'discovery_state' = 'company-owned-link'
    ORDER BY ref.metadata->>'last_seen_at' DESC NULLS LAST, ref.id ASC
    LIMIT $2
  `, [sourceId, boundedLimit]);

  return result.rows
    .map((row) => mapTarget(sourceId, row))
    .filter(Boolean);
}

export async function loadCompanyOwnedSourceTargetsFromDatabase(
  connectionString,
  sourceId,
  { ClientClass = Client, limit = 50 } = {},
) {
  if (!text(connectionString)) throw new Error('DATABASE_URL is required for company-owned source enrollment.');
  const client = new ClientClass({ connectionString });
  await client.connect();
  try {
    return await loadCompanyOwnedSourceTargets(client, sourceId, { limit });
  } finally {
    await client.end();
  }
}

function mapTarget(sourceId, row) {
  const companyName = text(row.company_name);
  const companyDomain = domain(row.company_domain);
  const companyWebsiteUrl = httpsUrl(row.company_website_url);
  const metadata = jsonObject(row.metadata);
  const ownershipProofUrl = httpsUrl(metadata.ownership_proof_url);
  if (!companyName || !companyDomain || !companyWebsiteUrl) return null;
  if (hostname(companyWebsiteUrl) !== companyDomain) return null;

  if (sourceId === 'github-company-org') {
    const organizationLogin = text(row.external_id);
    if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(organizationLogin ?? '')) return null;
    return {
      organization_login: organizationLogin,
      company_name: companyName,
      company_domain: companyDomain,
      company_website_url: companyWebsiteUrl,
    };
  }

  if (!ownershipProofUrl || hostname(ownershipProofUrl) !== companyDomain) return null;
  if (sourceId === 'youtube-company-channels') {
    const externalId = text(row.external_id);
    const base = {
      company_name: companyName,
      company_domain: companyDomain,
      company_website_url: companyWebsiteUrl,
      ownership_proof_url: ownershipProofUrl,
    };
    if (/^UC[A-Za-z0-9_-]{6,}$/.test(externalId ?? '')) {
      return { channel_id: externalId, ...base };
    }
    if (/^@[A-Za-z0-9_.-]{3,30}$/.test(externalId ?? '')) {
      return { channel_handle: externalId, ...base };
    }
    return null;
  }

  const username = text(row.external_id)?.replace(/^@/, '');
  if (!/^[a-z][a-z0-9_]{4,31}$/i.test(username ?? '')) return null;
  return {
    channel_username: username,
    company_name: companyName,
    company_domain: companyDomain,
    company_website_url: companyWebsiteUrl,
    ownership_proof_url: ownershipProofUrl,
  };
}

function jsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function domain(value) {
  const normalized = text(value)?.toLowerCase().replace(/^www\./, '');
  return normalized && normalized.includes('.') && !/[/:]/.test(normalized) ? normalized : null;
}

function httpsUrl(value) {
  try {
    const url = new URL(text(value));
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function hostname(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}
import pg from 'pg';

const { Client } = pg;
