import { assertOrgSourceRefOwner } from './organization-resolution.mjs';

const MAX_DISCOVERED_LINKS = 20;
const GITHUB_RESERVED_PATHS = new Set([
  'about', 'apps', 'collections', 'enterprise', 'events', 'explore', 'features',
  'login', 'marketplace', 'new', 'orgs', 'pricing', 'search', 'security',
  'settings', 'signup', 'site', 'sponsors', 'topics', 'trending',
]);

export function extractCompanyOwnedSourceLinks(hrefs, ownershipProofUrl) {
  const proof = normalizeHttpsUrl(ownershipProofUrl);
  if (!proof || !Array.isArray(hrefs)) return [];

  const links = [];
  const seen = new Set();
  for (const href of hrefs) {
    const candidate = classifyProviderLink(href, proof);
    if (!candidate) continue;
    const key = `${candidate.sourceId}:${candidate.sourceKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ ...candidate, ownershipProofUrl: proof });
    if (links.length >= MAX_DISCOVERED_LINKS) break;
  }
  return links;
}

export async function persistCompanyOwnedSourceLinks(client, {
  orgId,
  companyName,
  companyDomain,
  companyWebsiteUrl,
  links,
  observedAt = new Date().toISOString(),
}) {
  if (!Number.isInteger(Number(orgId)) || Number(orgId) <= 0 || !Array.isArray(links)) return 0;
  let persisted = 0;

  for (const link of links.slice(0, MAX_DISCOVERED_LINKS)) {
    if (!isDiscoveredLink(link)) continue;
    const normalizedLink = extractCompanyOwnedSourceLinks(
      [link.providerUrl],
      link.ownershipProofUrl,
    )[0];
    if (!normalizedLink
      || normalizedLink.sourceId !== link.sourceId
      || normalizedLink.sourceKey !== link.sourceKey
      || normalizedLink.externalId !== link.externalId) continue;
    const metadata = {
      discovery_state: 'company-owned-link',
      provider_url: normalizedLink.providerUrl,
      ownership_proof_url: normalizedLink.ownershipProofUrl,
      company_domain: companyDomain ?? null,
      company_website_url: companyWebsiteUrl ?? null,
      first_discovered_at: observedAt,
      last_seen_at: observedAt,
    };
    const result = await client.query(`
      INSERT INTO org_source_refs (
        org_id, source, source_key, external_id, display_name, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6::JSONB)
      ON CONFLICT (source, source_key) DO UPDATE SET
        external_id = COALESCE(org_source_refs.external_id, EXCLUDED.external_id),
        display_name = COALESCE(org_source_refs.display_name, EXCLUDED.display_name),
        metadata = COALESCE(org_source_refs.metadata, '{}'::JSONB) || EXCLUDED.metadata || JSONB_BUILD_OBJECT(
          'first_discovered_at',
          COALESCE(
            org_source_refs.metadata->'first_discovered_at',
            EXCLUDED.metadata->'first_discovered_at'
          )
        )
      WHERE org_source_refs.org_id = EXCLUDED.org_id
    `, [
      Number(orgId),
      normalizedLink.sourceId,
      normalizedLink.sourceKey,
      normalizedLink.externalId,
      cleanText(companyName),
      JSON.stringify(metadata),
    ]);
    await assertOrgSourceRefOwner(client, normalizedLink.sourceId, normalizedLink.sourceKey, orgId);
    persisted += Number(result.rowCount ?? 0);
  }

  return persisted;
}

function classifyProviderLink(rawHref, proofUrl) {
  let url;
  try {
    url = new URL(cleanText(rawHref), proofUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  url.hash = '';
  url.search = '';
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'github.com' && parts.length === 1) {
    const login = parts[0];
    if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(login)) return null;
    if (GITHUB_RESERVED_PATHS.has(login.toLowerCase())) return null;
    return {
      sourceId: 'github-company-org',
      sourceKey: `organization:${login.toLowerCase()}`,
      externalId: login,
      providerUrl: `https://github.com/${login}`,
    };
  }

  if (host === 'youtube.com' && parts.length === 2 && parts[0].toLowerCase() === 'channel') {
    const channelId = parts[1];
    if (!/^UC[A-Za-z0-9_-]{6,}$/.test(channelId)) return null;
    return {
      sourceId: 'youtube-company-channels',
      sourceKey: `channel:${channelId}`,
      externalId: channelId,
      providerUrl: `https://youtube.com/channel/${channelId}`,
    };
  }

  if (host === 'youtube.com' && parts.length === 1 && parts[0].startsWith('@')) {
    const handle = parts[0].slice(1);
    if (!/^[A-Za-z0-9_.-]{3,30}$/.test(handle)) return null;
    return {
      sourceId: 'youtube-company-channels',
      sourceKey: `handle:${handle.toLowerCase()}`,
      externalId: `@${handle}`,
      providerUrl: `https://youtube.com/@${handle}`,
    };
  }

  if (host === 't.me' && parts.length === 1) {
    const username = parts[0];
    if (!/^[a-z][a-z0-9_]{4,31}$/i.test(username)) return null;
    if (['addlist', 'contact', 'iv', 'joinchat', 'proxy', 'share', 'socks'].includes(username.toLowerCase())) return null;
    return {
      sourceId: 'telegram-company-channels',
      sourceKey: `channel:${username.toLowerCase()}`,
      externalId: username,
      providerUrl: `https://t.me/${username}`,
    };
  }

  return null;
}

function isDiscoveredLink(value) {
  return value
    && ['github-company-org', 'youtube-company-channels', 'telegram-company-channels'].includes(value.sourceId)
    && cleanText(value.sourceKey)
    && cleanText(value.externalId)
    && normalizeHttpsUrl(value.providerUrl)
    && normalizeHttpsUrl(value.ownershipProofUrl);
}

function normalizeHttpsUrl(value) {
  try {
    const url = new URL(cleanText(value));
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function cleanText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
