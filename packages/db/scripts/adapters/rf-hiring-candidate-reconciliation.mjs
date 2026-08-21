import { evaluateSourceProductionProof } from './source-production-proof.mjs';
import { upsertSignalEvidenceLineage } from '../lib/source-lineage-writer.mjs';

const DEFAULT_CORROBORATION_LOOKBACK_DAYS = 180;

/**
 * Classify already-persisted lineage for one organization. This deliberately
 * separates hiring corroboration from identity/legal context and from another
 * job-board publication. A second job board is useful for cross-post detection,
 * but it is NOT an independent evidence family for the high-priority DoD gate.
 */
export function classifyCandidateCorroboration(lineageRows = [], candidateSourceFamily = null) {
  const families = new Set();
  const hiringFamilies = new Set();
  const identityFamilies = new Set();
  const jobBoardSources = new Set();
  let directEmployerEvidence = false;
  let atsEvidence = false;

  for (const row of lineageRows) {
    const sourceFamily = nonEmptyText(row?.source_family ?? row?.sourceFamily);
    const source = nonEmptyText(row?.source);
    const payload = asObject(row?.signal_payload_snapshot ?? row?.signalPayloadSnapshot);
    if (!sourceFamily) continue;

    if (sourceFamily === 'company-owned-career') {
      const hostedAtsFamily = nonEmptyText(payload?.hosted_ats_family ?? payload?.hostedAtsFamily);
      if (hostedAtsFamily) {
        const key = `hiring:ats:${normalizeFamilyToken(hostedAtsFamily)}`;
        families.add(key);
        hiringFamilies.add(key);
        atsEvidence = true;
      } else {
        const key = 'hiring:direct-career';
        families.add(key);
        hiringFamilies.add(key);
        directEmployerEvidence = true;
      }
      continue;
    }

    if (sourceFamily === 'fns-official-registry') {
      const key = 'identity:legal:fns-official-registry';
      families.add(key);
      identityFamilies.add(key);
      continue;
    }

    if (sourceFamily === 'job-board') {
      if (source && source !== candidateSourceFamily) jobBoardSources.add(source);
      continue;
    }
  }

  return Object.freeze({
    families: Object.freeze([...families].sort()),
    hiringFamilies: Object.freeze([...hiringFamilies].sort()),
    identityFamilies: Object.freeze([...identityFamilies].sort()),
    crossPostedJobBoardSources: Object.freeze([...jobBoardSources].sort()),
    directEmployerEvidence,
    atsEvidence,
    independentHiringCorroboration: hiringFamilies.size > 0,
    legalIdentityCorroboration: identityFamilies.size > 0,
  });
}

export async function loadCandidateCorroboration(client, candidate, {
  lookbackDays = DEFAULT_CORROBORATION_LOOKBACK_DAYS,
} = {}) {
  const orgId = candidate?.resolved_org_id ?? candidate?.resolvedOrgId;
  if (!orgId) return classifyCandidateCorroboration([], candidate?.source_family ?? candidate?.sourceFamily);
  const boundedLookbackDays = normalizeLookbackDays(lookbackDays);
  const result = await client.query(
    `SELECT source, source_family, evidence_tier, extraction_method,
            signal_payload_snapshot, published_at, created_at
     FROM source_signal_evidence_lineage_v1
     WHERE organization_id = $1::BIGINT
       AND created_at >= NOW() - ($2::INTEGER * INTERVAL '1 day')
     ORDER BY created_at DESC, id DESC`,
    [orgId, boundedLookbackDays],
  );
  return classifyCandidateCorroboration(
    result.rows,
    candidate?.source_family ?? candidate?.sourceFamily,
  );
}

export async function persistCandidateCorroboration(client, candidateId, corroboration) {
  const result = await client.query(
    `UPDATE rf_hiring_discovery_candidates_v2
     SET corroboration_families = $2::TEXT[],
         payload = payload || JSONB_BUILD_OBJECT(
           'corroboration', JSONB_BUILD_OBJECT(
             'families', TO_JSONB($2::TEXT[]),
             'hiring_families', TO_JSONB($3::TEXT[]),
             'identity_families', TO_JSONB($4::TEXT[]),
             'cross_posted_job_board_sources', TO_JSONB($5::TEXT[]),
             'direct_employer_evidence', $6::BOOLEAN,
             'ats_evidence', $7::BOOLEAN,
             'independent_hiring_corroboration', $8::BOOLEAN,
             'legal_identity_corroboration', $9::BOOLEAN,
             'evaluated_at', NOW()
           )
         ),
         updated_at = NOW()
     WHERE id = $1::BIGINT
     RETURNING id::TEXT AS id, corroboration_families`,
    [
      candidateId,
      corroboration.families,
      corroboration.hiringFamilies,
      corroboration.identityFamilies,
      corroboration.crossPostedJobBoardSources,
      corroboration.directEmployerEvidence,
      corroboration.atsEvidence,
      corroboration.independentHiringCorroboration,
      corroboration.legalIdentityCorroboration,
    ],
  );
  return result.rows[0] ?? null;
}

export function evaluateCandidatePromotionEligibility({ candidate, family, productionProof }) {
  const issues = [];
  const identityStatus = candidate?.identity_status ?? candidate?.identityStatus;
  const orgId = candidate?.resolved_org_id ?? candidate?.resolvedOrgId;
  const sourceFamily = candidate?.source_family ?? candidate?.sourceFamily;
  const jobTitle = nonEmptyText(candidate?.job_title ?? candidate?.jobTitle);
  const vacancyUrl = nonEmptyText(candidate?.vacancy_url ?? candidate?.vacancyUrl);

  if (identityStatus !== 'resolved' || !orgId) issues.push('candidate-identity-unresolved');
  if (!family || family.id !== sourceFamily) issues.push('family-mismatch');
  if (family?.productionState !== 'live') issues.push('family-not-production-live');
  if (!jobTitle) issues.push('job-title-missing');
  if (!vacancyUrl) issues.push('vacancy-url-missing');

  const proof = evaluateSourceProductionProof(productionProof ?? {});
  if (!proof.pass) issues.push(...proof.issues.map((issue) => `production-proof:${issue}`));
  if (proof.source && sourceFamily && proof.source !== sourceFamily) issues.push('production-proof:source-mismatch');

  return Object.freeze({
    pass: issues.length === 0,
    issues: Object.freeze([...new Set(issues)]),
    proof,
  });
}

export async function promoteRfHiringCandidate(client, {
  candidate,
  family,
  productionProof,
  corroboration,
}) {
  const eligibility = evaluateCandidatePromotionEligibility({ candidate, family, productionProof });
  if (!eligibility.pass) {
    return Object.freeze({ promoted: false, eligibility, lineage: null });
  }

  const externalId = buildPromotionExternalId(candidate);
  const orgId = candidate.resolved_org_id ?? candidate.resolvedOrgId;
  const publishedAt = normalizeDate(candidate.published_at ?? candidate.publishedAt)
    ?? normalizeDate(candidate.first_detected_at ?? candidate.firstDetectedAt)
    ?? new Date().toISOString();
  const normalizedAt = normalizeDate(candidate.last_detected_at ?? candidate.lastDetectedAt)
    ?? new Date().toISOString();
  const payload = buildPromotionPayload(candidate, corroboration);

  const lineage = await upsertSignalEvidenceLineage(client, {
    orgId,
    signalType: 'job_posting',
    source: family.id,
    sourceFamily: 'job-board',
    externalId,
    headline: candidate.job_title ?? candidate.jobTitle,
    summary: buildPromotionSummary(candidate),
    sourceUrl: candidate.vacancy_url ?? candidate.vacancyUrl,
    publishedAt,
    normalizedAt,
    payload,
    sourceRecordType: 'job_posting',
    evidenceTier: 'corroboration',
    extractionMethod: candidate.acquisition_method ?? candidate.acquisitionMethod ?? 'public-job-board',
    organizationResolutionReason: 'validated-strong-key',
  });

  await client.query(
    `UPDATE rf_hiring_discovery_candidates_v2
     SET promoted_at = COALESCE(promoted_at, NOW()),
         promoted_signal_external_id = $2::TEXT,
         payload = payload || JSONB_BUILD_OBJECT('promotion', JSONB_BUILD_OBJECT(
           'signal_external_id', $2::TEXT,
           'source_family', $3::TEXT,
           'promoted_at', COALESCE(promoted_at, NOW())
         )),
         updated_at = NOW()
     WHERE id = $1::BIGINT`,
    [candidate.id, externalId, family.id],
  );

  return Object.freeze({ promoted: true, eligibility, lineage, externalId });
}

export function buildPromotionExternalId(candidate) {
  const external = nonEmptyText(candidate?.external_vacancy_id ?? candidate?.externalVacancyId);
  if (external) return external;
  const vacancyKey = nonEmptyText(candidate?.vacancy_key ?? candidate?.vacancyKey);
  if (!vacancyKey) throw new TypeError('candidate requires external vacancy id or vacancy key');
  return vacancyKey;
}

function buildPromotionPayload(candidate, corroboration = {}) {
  return {
    source: candidate.source_family ?? candidate.sourceFamily,
    source_entity_type: 'employer',
    source_record_type: 'job_posting',
    source_record_id: buildPromotionExternalId(candidate),
    source_record_title: candidate.job_title ?? candidate.jobTitle ?? null,
    source_record_url: candidate.vacancy_url ?? candidate.vacancyUrl,
    source_record_published_at: candidate.published_at ?? candidate.publishedAt ?? null,
    publisher_type: 'job-board',
    org_source_key: (candidate.strong_identity_keys ?? candidate.strongIdentityKeys ?? [])[0] ?? null,
    employer_name: candidate.employer_name ?? candidate.employerName ?? null,
    vacancy_name: candidate.job_title ?? candidate.jobTitle ?? null,
    location: candidate.location ?? null,
    candidate_id: String(candidate.id),
    staged_first_detected_at: candidate.first_detected_at ?? candidate.firstDetectedAt ?? null,
    staged_last_detected_at: candidate.last_detected_at ?? candidate.lastDetectedAt ?? null,
    corroboration_families: corroboration.families ?? [],
    independent_hiring_corroboration: corroboration.independentHiringCorroboration === true,
    direct_employer_evidence: corroboration.directEmployerEvidence === true,
    ats_evidence: corroboration.atsEvidence === true,
  };
}

function buildPromotionSummary(candidate) {
  const employer = nonEmptyText(candidate.employer_name ?? candidate.employerName);
  const location = nonEmptyText(candidate.location);
  const fragments = [employer, location ? `регион: ${location}` : null].filter(Boolean);
  return fragments.length > 0
    ? `Вакансия ${candidate.source_family ?? candidate.sourceFamily} (${fragments.join(', ')})`
    : `Вакансия ${candidate.source_family ?? candidate.sourceFamily}`;
}

function normalizeLookbackDays(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 730 ? parsed : DEFAULT_CORROBORATION_LOOKBACK_DAYS;
}

function normalizeFamilyToken(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

function normalizeDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  const text = nonEmptyText(value);
  if (!text || !Number.isFinite(Date.parse(text))) return null;
  return new Date(Date.parse(text)).toISOString();
}

function asObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function nonEmptyText(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}
