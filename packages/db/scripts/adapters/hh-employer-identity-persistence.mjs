import { classifyStrongIdentityKey } from './organization-resolution.mjs';

/**
 * Apply one HH employer-detail identity update under the same global strong-key
 * ownership contract used by source ingestion. This never creates a new hiring
 * signal; it only enriches an already-known HH organization with its own public
 * website/domain when ownership is unambiguous.
 */
export async function persistHhEmployerIdentity(client, {
  orgId,
  employerId,
  employerName,
  detail,
}) {
  const id = String(orgId ?? '').trim();
  const hhEmployerId = String(employerId ?? '').trim();
  if (!/^\d+$/.test(id) || !/^\d+$/.test(hhEmployerId)) {
    return { status: 'rejected', reason: 'invalid-owner-or-employer-id' };
  }

  const siteUrl = normalizeHttpUrl(detail?.siteUrl ?? detail?.site_url);
  if (!siteUrl) return { status: 'no-site', reason: 'employer-detail-has-no-site' };
  const host = normalizeDomain(new URL(siteUrl).hostname);
  const strong = host ? classifyStrongIdentityKey(`domain:${host}`) : null;
  if (!strong) {
    return { status: 'rejected', reason: 'site-domain-not-strong-employer-identity', siteUrl };
  }

  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('source-identity-v1'), hashtext($1::text))",
    [strong.key],
  );

  const owners = new Set();
  const refs = await client.query(
    `SELECT DISTINCT org_id::TEXT AS org_id
     FROM org_source_refs
     WHERE source_key = $1::TEXT
     ORDER BY org_id`,
    [strong.key],
  );
  for (const row of refs.rows) owners.add(String(row.org_id));

  const domains = await client.query(
    `SELECT id::TEXT AS org_id
     FROM orgs
     WHERE LOWER(domain) = LOWER($1::TEXT)
     ORDER BY id
     LIMIT 3`,
    [host],
  );
  for (const row of domains.rows) owners.add(String(row.org_id));

  if (owners.size > 0 && (owners.size > 1 || !owners.has(id))) {
    return {
      status: 'conflict',
      reason: 'domain-owned-by-another-organization',
      domain: host,
      ownerIds: [...owners].sort(compareIds),
    };
  }

  const owner = await client.query(
    `SELECT id::TEXT AS id, name, domain, website_url
     FROM orgs
     WHERE id = $1::BIGINT
     FOR UPDATE`,
    [id],
  );
  if (owner.rows.length !== 1) {
    return { status: 'rejected', reason: 'organization-owner-missing' };
  }
  const existing = owner.rows[0];
  const existingDomain = normalizeDomain(existing.domain);
  if (existingDomain && existingDomain !== host) {
    return {
      status: 'conflict',
      reason: 'organization-already-has-different-domain',
      domain: host,
      existingDomain,
    };
  }

  await client.query(
    `UPDATE orgs
     SET
       domain = COALESCE(NULLIF(BTRIM(domain), ''), $2::TEXT),
       website_url = COALESCE(NULLIF(BTRIM(website_url), ''), $3::TEXT),
       name = CASE
         WHEN (name IS NULL OR BTRIM(name) = '') AND NULLIF(BTRIM($4::TEXT), '') IS NOT NULL
           THEN $4::TEXT
         ELSE name
       END
     WHERE id = $1::BIGINT`,
    [id, host, siteUrl, employerName ?? detail?.name ?? null],
  );

  await client.query(
    `INSERT INTO org_source_refs (
       org_id, source, source_key, external_id, display_name, metadata
     ) VALUES ($1, 'hh', $2, NULL, $3, $4::JSONB)
     ON CONFLICT (source, source_key) DO UPDATE SET
       display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), org_source_refs.display_name),
       metadata = COALESCE(org_source_refs.metadata, '{}'::JSONB) || EXCLUDED.metadata`,
    [
      id,
      strong.key,
      employerName ?? detail?.name ?? null,
      JSON.stringify({
        identity_origin: 'hh-employer-detail',
        hh_employer_id: hhEmployerId,
        employer_site_url: siteUrl,
        employer_trusted: typeof detail?.trusted === 'boolean' ? detail.trusted : null,
        employer_type: detail?.type ?? null,
        open_vacancies: Number.isFinite(Number(detail?.openVacancies)) ? Number(detail.openVacancies) : null,
      }),
    ],
  );

  const refOwner = await client.query(
    `SELECT org_id::TEXT AS org_id
     FROM org_source_refs
     WHERE source = 'hh' AND source_key = $1::TEXT`,
    [strong.key],
  );
  if (refOwner.rows.length !== 1 || String(refOwner.rows[0].org_id) !== id) {
    throw new Error(`HH employer domain ref ownership mismatch for ${strong.key}`);
  }

  return {
    status: 'enriched',
    reason: 'validated-hh-employer-site',
    domain: host,
    siteUrl,
  };
}

export function buildHhEmployersMissingIdentityQuery() {
  return `
    SELECT DISTINCT ON (refs.external_id)
      orgs.id::TEXT AS org_id,
      refs.external_id AS employer_id,
      COALESCE(NULLIF(refs.display_name, ''), orgs.name) AS employer_name,
      MAX(signals.occurred_at) OVER (PARTITION BY refs.external_id) AS last_hiring_at
    FROM org_source_refs refs
    JOIN orgs ON orgs.id = refs.org_id
    LEFT JOIN signals
      ON signals.org_id = orgs.id
     AND signals.source = 'hh'
     AND signals.signal_type = 'job_posting'
    WHERE refs.source = 'hh'
      AND refs.external_id ~ '^\\d+$'
      AND COALESCE(NULLIF(BTRIM(orgs.domain), ''), NULLIF(BTRIM(orgs.website_url), '')) IS NULL
    ORDER BY refs.external_id, MAX(signals.occurred_at) OVER (PARTITION BY refs.external_id) DESC NULLS LAST
  `;
}

function normalizeHttpUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeDomain(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase().replace(/^www\./, '');
  return text || null;
}

function compareIds(left, right) {
  const l = Number(left);
  const r = Number(right);
  if (Number.isSafeInteger(l) && Number.isSafeInteger(r)) return l - r;
  return String(left).localeCompare(String(right));
}
