import { classifyStrongIdentityKey } from './organization-resolution.mjs';

const PLATFORM_DOMAINS = new Set([
  'hh.ru', 'career.habr.com', 'habr.com', 'superjob.ru', 'superjob.com',
  'trudvsem.ru', 'linkedin.com', 'avito.ru', 'rabota.ru', 'zarplata.ru',
  'getmatch.ru', 'geekjob.ru', 'greenhouse.io', 'lever.co', 'workday.com',
  'myworkdayjobs.com', 'ashbyhq.com', 'jobvite.com', 'smartrecruiters.com',
  'bamboohr.com', 'workable.com', 'recruitee.com', 'breezy.hr',
  'teamtailor.com', 'personio.com', 'jazz.co', 'jobs.eu',
]);

/**
 * Audit the materialized organization identity graph from org_source_refs.
 * This is a precision gate, not an entity-merging heuristic: ambiguous strong
 * identities are reported and must remain unresolved rather than auto-merged.
 */
export function auditOrganizationIdentityGraph(rows = [], organizations = []) {
  const ownersByStrongKey = new Map();
  const invalidStrongRefs = [];
  const platformDomainRefs = [];

  for (const row of rows) {
    const sourceKey = nonEmptyText(row?.source_key ?? row?.sourceKey);
    const orgId = nonEmptyText(String(row?.org_id ?? row?.orgId ?? ''));
    if (!sourceKey || !orgId) continue;

    if (/^(?:inn|ogrn|domain):/i.test(sourceKey)) {
      const classified = classifyStrongIdentityKey(sourceKey.toLowerCase());
      if (!classified) {
        invalidStrongRefs.push({ orgId, sourceKey, source: nonEmptyText(row?.source) });
        continue;
      }
      if (classified.type === 'domain') {
        const domain = classified.key.slice('domain:'.length);
        if (isPlatformDomain(domain)) {
          platformDomainRefs.push({ orgId, sourceKey: classified.key, source: nonEmptyText(row?.source) });
          continue;
        }
      }
      const owners = ownersByStrongKey.get(classified.key) ?? new Set();
      owners.add(orgId);
      ownersByStrongKey.set(classified.key, owners);
    }
  }

  const strongIdentityConflicts = [...ownersByStrongKey.entries()]
    .filter(([, owners]) => owners.size > 1)
    .map(([strongKey, owners]) => ({ strongKey, orgIds: [...owners].sort(compareIds) }))
    .sort((left, right) => left.strongKey.localeCompare(right.strongKey));

  const orgDomainMismatches = auditOrgDomains(organizations, rows);
  const strongIdentityLinks = [...ownersByStrongKey.values()].reduce((sum, owners) => sum + owners.size, 0);

  return Object.freeze({
    rowsAudited: rows.length,
    organizationsAudited: organizations.length,
    strongIdentityKeys: ownersByStrongKey.size,
    strongIdentityLinks,
    strongIdentityConflicts: Object.freeze(strongIdentityConflicts),
    invalidStrongRefs: Object.freeze(invalidStrongRefs),
    platformDomainRefs: Object.freeze(platformDomainRefs),
    orgDomainMismatches: Object.freeze(orgDomainMismatches),
    pass: strongIdentityConflicts.length === 0
      && invalidStrongRefs.length === 0
      && platformDomainRefs.length === 0
      && orgDomainMismatches.length === 0,
  });
}

function auditOrgDomains(organizations, rows) {
  const domainKeysByOrg = new Map();
  for (const row of rows) {
    const sourceKey = nonEmptyText(row?.source_key ?? row?.sourceKey)?.toLowerCase();
    const orgId = nonEmptyText(String(row?.org_id ?? row?.orgId ?? ''));
    const classified = sourceKey ? classifyStrongIdentityKey(sourceKey) : null;
    if (!orgId || classified?.type !== 'domain') continue;
    const set = domainKeysByOrg.get(orgId) ?? new Set();
    set.add(classified.key.slice('domain:'.length));
    domainKeysByOrg.set(orgId, set);
  }

  const mismatches = [];
  for (const organization of organizations) {
    const orgId = nonEmptyText(String(organization?.id ?? ''));
    const domain = normalizeDomain(organization?.domain);
    if (!orgId || !domain) continue;
    const strongDomains = domainKeysByOrg.get(orgId);
    if (!strongDomains || strongDomains.size === 0) continue;
    if (!strongDomains.has(domain)) {
      mismatches.push({ orgId, orgDomain: domain, strongDomains: [...strongDomains].sort() });
    }
  }
  return mismatches.sort((left, right) => compareIds(left.orgId, right.orgId));
}

function isPlatformDomain(domain) {
  return PLATFORM_DOMAINS.has(domain) || [...PLATFORM_DOMAINS].some((item) => domain.endsWith(`.${item}`));
}

function normalizeDomain(value) {
  const text = nonEmptyText(value)?.toLowerCase();
  if (!text) return null;
  return text.replace(/^www\./, '').replace(/\.$/, '');
}

function nonEmptyText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

function compareIds(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isSafeInteger(leftNumber) && Number.isSafeInteger(rightNumber)) return leftNumber - rightNumber;
  return String(left).localeCompare(String(right));
}
