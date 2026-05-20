import {
  buildCompanyIdentity,
  normalizeDomain,
  normalizeLegalInn,
  normalizeLegalOgrn,
  normalizeSourceKeyText,
  toNonEmptyText,
  toTimestampOrNull,
  toUrlOrNull,
} from './rf-source-runtime.mjs';

export function normalizeJobPostingRecord(record, { fetchedAt, lineNumber, sourceId }, options = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return null;
  }

  const company = asObject(record.company ?? record.employer ?? record.client);
  const companyName = toNonEmptyText(record.company_name ?? record.org_name ?? company.name);
  const companyWebsiteUrl = toUrlOrNull(record.company_website_url ?? record.website_url ?? company.site ?? company.url);
  const companyDomain = normalizeDomain(record.company_domain ?? record.domain);
  const inn = normalizeLegalInn(record.inn ?? company.inn);
  const ogrn = normalizeLegalOgrn(record.ogrn ?? company.ogrn);
  const jobTitle = toNonEmptyText(record.job_title ?? record.title ?? record.role ?? record.name ?? record.text);
  const externalId = toNonEmptyText(record.external_id ?? record.id ?? record.job_id);
  const sourceUrl = toUrlOrNull(record.job_posting_url ?? record.job_url ?? record.url ?? record.link);
  const occurredAt = toTimestampOrNull(record.published_at ?? record.posted_at ?? record.created_at ?? record.date_published)
    ?? fetchedAt;
  const location = toNonEmptyText(record.location ?? record.city ?? record.region ?? record.town?.title);
  const salary = toNonEmptyText(record.salary ?? record.compensation);
  const board = toNonEmptyText(record.board ?? record.source_board) ?? options.defaultBoard ?? sourceId;
  const tags = Array.isArray(record.tags) ? record.tags.map((tag) => String(tag).trim()).filter(Boolean) : [];

  if (!jobTitle) {
    return null;
  }

  const identity = buildCompanyIdentity({
    companyName,
    companyDomain,
    companyWebsiteUrl,
    inn,
    ogrn,
    fallbackName: companyName,
    lineNumber,
  });

  if (!identity) {
    return null;
  }

  return {
    ...identity,
    fetchedAt,
    occurredAt,
    companyName,
    companyWebsiteUrl,
    inn,
    ogrn,
    orgExternalId: options.useLegalOrgExternalId ? inn ?? ogrn ?? null : null,
    signalExternalId: buildSignalExternalId(sourceId, externalId, sourceUrl, identity.primarySourceKey, lineNumber),
    signalType: 'job_posting',
    evidenceRole: 'primary_platform',
    sourceRecordType: 'job_posting',
    headline: jobTitle,
    recordTitle: jobTitle,
    sourceUrl,
    jobTitle,
    summary: [companyName, location, salary].map(toNonEmptyText).filter(Boolean).join('; ') || `${sourceId} job posting`,
    payload: {
      board,
      vacancy_id: externalId,
      job_title: jobTitle,
      job_posting_url: sourceUrl,
      location,
      salary,
      employment_type: toNonEmptyText(record.employment_type ?? record.type_of_work?.title),
      tags,
    },
  };
}

export function normalizeRegistryRecord(record, { fetchedAt, lineNumber, sourceId }, options = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return null;
  }

  const companyName = toNonEmptyText(record.company_name ?? record.org_name ?? record.full_name ?? record.short_name ?? record.name);
  const inn = normalizeLegalInn(record.inn);
  const ogrn = normalizeLegalOgrn(record.ogrn);
  const companyWebsiteUrl = toUrlOrNull(record.company_website_url ?? record.website_url);
  const companyDomain = normalizeDomain(record.company_domain ?? record.domain);

  if (!inn && !ogrn) {
    return null;
  }

  const identity = buildCompanyIdentity({
    companyName,
    companyDomain,
    companyWebsiteUrl,
    inn,
    ogrn,
    fallbackName: inn ? `INN ${inn}` : `OGRN ${ogrn}`,
    lineNumber,
  });

  if (!identity) {
    return null;
  }

  const externalId = toNonEmptyText(record.external_id ?? record.id) ?? inn ?? ogrn;
  const occurredAt = toTimestampOrNull(record.detected_at ?? record.updated_at ?? record.fetched_at) ?? fetchedAt;
  const riskFlags = normalizeStringArray(record.risk_flags ?? record.risks);
  const exclusionFlags = normalizeStringArray(record.exclusion_flags ?? record.exclusions);

  return {
    ...identity,
    fetchedAt,
    occurredAt,
    companyName,
    companyWebsiteUrl,
    inn,
    ogrn,
    orgExternalId: inn ?? ogrn,
    signalExternalId: `${sourceId}:${externalId}`,
    signalType: 'other',
    evidenceRole: options.evidenceRole ?? 'enrichment',
    sourceEntityType: 'legal_entity',
    sourceRecordType: options.sourceRecordType ?? 'registry_reference',
    headline: companyName ?? identity.orgName,
    recordTitle: companyName ?? identity.orgName,
    sourceUrl: toUrlOrNull(record.source_url),
    summary: [companyName, inn ? `INN ${inn}` : null, record.msp_category, record.employee_count].map(toNonEmptyText).filter(Boolean).join('; '),
    payload: {
      msp_category: toNonEmptyText(record.msp_category ?? record.smb_category),
      employee_count: toNonEmptyText(record.employee_count ?? record.staff_count),
      okved: toNonEmptyText(record.okved ?? record.main_okved),
      okved_description: toNonEmptyText(record.okved_description ?? record.activity_description),
      status: toNonEmptyText(record.status),
      risk_flags: riskFlags,
      exclusion_flags: exclusionFlags,
    },
    orgMetadata: {
      msp_category: toNonEmptyText(record.msp_category ?? record.smb_category),
      employee_count: toNonEmptyText(record.employee_count ?? record.staff_count),
      risk_flags: riskFlags,
      exclusion_flags: exclusionFlags,
    },
  };
}

export function normalizeContextEventRecord(record, { fetchedAt, lineNumber, sourceId }, options = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return null;
  }

  const companyName = toNonEmptyText(record.company_name ?? record.org_name ?? record.name);
  const companyWebsiteUrl = toUrlOrNull(record.company_website_url ?? record.website_url);
  const companyDomain = normalizeDomain(record.company_domain ?? record.domain);
  const sourceUrl = toUrlOrNull(record.source_url ?? record.url ?? record.article_url ?? record.message_url);
  const inn = normalizeLegalInn(record.inn);
  const ogrn = normalizeLegalOgrn(record.ogrn);
  const identity = buildCompanyIdentity({
    companyName,
    companyDomain,
    companyWebsiteUrl,
    inn,
    ogrn,
    fallbackName: companyName,
    lineNumber,
  });

  if (!identity) {
    return null;
  }

  const externalId = toNonEmptyText(record.external_id ?? record.id) ?? sourceUrl ?? `${identity.primarySourceKey}:${lineNumber}`;
  const headline = toNonEmptyText(record.headline ?? record.title ?? record.event_title) ?? companyName ?? identity.orgName;
  const eventType = toNonEmptyText(record.event_type ?? record.type ?? options.defaultEventType);
  const occurredAt = toTimestampOrNull(record.published_at ?? record.occurred_at ?? record.event_date ?? record.date) ?? fetchedAt;
  const contextOnly = options.contextOnly !== false;

  return {
    ...identity,
    fetchedAt,
    occurredAt,
    companyName,
    companyWebsiteUrl,
    inn,
    ogrn,
    orgExternalId: options.useLegalOrgExternalId ? inn ?? ogrn ?? null : null,
    signalExternalId: `${sourceId}:${normalizeSourceKeyText(externalId) ?? lineNumber}`,
    signalType: options.signalType ?? 'other',
    evidenceRole: contextOnly ? 'context' : 'enrichment',
    sourceRecordType: options.sourceRecordType ?? 'context_event',
    headline,
    recordTitle: headline,
    sourceUrl,
    summary: [companyName, eventType, toNonEmptyText(record.summary ?? record.description)].filter(Boolean).join('; '),
    payload: {
      event_type: eventType,
      category: toNonEmptyText(record.category),
      summary: toNonEmptyText(record.summary ?? record.description),
      publisher: toNonEmptyText(record.publisher),
      context_only: contextOnly,
    },
  };
}

function buildSignalExternalId(sourceId, externalId, sourceUrl, primarySourceKey, lineNumber) {
  if (externalId) return `${sourceId}:${externalId}`;
  if (sourceUrl) return `${sourceId}:url:${sourceUrl}`;
  return `${sourceId}:derived:${primarySourceKey}:${lineNumber}`;
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  const text = toNonEmptyText(value);
  return text ? text.split(/[,;]/).map((item) => item.trim()).filter(Boolean) : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
