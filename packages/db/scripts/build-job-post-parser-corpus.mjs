#!/usr/bin/env node
/** Build the synthetic edge-case corpus for the RF job-post parser
 * (adapters/rf-source-normalizers.mjs :: normalizeJobPostingRecord).
 *
 * Pipeline (Q2 quality-program, variant-2):
 *  1. A model (ordinary rail) generates CANDIDATE raw records only — job-post
 *     payloads in mixed shapes (hh-like, registry-like, fuzz). Model output is
 *     never trusted for expected values.
 *  2. This script validates candidates against the intake schema, dedupes by
 *     sha256 of the canonical input JSON, then computes the expected
 *     normalization with a DETERMINISTIC ORACLE: an independent
 *     reimplementation of normalizeJobPostingRecord's semantics (identity
 *     resolution, region/salary/work-mode/freshness/quality derivation). The
 *     oracle never imports product code; platform primitives (URL, Date) are
 *     shared by definition of the JS spec.
 *  3. Emits adapters/rf-source-normalizers.edge-cases.json consumed by
 *     adapters/rf-source-normalizers-corpus.test.mjs (full-record deep equal).
 *
 * Usage:
 *   node packages/db/scripts/build-job-post-parser-corpus.mjs CANDIDATES_JSON OUT_JSON [--provenance PATH]
 *
 * Exit codes: 0 = corpus written; 1 = bad invocation/inputs; 2 = zero valid candidates.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FETCHED_AT = '2026-10-09T12:00:00.000Z';
const SOURCE_ID = 'q2-corpus';
const CORPUS_VERSION = 'jobpost-edge-2026-10-09-v1';

/* ---------------- oracle: independent reimplementation ---------------- */

function oToNonEmptyText(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function oToUrlOrNull(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  try {
    return new URL(trimmed).toString();
  } catch {
    return null;
  }
}

function oToTimestampOrNull(value) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function oNormalizeDomain(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ').toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '');
  return normalized === '' ? null : normalized;
}

function oExtractHostname(value) {
  if (!value) return null;
  try {
    return oNormalizeDomain(new URL(value).hostname);
  } catch {
    return null;
  }
}

function oToDigits(value) {
  const text = oToNonEmptyText(value);
  return text ? text.replace(/\D/g, '') : null;
}

function oNormalizeLegalInn(value) {
  const digits = oToDigits(value);
  return digits?.length === 10 ? digits : null;
}

function oNormalizeLegalOgrn(value) {
  const digits = oToDigits(value);
  return digits?.length === 13 ? digits : null;
}

function oNormalizeSourceKeyText(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ').toLowerCase();
  return normalized === '' ? null : normalized;
}

/* legal-name tables (data constants mirrored; logic reimplemented) */
const RUSSIAN_LEGAL_FORMS = Object.freeze([
  'общество с ограниченной ответственностью',
  'публичное акционерное общество',
  'открытое акционерное общество',
  'закрытое акционерное общество',
  'акционерное общество',
  'автономная некоммерческая организация',
  'некоммерческая организация',
  'о о о',
  'ооо',
  'пао',
  'оао',
  'зао',
  'ао',
]);

function oIsLegalNameSeparatorChar(char) {
  const code = char.charCodeAt(0);
  return code === 34 || code === 39 || code === 40 || code === 41 || code === 44
    || code === 45 || code === 46 || code === 58 || code === 59 || code === 171
    || code === 187 || code === 8211 || code === 8212 || code === 8216 || code === 8217
    || code === 8220 || code === 8221 || code === 8222;
}

function oCompactLegalNameText(value) {
  return value.trim().replace(/\s+/g, ' ');
}

function oNormalizeLegalNameText(value) {
  const text = oToNonEmptyText(value);
  if (!text) return null;
  let normalized = '';
  for (const char of text.toLowerCase().replaceAll('ё', 'е')) {
    normalized += oIsLegalNameSeparatorChar(char) ? ' ' : char;
  }
  return oCompactLegalNameText(normalized);
}

function oIsRussianSoleProprietorName(value) {
  const normalizedText = oNormalizeLegalNameText(value);
  if (!normalizedText) return false;
  return normalizedText === 'ип'
    || normalizedText.startsWith('ип ')
    || normalizedText.startsWith('и п ')
    || normalizedText === 'индивидуальный предприниматель'
    || normalizedText.startsWith('индивидуальный предприниматель ');
}

function oStripLegalForm(value, legalForm) {
  return (' ' + value + ' ').replaceAll(' ' + legalForm + ' ', ' ').trim();
}

function oNormalizeRussianLegalName(value) {
  const normalizedText = oNormalizeLegalNameText(value);
  if (!normalizedText || oIsRussianSoleProprietorName(normalizedText)) return null;
  let strippedText = normalizedText;
  let legalFormRemoved = false;
  for (const legalForm of RUSSIAN_LEGAL_FORMS) {
    const nextText = oStripLegalForm(strippedText, legalForm);
    if (nextText !== strippedText) {
      legalFormRemoved = true;
      strippedText = nextText;
    }
  }
  if (!legalFormRemoved) return null;
  strippedText = oCompactLegalNameText(strippedText);
  return strippedText.length >= 3 ? strippedText : null;
}

function oBuildRussianLegalNameSourceKey(value) {
  const normalizedName = oNormalizeRussianLegalName(value);
  return normalizedName ? `ru-legal-name:${normalizedName}` : null;
}

function oAsArray(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function oBuildSourceKeyAliases(sourceKeys, aliasKeys = [], currentSourceKey = null) {
  return [...oAsArray(sourceKeys), ...oAsArray(aliasKeys)].filter(
    (sourceKey, index, list) => Boolean(sourceKey)
      && sourceKey !== currentSourceKey
      && list.indexOf(sourceKey) === index,
  );
}

function oBuildCompanyIdentity({ companyName, companyDomain, companyWebsiteUrl, inn, ogrn, fallbackName, lineNumber }) {
  const inferredDomain = companyDomain ?? oExtractHostname(companyWebsiteUrl);
  const orgName = companyName ?? fallbackName ?? inferredDomain ?? `Source org ${lineNumber}`;
  const companyNameSourceKey = companyName ? `company-name:${oNormalizeSourceKeyText(companyName)}` : null;
  const innSourceKey = inn ? `inn:${inn}` : null;
  const ogrnSourceKey = ogrn ? `ogrn:${ogrn}` : null;
  const domainSourceKey = inferredDomain ? `domain:${inferredDomain}` : null;
  const primarySourceKey = innSourceKey ?? ogrnSourceKey ?? domainSourceKey ?? companyNameSourceKey;
  const russianLegalNameSourceKey = primarySourceKey !== companyNameSourceKey
    ? oBuildRussianLegalNameSourceKey(companyName)
    : null;
  const strongCompanyNameSourceKey = primarySourceKey === companyNameSourceKey ? companyNameSourceKey : null;
  const orgSourceKeys = [primarySourceKey, innSourceKey, ogrnSourceKey, domainSourceKey, strongCompanyNameSourceKey]
    .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index);
  const orgSourceAliasKeys = oBuildSourceKeyAliases(orgSourceKeys, [companyNameSourceKey, russianLegalNameSourceKey]);
  if (orgSourceKeys.length === 0) return null;
  return {
    orgName,
    orgDisplayName: companyName ?? fallbackName ?? inferredDomain,
    companyDomain: inferredDomain,
    primarySourceKey,
    innSourceKey,
    ogrnSourceKey,
    domainSourceKey,
    companyNameSourceKey,
    russianLegalNameSourceKey,
    orgSourceKeys,
    orgSourceAliasKeys,
  };
}

function oNormalizeLooseText(value) {
  const text = oToNonEmptyText(value);
  return text ? text.toLowerCase().replaceAll('ё', 'е').replace(/[^a-z0-9Ѐ-ӿ]+/g, ' ').trim() : null;
}

function oIncludesAny(value, needles) {
  return needles.some((needle) => value.includes(needle));
}

function oCanonicalizeRfRegion(value) {
  const normalized = oNormalizeLooseText(value);
  if (!normalized) return null;
  if (oIncludesAny(normalized, ['remote', 'udalenn', 'удален', 'удаленн'])) return 'remote';
  if (oIncludesAny(normalized, ['moscow', 'moskva', 'москв'])) return 'moscow';
  if (oIncludesAny(normalized, ['saint petersburg', 'sankt peterburg', 'st petersburg', 'spb', 'санкт', 'петербург'])) return 'saint-petersburg';
  if (oIncludesAny(normalized, ['novosibirsk', 'новосибирск'])) return 'novosibirsk';
  if (oIncludesAny(normalized, ['kazan', 'казан'])) return 'kazan';
  if (oIncludesAny(normalized, ['rostov'])) return 'rostov-oblast';
  if (oIncludesAny(normalized, ['russia', 'rf', 'росси'])) return 'russia-unspecified';
  return normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || null;
}

function oParseRubSalary(value) {
  const text = oToNonEmptyText(value);
  if (!text) return { min: null, max: null, currency: null };
  const normalizedText = text.toLowerCase();
  const currency = /rub|rur|rubles?|₽|руб/i.test(normalizedText) || /\d/.test(normalizedText) ? 'RUB' : null;
  const numbers = [...normalizedText.matchAll(/\d[\d\s.,]*/g)]
    .map((match) => Number.parseInt(match[0].replace(/\D/g, ''), 10))
    .filter((number) => Number.isFinite(number) && number > 0);
  if (numbers.length === 0) return { min: null, max: null, currency };
  if (/\bto\b|\bmax\b|до\b/i.test(normalizedText) && numbers.length === 1) {
    return { min: null, max: numbers[0], currency };
  }
  if (/\bfrom\b|\bmin\b|от\b/i.test(normalizedText) && numbers.length === 1) {
    return { min: numbers[0], max: null, currency };
  }
  return {
    min: Math.min(...numbers),
    max: numbers.length > 1 ? Math.max(...numbers) : null,
    currency,
  };
}

function oDetectWorkModeFlags(values) {
  const normalized = oNormalizeLooseText(values.filter(Boolean).join(' ')) ?? '';
  return {
    remote: oIncludesAny(normalized, ['remote', 'udalenn', 'удален']),
    hybrid: oIncludesAny(normalized, ['hybrid', 'gibrid', 'гибрид']),
    rotational: oIncludesAny(normalized, ['rotational', 'shift', 'vakhta', 'вахт']),
  };
}

function oParseTime(value) {
  const date = typeof value === 'string' ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : null;
}

function oClassifyVacancyFreshness(occurredAt, fetchedAt) {
  const occurred = oParseTime(occurredAt);
  const fetched = oParseTime(fetchedAt) ?? Date.now();
  if (!occurred) return 'unknown';
  const ageDays = Math.max(0, Math.floor((fetched - occurred) / 86400000));
  if (ageDays <= 3) return 'fresh-3d';
  if (ageDays <= 7) return 'fresh-7d';
  if (ageDays <= 30) return 'active-30d';
  return 'stale-30d-plus';
}

function oBuildQualityPenalties({ companyName, jobTitle, location, board, publisherType, freshness }) {
  const normalized = oNormalizeLooseText([companyName, jobTitle, location, board].filter(Boolean).join(' ')) ?? '';
  const penalties = [];
  if (oIncludesAny(normalized, ['agency', 'recruitment agency', 'kadrov', 'кадров', 'агентств'])) {
    penalties.push('agency_or_staffing_noise');
  }
  if (publisherType && publisherType !== 'direct-employer') {
    penalties.push('non_direct_employer_posting');
  }
  if (oIncludesAny(normalized, ['repost', 'duplicate', 'повтор'])) {
    penalties.push('possible_repost');
  }
  if (freshness === 'stale-30d-plus') {
    penalties.push('stale_vacancy');
  }
  if (oIncludesAny(normalized, ['anonymous', 'confidential', 'конфиденциал'])) {
    penalties.push('weak_employer_identity');
  }
  return penalties;
}

function oBuildRfJobQuality(fields) {
  const regionCanonical = oCanonicalizeRfRegion(fields.location);
  const salaryRub = oParseRubSalary(fields.salary);
  const workModeFlags = oDetectWorkModeFlags([fields.jobTitle, fields.location, fields.employmentType, ...(fields.tags ?? [])]);
  const freshness = oClassifyVacancyFreshness(fields.occurredAt, fields.fetchedAt);
  const qualityPenalties = oBuildQualityPenalties({
    companyName: fields.companyName,
    jobTitle: fields.jobTitle,
    location: fields.location,
    board: fields.board,
    publisherType: fields.publisherType,
    freshness,
  });
  return {
    payload: {
      region_raw: fields.location,
      region_canonical: regionCanonical,
      salary_rub_min: salaryRub.min,
      salary_rub_max: salaryRub.max,
      salary_currency: salaryRub.currency,
      is_remote: workModeFlags.remote,
      is_hybrid: workModeFlags.hybrid,
      is_rotational: workModeFlags.rotational,
      vacancy_freshness: freshness,
      quality_penalties: qualityPenalties,
    },
  };
}

function oAsObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function oBuildSignalExternalId(sourceId, externalId, sourceUrl, primarySourceKey, lineNumber) {
  if (externalId) return `${sourceId}:${externalId}`;
  if (sourceUrl) return `${sourceId}:url:${sourceUrl}`;
  return `${sourceId}:derived:${primarySourceKey}:${lineNumber}`;
}

/** Independent reimplementation of normalizeJobPostingRecord (options = {}). */
function oNormalizeJobPostingRecord(record, { fetchedAt, lineNumber, sourceId }, options = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;

  const company = oAsObject(record.company ?? record.employer ?? record.client);
  const companyName = oToNonEmptyText(record.company_name ?? record.org_name ?? company.name);
  const companyWebsiteUrl = oToUrlOrNull(record.company_website_url ?? record.website_url ?? company.site ?? company.url);
  const companyDomain = oNormalizeDomain(record.company_domain ?? record.domain);
  const inn = oNormalizeLegalInn(record.inn ?? company.inn);
  const ogrn = oNormalizeLegalOgrn(record.ogrn ?? company.ogrn);
  const jobTitle = oToNonEmptyText(record.job_title ?? record.title ?? record.role ?? record.name ?? record.text);
  const externalId = oToNonEmptyText(record.external_id ?? record.id ?? record.job_id);
  const sourceUrl = oToUrlOrNull(record.job_posting_url ?? record.job_url ?? record.url ?? record.link);
  const occurredAt = oToTimestampOrNull(record.published_at ?? record.posted_at ?? record.created_at ?? record.date_published)
    ?? fetchedAt;
  const location = oToNonEmptyText(record.location ?? record.city ?? record.region ?? record.town?.title);
  const salary = oToNonEmptyText(record.salary ?? record.compensation);
  const employmentType = oToNonEmptyText(record.employment_type ?? record.type_of_work?.title);
  const board = oToNonEmptyText(record.board ?? record.source_board) ?? options.defaultBoard ?? sourceId;
  const publisherType = oToNonEmptyText(record.publisher_type);
  const publisherTypeId = Number.isInteger(Number(record.publisher_type_id)) ? Number(record.publisher_type_id) : null;
  const publisherTypeLabel = oToNonEmptyText(record.publisher_type_label);
  const candidateEligible = typeof record.candidate_eligible === 'boolean' ? record.candidate_eligible : null;
  const tags = Array.isArray(record.tags) ? record.tags.map((tag) => String(tag).trim()).filter(Boolean) : [];
  const rfQuality = oBuildRfJobQuality({
    companyName, jobTitle, location, salary, employmentType, occurredAt, fetchedAt, board, publisherType, tags,
  });

  if (!jobTitle) return null;

  const identity = oBuildCompanyIdentity({
    companyName, companyDomain, companyWebsiteUrl, inn, ogrn, fallbackName: companyName, lineNumber,
  });
  if (!identity) return null;

  return {
    ...identity,
    fetchedAt,
    occurredAt,
    companyName,
    companyWebsiteUrl,
    inn,
    ogrn,
    orgExternalId: options.useLegalOrgExternalId ? inn ?? ogrn ?? null : null,
    signalExternalId: oBuildSignalExternalId(sourceId, externalId, sourceUrl, identity.primarySourceKey, lineNumber),
    signalType: 'job_posting',
    evidenceRole: 'primary_platform',
    sourceRecordType: 'job_posting',
    headline: jobTitle,
    recordTitle: jobTitle,
    sourceUrl,
    jobTitle,
    summary: [companyName, location, salary].map(oToNonEmptyText).filter(Boolean).join('; ') || `${sourceId} job posting`,
    payload: {
      board,
      vacancy_id: externalId,
      job_title: jobTitle,
      job_posting_url: sourceUrl,
      location,
      salary,
      employment_type: employmentType,
      tags,
      ...(publisherType ? {
        publisher_type: publisherType,
        publisher_type_id: publisherTypeId,
        publisher_type_label: publisherTypeLabel,
        candidate_eligible: candidateEligible === true,
      } : {}),
      ...rfQuality.payload,
    },
  };
}

/* ---------------- intake: schema + dedupe ---------------- */

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function inputDigest(candidate) {
  return createHash('sha256')
    .update(stableStringify({ kind: candidate.kind, record: candidate.record ?? null }))
    .digest('hex');
}

function validateCandidate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [null, 'not a JSON object'];
  if (raw.kind !== 'record' && raw.kind !== 'null') return [null, 'kind must be record|null'];
  if (typeof raw.category !== 'string' || raw.category.trim() === '') return [null, 'category missing'];
  if (raw.kind === 'record' && (!raw.record || typeof raw.record !== 'object' || Array.isArray(raw.record))) {
    return [null, 'kind=record requires an object record'];
  }
  return [{
    kind: raw.kind,
    category: raw.category.trim(),
    record: raw.kind === 'record' ? raw.record : raw.record ?? null,
    rationale: typeof raw.rationale === 'string' ? raw.rationale : '',
  }, null];
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/* ---------------- main ---------------- */

function main() {
  const [candidatesPath, outPath, ...rest] = process.argv.slice(2);
  if (!candidatesPath || !outPath) {
    console.error('usage: node build-job-post-parser-corpus.mjs CANDIDATES_JSON OUT_JSON [--provenance PATH]');
    return 1;
  }
  const provenanceIdx = rest.indexOf('--provenance');
  const provenancePath = provenanceIdx >= 0 ? rest[provenanceIdx + 1] : null;

  const rawCandidates = JSON.parse(readFileSync(candidatesPath, 'utf-8'));
  if (!Array.isArray(rawCandidates)) {
    console.error('candidates root must be a JSON array');
    return 1;
  }

  const fixtures = [];
  const seenDigests = new Set();
  const stats = { received: rawCandidates.length, schema_skipped: 0, duplicate_skipped: 0, oracle_kind_mismatch: 0 };
  const skipLog = [];

  rawCandidates.forEach((raw, index) => {
    const [candidate, reason] = validateCandidate(raw);
    if (!candidate) {
      stats.schema_skipped += 1;
      skipLog.push({ index, reason });
      return;
    }
    const digest = inputDigest(candidate);
    if (seenDigests.has(digest)) {
      stats.duplicate_skipped += 1;
      skipLog.push({ index, reason: 'duplicate input digest', category: candidate.category });
      return;
    }
    seenDigests.add(digest);

    const lineNumber = index + 1;
    const normalized = oNormalizeJobPostingRecord(candidate.record, {
      fetchedAt: FETCHED_AT, lineNumber, sourceId: SOURCE_ID,
    });

    if ((candidate.kind === 'record') !== (normalized !== null)) {
      stats.oracle_kind_mismatch += 1;
      skipLog.push({
        index,
        reason: candidate.kind === 'record' ? 'declared record but oracle returns null' : 'declared null but oracle normalizes',
        category: candidate.category,
      });
      return;
    }

    fixtures.push({
      id: `${candidate.category.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}-${String(fixtures.length + 1).padStart(2, '0')}`,
      kind: candidate.kind,
      category: candidate.category,
      input: { record: candidate.record, fetchedAt: FETCHED_AT, sourceId: SOURCE_ID, lineNumber },
      expected: { normalized },
      oracle_note: candidate.rationale,
      input_digest: digest,
    });
  });

  stats.written = fixtures.length;
  if (fixtures.length === 0) {
    console.error('refusing to write an empty corpus');
    console.error(JSON.stringify({ stats, skips: skipLog }, null, 2));
    return 2;
  }

  const provenance = provenancePath ? JSON.parse(readFileSync(provenancePath, 'utf-8')) : {};
  const corpus = {
    corpus_version: CORPUS_VERSION,
    scope: 'synthetic edge cases for the RF job-post parser (packages/db/scripts/adapters/rf-source-normalizers.mjs)',
    generated_by: {
      method: 'model proposes candidate raw records only; all expected normalizations are computed by the deterministic oracle script',
      ...provenance,
    },
    oracle: {
      script: 'packages/db/scripts/build-job-post-parser-corpus.mjs',
      script_sha256: sha256File(fileURLToPath(import.meta.url)),
      arithmetic: 'independent reimplementation of normalizeJobPostingRecord; platform primitives (URL, Date) shared per JS spec; no product imports',
    },
    stats,
    fixtures,
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(corpus, null, 2) + '\n', 'utf-8');
  console.log(JSON.stringify({ stats, skips: skipLog }, null, 2));
  return 0;
}

process.exit(main());
