import { classifyStrongIdentityKey } from './organization-resolution.mjs';

/**
 * Create a new organization only from employer-scoped strong identity evidence.
 *
 * Preconditions:
 * - caller already holds advisory locks for candidate strong keys;
 * - global owner lookup returned no organization;
 * - publisher is not an agency;
 * - employer has a non-empty name;
 * - at least one strong key is present;
 * - a domain key is accepted only when it exactly matches employerWebsiteUrl.
 *
 * This creates identity state only. It does NOT create a hiring signal or make a
 * candidate source production-live; promotion remains gated by source proof.
 */
export async function bootstrapCandidateOrganization(client, candidate, resolution) {
  if (resolution?.status !== 'pending' || resolution?.reason !== 'strong-key-owner-not-yet-known') {
    return Object.freeze({ bootstrapped: false, resolution });
  }
  if (normalizePublisherType(candidate?.publisherType ?? candidate?.payload?.publisher_type) === 'agency') {
    return Object.freeze({ bootstrapped: false, resolution: withReason(resolution, 'agency-publisher-cannot-bootstrap-employer') });
  }

  const orgName = nonEmptyText(candidate?.employerName ?? candidate?.employer_name ?? candidate?.payload?.employer_name);
  if (!orgName) {
    return Object.freeze({ bootstrapped: false, resolution: withReason(resolution, 'employer-name-required-for-bootstrap') });
  }

  const sourceFamily = nonEmptyText(candidate?.sourceFamily ?? candidate?.source_family ?? candidate?.payload?.source_family);
  if (!sourceFamily) {
    return Object.freeze({ bootstrapped: false, resolution: withReason(resolution, 'source-family-required-for-bootstrap') });
  }

  const websiteUrl = normalizeHttpsUrl(
    candidate?.employerWebsiteUrl ?? candidate?.employer_website_url ?? candidate?.payload?.employer_website_url,
  );
  const websiteDomain = websiteUrl ? normalizeDomain(new URL(websiteUrl).hostname) : null;
  const strongKeys = [...new Set((resolution?.strongKeys ?? candidate?.strongIdentityKeys ?? candidate?.strong_identity_keys ?? [])
    .map((key) => classifyStrongIdentityKey(key)?.key)
    .filter(Boolean))];
  const acceptedKeys = strongKeys.filter((key) => isBootstrapKeyAllowed(key, websiteDomain));
  if (acceptedKeys.length === 0) {
    return Object.freeze({ bootstrapped: false, resolution: withReason(resolution, 'bootstrap-strong-key-not-employer-scoped') });
  }

  // Re-check ownership under the advisory locks held by the caller. This closes
  // the race between the first lookup and organization creation.
  const ownerRows = await client.query(
    `SELECT DISTINCT org_id::TEXT AS org_id
     FROM org_source_refs
     WHERE source_key = ANY($1::TEXT[])
     ORDER BY org_id`,
    [acceptedKeys],
  );
  const owners = new Set(ownerRows.rows.map((row) => String(row.org_id)));
  if (websiteDomain) {
    const domainOwners = await client.query(
      `SELECT id::TEXT AS org_id
       FROM orgs
       WHERE LOWER(domain) = LOWER($1::TEXT)
       ORDER BY id
       LIMIT 2`,
      [websiteDomain],
    );
    for (const row of domainOwners.rows) owners.add(String(row.org_id));
  }
  if (owners.size === 1) {
    const orgId = [...owners][0];
    await attachStrongRefs(client, { orgId, sourceFamily, orgName, candidate, strongKeys: acceptedKeys });
    return Object.freeze({
      bootstrapped: false,
      resolution: Object.freeze({ status: 'resolved', orgId, reason: 'validated-strong-key', strongKeys: acceptedKeys }),
    });
  }
  if (owners.size > 1) {
    return Object.freeze({
      bootstrapped: false,
      resolution: Object.freeze({
        status: 'ambiguous',
        orgId: null,
        reason: 'strong-key-multiple-owners',
        strongKeys: acceptedKeys,
        ownerIds: Object.freeze([...owners].sort(compareIds)),
      }),
    });
  }

  let orgId;
  try {
    const inserted = await client.query(
      `INSERT INTO orgs (name, domain, website_url)
       VALUES ($1, $2, $3)
       RETURNING id::TEXT AS id`,
      [orgName, websiteDomain, websiteUrl],
    );
    orgId = inserted.rows[0]?.id;
  } catch (error) {
    if (error?.code !== '23505' || !websiteDomain) throw error;
    const raced = await client.query(
      `SELECT id::TEXT AS id
       FROM orgs
       WHERE LOWER(domain) = LOWER($1::TEXT)
       ORDER BY id
       LIMIT 2`,
      [websiteDomain],
    );
    if (raced.rows.length !== 1) throw error;
    orgId = raced.rows[0].id;
  }
  if (!orgId) throw new Error('strong candidate bootstrap failed to create or recover organization owner');

  await attachStrongRefs(client, { orgId, sourceFamily, orgName, candidate, strongKeys: acceptedKeys });
  return Object.freeze({
    bootstrapped: true,
    resolution: Object.freeze({
      status: 'resolved',
      orgId: String(orgId),
      reason: 'new-organization',
      strongKeys: acceptedKeys,
    }),
  });
}

async function attachStrongRefs(client, { orgId, sourceFamily, orgName, candidate, strongKeys }) {
  const externalId = nonEmptyText(candidate?.externalVacancyId ?? candidate?.external_vacancy_id);
  for (const strongKey of strongKeys) {
    await client.query(
      `INSERT INTO org_source_refs (
         org_id, source, source_key, external_id, display_name, metadata
       ) VALUES ($1, $2, $3, NULL, $4, $5::JSONB)
       ON CONFLICT (source, source_key) DO UPDATE SET
         display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), org_source_refs.display_name),
         metadata = COALESCE(org_source_refs.metadata, '{}'::JSONB) || EXCLUDED.metadata`,
      [
        orgId,
        sourceFamily,
        strongKey,
        orgName,
        JSON.stringify({
          source: sourceFamily,
          source_key: strongKey,
          identity_origin: 'rf-job-board-strong-employer-evidence',
          vacancy_external_id: externalId,
          vacancy_url: nonEmptyText(candidate?.vacancyUrl ?? candidate?.vacancy_url),
          employer_website_url: normalizeHttpsUrl(candidate?.employerWebsiteUrl ?? candidate?.employer_website_url),
        }),
      ],
    );
  }
}

function isBootstrapKeyAllowed(key, websiteDomain) {
  if (key.startsWith('domain:')) {
    return Boolean(websiteDomain && key === `domain:${websiteDomain}`);
  }
  return key.startsWith('inn:') || key.startsWith('ogrn:');
}

function withReason(resolution, reason) {
  return Object.freeze({
    ...(resolution ?? { status: 'pending', orgId: null, strongKeys: [] }),
    reason,
  });
}

function normalizePublisherType(value) {
  const text = nonEmptyText(value)?.toLowerCase();
  return ['agency', 'staffing-agency', 'recruiting-agency', 'hr-agency'].includes(text) ? 'agency' : 'other';
}

function normalizeHttpsUrl(value) {
  const text = nonEmptyText(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeDomain(value) {
  const text = nonEmptyText(value)?.toLowerCase().replace(/^www\./, '');
  return text || null;
}

function nonEmptyText(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

function compareIds(left, right) {
  const l = Number(left);
  const r = Number(right);
  if (Number.isSafeInteger(l) && Number.isSafeInteger(r)) return l - r;
  return String(left).localeCompare(String(right));
}
