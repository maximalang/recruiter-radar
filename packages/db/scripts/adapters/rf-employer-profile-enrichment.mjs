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
const LEGAL_TEXT_SCOPE_RADIUS = 220;

export async function fetchRfEmployerProfile(family, profileUrl, {
  fetchTextImpl = fetchText,
  signal,
  stageOrder = family?.transportStages,
  renderPool,
  fetchExtractionMarkdownImpl,
  rendered = true,
  expectedEmployerName = null,
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
      const profile = extractEmployerIdentityFromHtml(
        html,
        pageUrl,
        family,
        { expectedEmployerName },
      );
      return profile ? [profile] : [];
    },
    parseMarkdown: (markdown, pageUrl) => {
      const profile = extractEmployerIdentityFromMarkdown(
        markdown,
        pageUrl,
        family,
        { expectedEmployerName },
      );
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

export function extractEmployerIdentityFromHtml(
  html,
  pageUrl,
  family,
  { expectedEmployerName = null } = {},
) {
  const text = stripHtmlToText(html);
  const expectedName = nonEmptyText(expectedEmployerName);
  const documents = extractEmbeddedJsonDocuments(html, { maxDocuments: 50 });
  const organizations = documents
    .flatMap(flattenJsonLdNodes)
    .filter(isOrganizationNode)
    .filter((organization) => organizationMatchesExpectedEmployer(organization, expectedName));
  const strongIdentityKeys = new Set();
  const websiteCandidates = [];
  let employerName = expectedName;

  for (const organization of organizations) {
    employerName ??= nonEmptyText(organization.legalName ?? organization.name);
    for (const identity of extractOrganizationIdentifiers(organization)) strongIdentityKeys.add(identity);
    websiteCandidates.push(...normalizeUrlCandidates(organization.url), ...normalizeUrlCandidates(organization.sameAs));
  }

  // Critical precision boundary: do not scan the entire job-board page for legal
  // identifiers when the target employer is known. Board/operator footer INN or
  // OGRN would otherwise be indistinguishable from employer identifiers. Only a
  // tight text window around the expected employer name is eligible. Direct
  // extractor calls without an expected name retain legacy broad parsing for
  // tests/manual analysis, while production fetch always supplies the detail-page
  // employer name.
  const legalText = expectedName
    ? extractEmployerScopedText(text, expectedName, LEGAL_TEXT_SCOPE_RADIUS)
    : text;
  for (const identity of extractTextIdentifiers(legalText)) strongIdentityKeys.add(identity);
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

export function extractEmployerIdentityFromMarkdown(
  markdown,
  pageUrl,
  family,
  { expectedEmployerName = null } = {},
) {
  const text = String(markdown ?? '');
  const expectedName = nonEmptyText(expectedEmployerName);
  const legalText = expectedName
    ? extractEmployerScopedText(stripMarkdownLinks(text), expectedName, LEGAL_TEXT_SCOPE_RADIUS)
    : text;
  const strongIdentityKeys = new Set(extractTextIdentifiers(legalText));
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
    employerName: expectedName,
    employerWebsiteUrl,
    strongIdentityKeys: Object.freeze(keys),
    profileUrl: canonicalizePublicUrl(pageUrl),
    extractionMethod: 'employer-profile-markdown',
  });
}

function organizationMatchesExpectedEmployer(organization, expectedEmployerName) {
  if (!expectedEmployerName) return true;
  const names = [organization?.legalName, organization?.name]
    .map(nonEmptyText)
    .filter(Boolean);
  return names.some((name) => organizationNameMatches(name, expectedEmployerName));
}

function organizationNameMatches(left, right) {
  const leftTokens = normalizeOrganizationName(left);
  const rightTokens = normalizeOrganizationName(right);
  if (!leftTokens.length || !rightTokens.length) return false;
  const leftJoined = leftTokens.join(' ');
  const rightJoined = rightTokens.join(' ');
  if (leftJoined === rightJoined) return true;
  if (leftJoined.includes(rightJoined) || rightJoined.includes(leftJoined)) return true;
  return leftTokens.some((leftToken) => rightTokens.some((rightToken) => (
    leftToken.length >= 4
    && rightToken.length >= 4
    && (leftToken.startsWith(rightToken) || rightToken.startsWith(leftToken))
  )));
}

function normalizeOrganizationName(value) {
  const LEGAL_FORMS = new Set([
    'ооо', 'оао', 'пао', 'ао', 'зао', 'ип', 'нко', 'фгуп', 'муп',
    'llc', 'ltd', 'inc', 'corp', 'corporation', 'company', 'co',
  ]);
  return String(value ?? '')
    .toLowerCase()
    .replace(/[«»"'`]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && !LEGAL_FORMS.has(token));
}

function extractEmployerScopedText(text, expectedEmployerName, radius) {
  const source = String(text ?? '');
  const expected = String(expectedEmployerName ?? '').trim();
  if (!source || !expected) return '';
  const lowerSource = source.toLowerCase();
  const normalizedVariants = [
    expected.toLowerCase(),
    normalizeOrganizationName(expected).join(' '),
  ].filter((value, index, values) => value && values.indexOf(value) === index);
  const windows = [];
  for (const variant of normalizedVariants) {
    let from = 0;
    while (from < lowerSource.length) {
      const index = lowerSource.indexOf(variant, from);
      if (index < 0) break;
      windows.push(source.slice(Math.max(0, index - radius), Math.min(source.length, index + variant.length + radius)));
      from = index + Math.max(1, variant.length);
      if (windows.length >= 12) break;
    }
    if (windows.length >= 12) break;
  }
  return windows.join(' ');
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

function stripMarkdownLinks(value) {
  return String(value ?? '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
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
