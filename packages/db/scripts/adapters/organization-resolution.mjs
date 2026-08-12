const PLATFORM_DOMAINS = new Set([
  'hh.ru',
  'career.habr.com',
  'superjob.ru',
  'trudvsem.ru',
  'linkedin.com',
]);

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
    throw new Error(
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
    throw new Error(`source-local identity conflict for ${sourceId}: multiple organization owners`);
  }

  const localOwnerId = local.rows[0] ? String(local.rows[0].org_id) : null;
  if (strongOwnerId && localOwnerId && strongOwnerId !== localOwnerId) {
    throw new Error(
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
  let hostname;
  try {
    hostname = new URL(`http://${value.trim().replace(/^https?:\/\//i, '')}`).hostname;
  } catch {
    return null;
  }

  const domain = hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (!domain.includes('.') || domain.length > 253 || /[^a-z0-9.-]/.test(domain)) return null;
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
