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
  const employmentType = toNonEmptyText(record.employment_type ?? record.type_of_work?.title);
  const board = toNonEmptyText(record.board ?? record.source_board) ?? options.defaultBoard ?? sourceId;
  const tags = Array.isArray(record.tags) ? record.tags.map((tag) => String(tag).trim()).filter(Boolean) : [];
  const rfQuality = buildRfJobQuality({
    companyName,
    jobTitle,
    location,
    salary,
    employmentType,
    occurredAt,
    fetchedAt,
    board,
    tags,
  });

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
      employment_type: employmentType,
      tags,
      ...rfQuality.payload,
    },
  };
}

export function buildRfJobQuality({
  companyName,
  jobTitle,
  location,
  salary,
  employmentType,
  occurredAt,
  fetchedAt,
  board,
  tags = [],
}) {
  const regionCanonical = canonicalizeRfRegion(location);
  const salaryRub = parseRubSalary(salary);
  const workModeFlags = detectWorkModeFlags([jobTitle, location, employmentType, ...(tags ?? [])]);
  const freshness = classifyVacancyFreshness(occurredAt, fetchedAt);
  const qualityPenalties = buildQualityPenalties({
    companyName,
    jobTitle,
    location,
    board,
    freshness,
  });

  return {
    regionCanonical,
    salaryRub,
    workModeFlags,
    freshness,
    qualityPenalties,
    payload: {
      region_raw: location,
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

function canonicalizeRfRegion(value) {
  const normalized = normalizeLooseText(value);

  if (!normalized) return null;
  if (includesAny(normalized, ['remote', 'udalenn', '\u0443\u0434\u0430\u043b\u0435\u043d', '\u0443\u0434\u0430\u043b\u0435\u043d\u043d'])) return 'remote';
  if (includesAny(normalized, ['moscow', 'moskva', '\u043c\u043e\u0441\u043a\u0432'])) return 'moscow';
  if (includesAny(normalized, ['saint petersburg', 'sankt peterburg', 'st petersburg', 'spb', '\u0441\u0430\u043d\u043a\u0442', '\u043f\u0435\u0442\u0435\u0440\u0431\u0443\u0440\u0433'])) return 'saint-petersburg';
  if (includesAny(normalized, ['novosibirsk', '\u043d\u043e\u0432\u043e\u0441\u0438\u0431\u0438\u0440\u0441\u043a'])) return 'novosibirsk';
  if (includesAny(normalized, ['kazan', '\u043a\u0430\u0437\u0430\u043d'])) return 'kazan';
  if (includesAny(normalized, ['rostov'])) return 'rostov-oblast';
  if (includesAny(normalized, ['russia', 'rf', '\u0440\u043e\u0441\u0441\u0438'])) return 'russia-unspecified';

  return normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || null;
}

function parseRubSalary(value) {
  const text = toNonEmptyText(value);

  if (!text) {
    return { min: null, max: null, currency: null };
  }

  const normalizedText = text.toLowerCase();
  const currency = /rub|rur|rubles?|\u20bd|\u0440\u0443\u0431/i.test(normalizedText) || /\d/.test(normalizedText)
    ? 'RUB'
    : null;
  const numbers = [...normalizedText.matchAll(/\d[\d\s.,]*/g)]
    .map((match) => Number.parseInt(match[0].replace(/\D/g, ''), 10))
    .filter((number) => Number.isFinite(number) && number > 0);

  if (numbers.length === 0) {
    return { min: null, max: null, currency };
  }

  if (/\bto\b|\bmax\b|\u0434\u043e\b/i.test(normalizedText) && numbers.length === 1) {
    return { min: null, max: numbers[0], currency };
  }

  if (/\bfrom\b|\bmin\b|\u043e\u0442\b/i.test(normalizedText) && numbers.length === 1) {
    return { min: numbers[0], max: null, currency };
  }

  return {
    min: Math.min(...numbers),
    max: numbers.length > 1 ? Math.max(...numbers) : null,
    currency,
  };
}

function detectWorkModeFlags(values) {
  const normalized = normalizeLooseText(values.filter(Boolean).join(' ')) ?? '';

  return {
    remote: includesAny(normalized, ['remote', 'udalenn', '\u0443\u0434\u0430\u043b\u0435\u043d']),
    hybrid: includesAny(normalized, ['hybrid', 'gibrid', '\u0433\u0438\u0431\u0440\u0438\u0434']),
    rotational: includesAny(normalized, ['rotational', 'shift', 'vakhta', '\u0432\u0430\u0445\u0442']),
  };
}

function classifyVacancyFreshness(occurredAt, fetchedAt) {
  const occurred = parseTime(occurredAt);
  const fetched = parseTime(fetchedAt) ?? Date.now();

  if (!occurred) return 'unknown';

  const ageDays = Math.max(0, Math.floor((fetched - occurred) / 86400000));
  if (ageDays <= 3) return 'fresh-3d';
  if (ageDays <= 7) return 'fresh-7d';
  if (ageDays <= 30) return 'active-30d';
  return 'stale-30d-plus';
}

function buildQualityPenalties({ companyName, jobTitle, location, board, freshness }) {
  const normalized = normalizeLooseText([companyName, jobTitle, location, board].filter(Boolean).join(' ')) ?? '';
  const penalties = [];

  if (includesAny(normalized, ['agency', 'recruitment agency', 'kadrov', '\u043a\u0430\u0434\u0440\u043e\u0432', '\u0430\u0433\u0435\u043d\u0442\u0441\u0442\u0432'])) {
    penalties.push('agency_or_staffing_noise');
  }

  if (includesAny(normalized, ['repost', 'duplicate', '\u043f\u043e\u0432\u0442\u043e\u0440'])) {
    penalties.push('possible_repost');
  }

  if (freshness === 'stale-30d-plus') {
    penalties.push('stale_vacancy');
  }

  if (includesAny(normalized, ['anonymous', 'confidential', '\u043a\u043e\u043d\u0444\u0438\u0434\u0435\u043d\u0446\u0438\u0430\u043b'])) {
    penalties.push('weak_employer_identity');
  }

  return penalties;
}

function normalizeLooseText(value) {
  const text = toNonEmptyText(value);
  return text ? text.toLowerCase().replaceAll('\u0451', '\u0435').replace(/[^a-z0-9\u0400-\u04FF]+/g, ' ').trim() : null;
}

function includesAny(value, needles) {
  return needles.some((needle) => value.includes(needle));
}

function parseTime(value) {
  const date = typeof value === 'string' ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : null;
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
