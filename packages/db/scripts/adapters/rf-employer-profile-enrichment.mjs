import { classifyStrongIdentityKey } from './organization-resolution.mjs';
import { fetchText } from './source-http.mjs';
import { fetchPublicPageWithEscalation } from './public-page-escalation.mjs';
import {
  canonicalizePublicUrl,
  extractEmbeddedJsonDocuments,
  isRobotsPathAllowed,
  resolvePublicRobotsPolicy,
} from './site-discovery.mjs';

const EXCLUDED_EXTERNAL_DOMAINS = new Set([
  'vk.com', 'vk.ru', 't.me', 'telegram.me', 'youtube.com', 'youtu.be',
  'rutube.ru', 'dzen.ru', 'ok.ru', 'instagram.com', 'facebook.com',
]);

export async function fetchRfEmployerProfile(family, profileUrl, {
  fetchTextImpl = fetchText,
  signal,
  stageOrder = family?.transportStages,
  renderPool,
  fetchExtractionMarkdownImpl,
  rendered = true,
} = {}) {
  const url = canonicalizePublicUrl(profileUrl, { keepTracking: true });
  if (!url || !isAllowedPlatformOrigin(url, family?.platformDomains ?? [])) {
    return blocked('invalid-employer-profile-url');
  }

  const policy = await resolvePublicRobotsPolicy(url, {
    fetchTextImpl,
    signal,
    userAgent: 'RecruiterRadarSourceDiscovery',
  });
  if (policy.blocked) return blocked(policy.reason ?? 'robots-policy-blocked', policy.robotsState);
  if (!isRobotsPathAllowed(url, policy.robots)) return blocked('robots-disallow', policy.robotsState);

  const result = await fetchPublicPageWithEscalation({
    url,
    sourceName: `rf-employer-profile:${family.id}`,
    signal,
    timeoutMs: 10_000,
    stageOrder,
    parseHtml: (html, pageUrl) => {
      const profile = extractEmployerIdentityFromHtml(html, pageUrl, family);
      return profile ? [profile] : [];
    },
    parseMarkdown: (markdown, pageUrl) => {
      const profile = extractEmployerIdentityFromMarkdown(markdown, pageUrl, family);
      return profile ? [profile] : [];
    },
    validateRecord: (record) => Array.isArray(record?.strongIdentityKeys) && record.strongIdentityKeys.length > 0,
    dependencies: {
      fetchText: fetchTextImpl,
      accessPolicy: policy,
      renderPool,
      fetchExtractionMarkdown: fetchExtractionMarkdownImpl,
      rendered,
    },
  });

  return Object.freeze({
    blocked: result.stoppedByPolicy === true,
    reason: result.error ?? null,
    robotsState: result.robotsState ?? policy.robotsState,
    selectedStage: result.selectedStage,
    finalUrl: result.url ?? url,
    attempts: Object.freeze((result.attempts ?? []).map((attempt) => Object.freeze({ ...attempt }))),
    profile: result.records[0] ?? null,
  });
}

export function extractEmployerIdentityFromHtml(html, pageUrl, family) {
  const text = stripHtmlToText(html);
  const documents = extractEmbeddedJsonDocuments(html, { maxDocuments: 50 });
  const organizations = documents.flatMap(flattenJsonLdNodes).filter(isOrganizationNode);
  const strongIdentityKeys = new Set();
  const websiteCandidates = [];
  let employerName = null;

  for (const organization of organizations) {
    employerName ??= nonEmptyText(organization.legalName ?? organization.name);
    for (const identity of extractOrganizationIdentifiers(organization)) strongIdentityKeys.add(identity);
    websiteCandidates.push(...normalizeUrlCandidates(organization.url), ...normalizeUrlCandidates(organization.sameAs));
  }

  for (const identity of extractTextIdentifiers(text)) strongIdentityKeys.add(identity);
  websiteCandidates.push(...extractLabelledWebsiteLinks(html));

  const employerWebsiteUrl = chooseEmployerWebsite(websiteCandidates, family?.platformDomains ?? []);
  if (employerWebsiteUrl) {
    const domainKey = classifyStrongIdentityKey(`domain:${new URL(employerWebsiteUrl).hostname.toLowerCase().replace(/^www\./, '')}`);
    if (domainKey) strongIdentityKeys.add(domainKey.key);
  }

  const keys = [...strongIdentityKeys].sort();
  if (keys.length === 0) return null;
  return Object.freeze({
    employerName,
    employerWebsiteUrl,
    strongIdentityKeys: Object.freeze(keys),
    profileUrl: canonicalizePublicUrl(pageUrl),
    extractionMethod: 'employer-profile-html',
  });
}

export function extractEmployerIdentityFromMarkdown(markdown, pageUrl, family) {
  const text = String(markdown ?? '');
  const strongIdentityKeys = new Set(extractTextIdentifiers(text));
  const labelledLinks = [];
  for (const match of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g)) {
    if (/(?:сайт(?:\s+компании|\s+работодателя)?|официальный\s+сайт|website)/i.test(match[1])) {
      labelledLinks.push(match[2]);
    }
  }
  const employerWebsiteUrl = chooseEmployerWebsite(labelledLinks, family?.platformDomains ?? []);
  if (employerWebsiteUrl) {
    const domainKey = classifyStrongIdentityKey(`domain:${new URL(employerWebsiteUrl).hostname.toLowerCase().replace(/^www\./, '')}`);
    if (domainKey) strongIdentityKeys.add(domainKey.key);
  }
  const keys = [...strongIdentityKeys].sort();
  if (keys.length === 0) return null;
  return Object.freeze({
    employerName: null,
    employerWebsiteUrl,
    strongIdentityKeys: Object.freeze(keys),
    profileUrl: canonicalizePublicUrl(pageUrl),
    extractionMethod: 'employer-profile-markdown',
  });
}

function extractOrganizationIdentifiers(organization) {
  const keys = new Set();
  const taxId = digitsOnly(organization?.taxID);
  if (taxId) addClassified(keys, `inn:${taxId}`);

  const identifiers = Array.isArray(organization?.identifier)
    ? organization.identifier
    : organization?.identifier !== undefined
      ? [organization.identifier]
      : [];
  for (const identifier of identifiers) {
    if (typeof identifier === 'string' || typeof identifier === 'number') continue;
    const label = nonEmptyText(identifier?.propertyID ?? identifier?.name)?.toLowerCase() ?? '';
    const value = digitsOnly(identifier?.value);
    if (!value) continue;
    if (/инн|inn/.test(label)) addClassified(keys, `inn:${value}`);
    if (/огрн|ogrn/.test(label)) addClassified(keys, `ogrn:${value}`);
  }
  return [...keys];
}

function extractTextIdentifiers(text) {
  const keys = new Set();
  for (const match of String(text ?? '').matchAll(/\b(?:ИНН|INN)\s*[:№#-]?\s*(\d{10})\b/gi)) {
    addClassified(keys, `inn:${match[1]}`);
  }
  for (const match of String(text ?? '').matchAll(/\b(?:ОГРН|OGRN)\s*[:№#-]?\s*(\d{13})\b/gi)) {
    addClassified(keys, `ogrn:${match[1]}`);
  }
  return [...keys];
}

function extractLabelledWebsiteLinks(html) {
  const links = [];
  for (const match of String(html ?? '').matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = stripHtmlToText(match[2]);
    if (/(?:сайт(?:\s+компании|\s+работодателя)?|официальный\s+сайт|website)/i.test(label)) {
      links.push(decodeHtmlAttribute(match[1]));
    }
  }
  return links;
}

function chooseEmployerWebsite(candidates, platformDomains) {
  for (const raw of candidates) {
    const url = canonicalizePublicUrl(raw, { keepTracking: false });
    if (!url) continue;
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if ((platformDomains ?? []).some((domain) => host === domain || host.endsWith(`.${domain}`))) continue;
    if (EXCLUDED_EXTERNAL_DOMAINS.has(host) || [...EXCLUDED_EXTERNAL_DOMAINS].some((domain) => host.endsWith(`.${domain}`))) continue;
    if (!classifyStrongIdentityKey(`domain:${host}`)) continue;
    return url;
  }
  return null;
}

function normalizeUrlCandidates(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string');
  return typeof value === 'string' ? [value] : [];
}

function flattenJsonLdNodes(document) {
  if (Array.isArray(document)) return document.flatMap(flattenJsonLdNodes);
  if (!document || typeof document !== 'object') return [];
  const graph = Array.isArray(document['@graph']) ? document['@graph'].flatMap(flattenJsonLdNodes) : [];
  return [document, ...graph];
}

function isOrganizationNode(node) {
  const types = Array.isArray(node?.['@type']) ? node['@type'] : [node?.['@type']];
  return types.some((type) => /^(?:organization|corporation|localbusiness)$/i.test(String(type ?? '')));
}

function stripHtmlToText(html) {
  return String(html ?? '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function addClassified(target, rawKey) {
  const identity = classifyStrongIdentityKey(rawKey);
  if (identity) target.add(identity.key);
}

function digitsOnly(value) {
  const text = nonEmptyText(typeof value === 'number' ? String(value) : value);
  return text ? text.replace(/\D/g, '') : null;
}

function isAllowedPlatformOrigin(url, platformDomains) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return platformDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function decodeHtmlAttribute(value) {
  return String(value)
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function bounded(reason) {
  const text = nonEmptyText(reason);
  return text ? text.slice(0, 240) : null;
}

function nonEmptyText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

function blocked(reason, robotsState = 'blocked') {
  return Object.freeze({
    blocked: true,
    reason: bounded(reason),
    robotsState,
    selectedStage: null,
    finalUrl: null,
    attempts: Object.freeze([{ stage: 'static-http', outcome: 'blocked', reason: bounded(reason) }]),
    profile: null,
  });
}
