import { createHash } from 'node:crypto';

import { classifyStrongIdentityKey } from './organization-resolution.mjs';

export function buildRfHiringDiscoveryCandidate({ family, posting, vacancyUrl, detectedAt = new Date().toISOString() }) {
  const sourceFamily = nonEmptyText(family?.id);
  if (!sourceFamily) throw new TypeError('family.id is required');

  const canonicalVacancyUrl = canonicalHttpsUrl(posting?.vacancyUrl ?? vacancyUrl);
  if (!canonicalVacancyUrl) return null;

  const externalVacancyId = nonEmptyText(posting?.externalId);
  const employerWebsiteUrl = canonicalEmployerWebsite(posting?.employerUrl, family?.platformDomains ?? []);
  const strongIdentityKeys = [];
  if (employerWebsiteUrl) {
    const domain = new URL(employerWebsiteUrl).hostname.toLowerCase().replace(/^www\./, '');
    const identity = classifyStrongIdentityKey(`domain:${domain}`);
    if (identity) strongIdentityKeys.push(identity.key);
  }

  const vacancyKey = externalVacancyId
    ? `id:${externalVacancyId}`
    : `url:${canonicalVacancyUrl}`;
  const payload = {
    source_family: sourceFamily,
    vacancy_url: canonicalVacancyUrl,
    external_vacancy_id: externalVacancyId,
    job_title: nonEmptyText(posting?.title),
    employer_name: nonEmptyText(posting?.employerName),
    employer_website_url: employerWebsiteUrl,
    location: nonEmptyText(posting?.location),
    employment_type: Array.isArray(posting?.employmentType) ? posting.employmentType : [],
    published_at: normalizeDate(posting?.datePosted),
    valid_through: normalizeDate(posting?.validThrough),
    extraction_method: nonEmptyText(posting?.extractionMethod) ?? 'vacancy-link-discovery',
  };

  return Object.freeze({
    sourceFamily,
    vacancyKey,
    externalVacancyId,
    vacancyUrl: canonicalVacancyUrl,
    jobTitle: payload.job_title,
    employerName: payload.employer_name,
    employerProfileUrl: null,
    employerWebsiteUrl,
    location: payload.location,
    publishedAt: payload.published_at,
    detectedAt: normalizeDate(detectedAt) ?? new Date().toISOString(),
    acquisitionMethod: payload.extraction_method,
    strongIdentityKeys: Object.freeze([...new Set(strongIdentityKeys)]),
    payload: Object.freeze(payload),
    contentFingerprint: sha256(stableStringify(payload)),
  });
}

export async function resolveCandidateIdentity(client, candidate) {
  const strongKeys = [...new Set((candidate?.strongIdentityKeys ?? candidate?.strong_identity_keys ?? [])
    .map((key) => classifyStrongIdentityKey(key)?.key)
    .filter(Boolean))];
  if (strongKeys.length === 0) {
    return Object.freeze({ status: 'pending', orgId: null, reason: 'strong-identity-required', strongKeys });
  }

  for (const key of [...strongKeys].sort()) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('rf-discovery-identity-v2'), hashtext($1::text))",
      [key],
    );
  }

  const owners = new Set();
  const refs = await client.query(
    `SELECT DISTINCT org_id::TEXT AS org_id
     FROM org_source_refs
     WHERE source_key = ANY($1::TEXT[])
     ORDER BY org_id`,
    [strongKeys],
  );
  for (const row of refs.rows) owners.add(String(row.org_id));

  const domains = strongKeys
    .filter((key) => key.startsWith('domain:'))
    .map((key) => key.slice('domain:'.length));
  if (domains.length > 0) {
    const domainOwners = await client.query(
      `SELECT id::TEXT AS org_id
       FROM orgs
       WHERE LOWER(domain) = ANY($1::TEXT[])
       ORDER BY id`,
      [domains],
    );
    for (const row of domainOwners.rows) owners.add(String(row.org_id));
  }

  if (owners.size === 1) {
    return Object.freeze({
      status: 'resolved',
      orgId: [...owners][0],
      reason: 'validated-strong-key',
      strongKeys,
    });
  }
  if (owners.size > 1) {
    return Object.freeze({
      status: 'ambiguous',
      orgId: null,
      reason: 'strong-key-multiple-owners',
      strongKeys,
      ownerIds: Object.freeze([...owners].sort(compareIds)),
    });
  }
  return Object.freeze({ status: 'pending', orgId: null, reason: 'strong-key-owner-not-yet-known', strongKeys });
}

export async function upsertRfHiringDiscoveryCandidate(client, candidate) {
  if (!candidate) return null;
  await client.query('BEGIN');
  try {
    const resolution = await resolveCandidateIdentity(client, candidate);
    const result = await client.query(
      `INSERT INTO rf_hiring_discovery_candidates_v2 (
         source_family, vacancy_key, external_vacancy_id, vacancy_url, job_title,
         employer_name, employer_profile_url, employer_website_url, location,
         published_at, first_detected_at, last_detected_at, acquisition_method,
         identity_status, resolved_org_id, resolution_reason, strong_identity_keys,
         payload, content_fingerprint
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13,$14,$15,$16::TEXT[],$17::JSONB,$18
       )
       ON CONFLICT (source_family, vacancy_key) DO UPDATE SET
         external_vacancy_id = COALESCE(EXCLUDED.external_vacancy_id, rf_hiring_discovery_candidates_v2.external_vacancy_id),
         vacancy_url = EXCLUDED.vacancy_url,
         job_title = COALESCE(EXCLUDED.job_title, rf_hiring_discovery_candidates_v2.job_title),
         employer_name = COALESCE(EXCLUDED.employer_name, rf_hiring_discovery_candidates_v2.employer_name),
         employer_profile_url = COALESCE(EXCLUDED.employer_profile_url, rf_hiring_discovery_candidates_v2.employer_profile_url),
         employer_website_url = COALESCE(EXCLUDED.employer_website_url, rf_hiring_discovery_candidates_v2.employer_website_url),
         location = COALESCE(EXCLUDED.location, rf_hiring_discovery_candidates_v2.location),
         published_at = COALESCE(EXCLUDED.published_at, rf_hiring_discovery_candidates_v2.published_at),
         last_detected_at = GREATEST(rf_hiring_discovery_candidates_v2.last_detected_at, EXCLUDED.last_detected_at),
         acquisition_method = EXCLUDED.acquisition_method,
         identity_status = CASE
           WHEN rf_hiring_discovery_candidates_v2.promoted_at IS NOT NULL
             THEN rf_hiring_discovery_candidates_v2.identity_status
           WHEN rf_hiring_discovery_candidates_v2.identity_status = 'resolved'
             AND EXCLUDED.identity_status = 'pending'
             THEN rf_hiring_discovery_candidates_v2.identity_status
           ELSE EXCLUDED.identity_status
         END,
         resolved_org_id = CASE
           WHEN rf_hiring_discovery_candidates_v2.promoted_at IS NOT NULL
             THEN rf_hiring_discovery_candidates_v2.resolved_org_id
           WHEN rf_hiring_discovery_candidates_v2.identity_status = 'resolved'
             AND EXCLUDED.identity_status = 'pending'
             THEN rf_hiring_discovery_candidates_v2.resolved_org_id
           ELSE EXCLUDED.resolved_org_id
         END,
         resolution_reason = CASE
           WHEN rf_hiring_discovery_candidates_v2.promoted_at IS NOT NULL
             THEN rf_hiring_discovery_candidates_v2.resolution_reason
           WHEN rf_hiring_discovery_candidates_v2.identity_status = 'resolved'
             AND EXCLUDED.identity_status = 'pending'
             THEN rf_hiring_discovery_candidates_v2.resolution_reason
           ELSE EXCLUDED.resolution_reason
         END,
         strong_identity_keys = CASE
           WHEN CARDINALITY(EXCLUDED.strong_identity_keys) > 0 THEN EXCLUDED.strong_identity_keys
           ELSE rf_hiring_discovery_candidates_v2.strong_identity_keys
         END,
         payload = rf_hiring_discovery_candidates_v2.payload || EXCLUDED.payload,
         content_fingerprint = EXCLUDED.content_fingerprint,
         updated_at = NOW()
       RETURNING id::TEXT AS id, identity_status, resolved_org_id::TEXT AS resolved_org_id`,
      [
        candidate.sourceFamily,
        candidate.vacancyKey,
        candidate.externalVacancyId,
        candidate.vacancyUrl,
        candidate.jobTitle,
        candidate.employerName,
        candidate.employerProfileUrl,
        candidate.employerWebsiteUrl,
        candidate.location,
        candidate.publishedAt,
        candidate.detectedAt,
        candidate.acquisitionMethod,
        resolution.status,
        resolution.orgId,
        resolution.reason,
        resolution.strongKeys,
        JSON.stringify(candidate.payload),
        candidate.contentFingerprint,
      ],
    );
    await client.query('COMMIT');
    return Object.freeze({ ...result.rows[0], resolution });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

function canonicalEmployerWebsite(value, platformDomains) {
  const url = canonicalHttpsUrl(value);
  if (!url) return null;
  const host = new URL(url).hostname.toLowerCase();
  if ((platformDomains ?? []).some((domain) => host === domain || host.endsWith(`.${domain}`))) return null;
  return url;
}

function canonicalHttpsUrl(value) {
  const text = nonEmptyText(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:') return null;
    url.hash = '';
    for (const name of [...url.searchParams.keys()]) {
      if (/^(?:utm_|yclid$|gclid$|fbclid$)/i.test(name)) url.searchParams.delete(name);
    }
    return url.toString().replace(/\?$/, '');
  } catch {
    return null;
  }
}

function normalizeDate(value) {
  const text = nonEmptyText(value);
  if (!text || !Number.isFinite(Date.parse(text))) return null;
  return new Date(Date.parse(text)).toISOString();
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function nonEmptyText(value) {
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
