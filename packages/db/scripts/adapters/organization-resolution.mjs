import { isIP } from 'node:net';

const PLATFORM_DOMAINS = new Set([
  'hh.ru',
  'hhcdn.com',
  'hh.kz',
  'hh.ua',
  'career.habr.com',
  'habr.com',
  'superjob.ru',
  'superjob.com',
  'trudvsem.ru',
  'linkedin.com',
  'rabota.ru',
  'zarplata.ru',
  'greenhouse.io',
  'lever.co',
  'workday.com',
  'myworkdayjobs.com',
  'ashbyhq.com',
  'jobvite.com',
  'smartrecruiters.com',
  'bamboohr.com',
  'workable.com',
  'recruitee.com',
  'breezy.hr',
  'teamtailor.com',
  'personio.com',
  'jazz.co',
  'jobs.eu',
]);

const PUBLIC_SUFFIX_DOMAINS = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk',
  'com.au', 'net.au', 'org.au',
  'co.jp', 'co.kr', 'com.cn', 'com.br', 'com.tr',
]);

const CORPORATE_SUBDOMAIN_PREFIXES = new Set(['www', 'career', 'careers', 'job', 'jobs', 'hr', 'vacancy', 'vacancies']);

export class OrganizationIdentityConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OrganizationIdentityConflictError';
    this.code = 'organization_identity_conflict';
  }
}

export function isOrganizationIdentityConflict(error) {
  return error instanceof OrganizationIdentityConflictError
    || error?.code === 'organization_identity_conflict';
}

export function classifyStrongIdentityKey(value) {
  if (typeof value !== 'string') return null;

  if (value.startsWith('inn:')) {
    const inn = value.slice(4);
    return isValidInn10(inn) ? { key: `inn:${inn}`, type: 'inn' } : null;
  }

  if (value.startsWith('ogrn:')) {
    const ogrn = value.slice(5);
    return isValidOgrn13(ogrn) ? { key: `ogrn:${ogrn}`, type: 'ogrn' } : null;
  }

  if (value.startsWith('domain:')) {
    const domain = canonicalCompanyDomain(value.slice(7));
    return domain ? { key: `domain:${domain}`, type: 'domain' } : null;
  }

  return null;
}

export async function resolveOrganizationOwner(client, sourceId, record) {
  const strongIdentities = dedupeStrongIdentities(record.orgSourceKeys ?? []);
  const strongKeys = strongIdentities.map((identity) => identity.key);

  for (const key of [...strongKeys].sort()) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('source-identity-v1'), hashtext($1::text))",
      [key],
    );
  }

  for (const key of [...(record.orgSourceKeys ?? [])].sort()) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))', [sourceId, key]);
  }

  const owners = new Map();
  if (strongKeys.length > 0) {
    const refs = await client.query(
      `SELECT DISTINCT org_id, source_key
       FROM org_source_refs
       WHERE source_key = ANY($1::text[])
       ORDER BY org_id, source_key`,
      [strongKeys],
    );
    for (const row of refs.rows) owners.set(String(row.org_id), `strong-ref:${row.source_key}`);

    const domain = strongIdentities.find((identity) => identity.type === 'domain')?.key.slice(7);
    if (domain) {
      const domainOwners = await client.query(
        'SELECT id FROM orgs WHERE LOWER(domain) = $1::text ORDER BY id',
        [domain],
      );
      for (const row of domainOwners.rows) owners.set(String(row.id), `org-domain:${domain}`);
    }
  }

  if (owners.size > 1) {
    throw new OrganizationIdentityConflictError(
      `organization identity conflict for ${strongKeys.join(', ')}: owners ${[...owners.keys()].join(', ')}`,
    );
  }

  const strongOwnerId = owners.size === 1 ? [...owners.keys()][0] : null;
  const local = await client.query(
    `SELECT DISTINCT org_id
     FROM org_source_refs
     WHERE source = $1::text
       AND source_key = ANY($2::text[])
     ORDER BY org_id`,
    [sourceId, record.orgSourceKeys],
  );

  if (local.rows.length > 1) {
    throw new OrganizationIdentityConflictError(`source-local identity conflict for ${sourceId}: multiple organization owners`);
  }

  const localOwnerId = local.rows[0] ? String(local.rows[0].org_id) : null;
  if (strongOwnerId && localOwnerId && strongOwnerId !== localOwnerId) {
    throw new OrganizationIdentityConflictError(
      `organization identity conflict for ${sourceId}: strong owner ${strongOwnerId}, source-local owner ${localOwnerId}`,
    );
  }

  return {
    orgId: strongOwnerId ?? localOwnerId,
    resolutionReason: strongOwnerId
      ? 'validated-strong-key'
      : localOwnerId
        ? 'source-local-key'
        : 'new-organization',
    strongKeys,
  };
}

export async function assertOrgSourceRefOwner(client, sourceId, sourceKey, expectedOrgId) {
  const result = await client.query(
    `SELECT org_id
     FROM org_source_refs
     WHERE source = $1::text AND source_key = $2::text`,
    [sourceId, sourceKey],
  );
  const actualOrgId = result.rows[0] ? String(result.rows[0].org_id) : null;
  if (actualOrgId !== String(expectedOrgId)) {
    throw new Error(
      `organization source ref ownership conflict for ${sourceId}/${sourceKey}: expected ${expectedOrgId}, got ${actualOrgId ?? 'missing'}`,
    );
  }
}

function dedupeStrongIdentities(sourceKeys) {
  const identities = [];
  const seen = new Set();
  for (const sourceKey of sourceKeys) {
    const identity = classifyStrongIdentityKey(sourceKey);
    if (identity && !seen.has(identity.key)) {
      seen.add(identity.key);
      identities.push(identity);
    }
  }
  return identities;
}

function canonicalCompanyDomain(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim().toLowerCase();
  if (
    raw === ''
    || raw.length > 253
    || raw.endsWith('.')
    || /[:/\\?#@\s]/.test(raw)
    || raw.includes('..')
    || raw.includes('xn--')
    || isIP(raw) !== 0
  ) return null;

  let labels = raw.split('.');
  if (labels.length < 2) return null;
  if (CORPORATE_SUBDOMAIN_PREFIXES.has(labels[0]) && labels.length > 2) {
    labels = labels.slice(1);
  }
  if (labels.some((label) => (
    label.length === 0
    || label.length > 63
    || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ))) return null;

  const domain = labels.join('.');
  if (PUBLIC_SUFFIX_DOMAINS.has(domain)) return null;
  if (PLATFORM_DOMAINS.has(domain) || [...PLATFORM_DOMAINS].some((item) => domain.endsWith(`.${item}`))) return null;
  return domain;
}

function isValidInn10(value) {
  if (!/^\d{10}$/.test(value)) return false;
  const weights = [2, 4, 10, 3, 5, 9, 4, 6, 8];
  const checksum = weights.reduce((sum, weight, index) => sum + Number(value[index]) * weight, 0) % 11 % 10;
  return checksum === Number(value[9]);
}

function isValidOgrn13(value) {
  if (!/^\d{13}$/.test(value)) return false;
  return Number(BigInt(value.slice(0, 12)) % 11n % 10n) === Number(value[12]);
}
