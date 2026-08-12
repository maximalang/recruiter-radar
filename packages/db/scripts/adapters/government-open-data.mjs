import {
  buildCompanyIdentity,
  normalizeLegalInn,
  normalizeLegalOgrn,
  normalizeSourceKeyText,
  parseCommaSeparated,
  toNonEmptyText,
  toTimestampOrNull,
  toUrlOrNull,
} from './rf-source-runtime.mjs';

export const OFFICIAL_OPEN_DATA_CATALOG = Object.freeze({
  'fns-open-data': Object.freeze({
    publisher: 'Federal Tax Service of Russia',
    passportUrls: Object.freeze([
      'https://www.nalog.gov.ru/opendata/7707329152-sshr2019/',
      'https://www.nalog.gov.ru/opendata/7707329152-revexp/',
      'https://www.nalog.gov.ru/rn77/opendata/7707329152-taxoffence/',
      'https://www.nalog.gov.ru/rn64/opendata/7707329152-rsmp/',
      'https://www.nalog.gov.ru/opendata/7707329152-rsmppp/',
    ]),
    allowedHosts: Object.freeze(['www.nalog.gov.ru', 'nalog.gov.ru', 'file.nalog.ru', 'data.nalog.ru']),
  }),
  'government-procurement': Object.freeze({
    publisher: 'Unified Information System in Procurement / Federal Treasury',
    passportUrls: Object.freeze([
      'https://zakupki.gov.ru/epz/opendata/search.html',
      'https://roskazna.gov.ru/gis/eis-zakupki-gov-ru/',
    ]),
    allowedHosts: Object.freeze(['zakupki.gov.ru', 'www.zakupki.gov.ru', 'roskazna.gov.ru', 'www.roskazna.gov.ru']),
  }),
  'cbr-registry': Object.freeze({
    publisher: 'Bank of Russia',
    passportUrls: Object.freeze([
      'https://www.cbr.ru/development/finorg/',
      'https://www.cbr.ru/registries/',
    ]),
    allowedHosts: Object.freeze(['cbr.ru', 'www.cbr.ru']),
  }),
  'rosstat-open-data': Object.freeze({
    publisher: 'Federal State Statistics Service',
    passportUrls: Object.freeze(['https://rosstat.gov.ru/opendata/']),
    allowedHosts: Object.freeze(['rosstat.gov.ru', 'www.rosstat.gov.ru']),
  }),
  'rospatent-open-data': Object.freeze({
    publisher: 'Federal Service for Intellectual Property',
    passportUrls: Object.freeze([
      'https://rospatent.gov.ru/opendata',
      'https://rospatent.gov.ru/opendata/7730176088-tz',
      'https://rospatent.gov.ru/opendata/7730176088-iz',
    ]),
    allowedHosts: Object.freeze(['rospatent.gov.ru', 'www.rospatent.gov.ru']),
  }),
});

export function parseGovernmentEnrichmentInns(value = process.env.GOVERNMENT_ENRICHMENT_INNS) {
  return parseCommaSeparated(value)
    .map(normalizeLegalInn)
    .filter((inn, index, values) => inn && values.indexOf(inn) === index);
}

export function extractSourceSection(parsed, sectionName, inns = []) {
  const records = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.[sectionName])
      ? parsed[sectionName]
      : Array.isArray(parsed?.records)
        ? parsed.records
        : [];
  if (inns.length === 0) return records;
  const allowed = new Set(inns);
  return records.filter((record) => {
    const inn = normalizeLegalInn(
      record?.inn ?? record?.supplier_inn ?? record?.applicant_inn ?? record?.INN,
    );
    return inn ? allowed.has(inn) : sectionName === 'rosstat';
  });
}

export function deriveFnsOpenDataEvents(records) {
  const legalRecords = records
    .map(normalizeFnsRawRecord)
    .filter(Boolean);
  const grouped = groupBy(legalRecords, (record) => record.inn);
  const events = [];

  for (const [inn, companyRecords] of grouped) {
    const companyName = companyRecords.find((record) => record.companyName)?.companyName ?? `INN ${inn}`;
    const byDataset = groupBy(companyRecords, (record) => record.dataset);

    for (const [dataset, datasetRecords] of byDataset) {
      const ordered = [...datasetRecords].sort(comparePeriods);
      const latest = ordered.at(-1);
      const previous = ordered.at(-2);
      if (!latest) continue;

      if (dataset === 'headcount') {
        const change = numericChange(previous?.employeeCount, latest.employeeCount);
        events.push(buildFnsEvent(latest, {
          companyName,
          eventType: change.direction === 'down' ? 'headcount_decline' : change.direction === 'up' ? 'headcount_growth' : 'headcount_snapshot',
          value: latest.employeeCount,
          previousValue: previous?.employeeCount ?? null,
          changeRatio: change.ratio,
          sizeBand: classifyCompanySize(latest.employeeCount),
        }));
        continue;
      }

      if (dataset === 'financials' || dataset === 'revenue-expenses') {
        const revenueChange = numericChange(previous?.revenue, latest.revenue);
        events.push(buildFnsEvent(latest, {
          companyName,
          eventType: revenueChange.direction === 'down' ? 'revenue_decline' : revenueChange.direction === 'up' ? 'revenue_growth' : 'financial_snapshot',
          value: latest.revenue,
          previousValue: previous?.revenue ?? null,
          changeRatio: revenueChange.ratio,
          expenses: latest.expenses,
          significantTrajectoryChange: Math.abs(revenueChange.ratio ?? 0) >= 0.2,
        }));
        continue;
      }

      if (dataset === 'sme-support' || dataset === 'government-support') {
        events.push(buildFnsEvent(latest, {
          companyName,
          eventType: 'new_government_support',
          value: latest.supportAmount,
          supportType: latest.supportType,
        }));
        continue;
      }

      if (dataset === 'sme-registry') {
        const changed = previous?.smeStatus && previous.smeStatus !== latest.smeStatus;
        events.push(buildFnsEvent(latest, {
          companyName,
          eventType: changed ? 'sme_status_transition' : 'sme_status',
          value: latest.smeStatus,
          previousValue: previous?.smeStatus ?? null,
        }));
        continue;
      }

      if (dataset === 'tax-offence' || dataset === 'tax-offences') {
        events.push(buildFnsEvent(latest, {
          companyName,
          eventType: 'tax_offence_or_penalty',
          value: latest.penaltyAmount,
        }));
        continue;
      }

      if (dataset === 'tax-regime') {
        events.push(buildFnsEvent(latest, {
          companyName,
          eventType: 'tax_regime',
          value: latest.taxRegime,
        }));
      }
    }
  }

  return events;
}

export function normalizeFnsOpenDataRecord(record, context) {
  return normalizeCompanyContextRecord(record, context, {
    sourceRecordType: 'fns_open_data_context',
    headline: `${record.company_name ?? `INN ${record.inn}`} — ${record.event_type}`,
    payload: {
      dataset: record.dataset,
      period: record.period,
      event_type: record.event_type,
      value: record.value ?? null,
      previous_value: record.previous_value ?? null,
      change_ratio: record.change_ratio ?? null,
      employee_count: record.employee_count ?? null,
      revenue: record.revenue ?? null,
      expenses: record.expenses ?? null,
      company_size_band: record.company_size_band ?? null,
      sme_status: record.sme_status ?? null,
      support_type: record.support_type ?? null,
      significant_financial_trajectory_change: record.significant_financial_trajectory_change === true,
      context_only: true,
      hiring_proof: false,
    },
  });
}

export function deriveGovernmentProcurementEvents(records, options = {}) {
  const largeThreshold = positiveNumber(options.largeContractThreshold, 100_000_000);
  const normalized = records.map(normalizeProcurementRawRecord).filter(Boolean);
  const grouped = groupBy(normalized, (record) => record.inn);
  const events = [];

  for (const [, contracts] of grouped) {
    const ordered = [...contracts].sort((left, right) => left.contractDate.localeCompare(right.contractDate));
    const seenRegions = new Set();
    const seenCustomers = new Set();
    let largeCount = 0;

    for (const contract of ordered) {
      const isLarge = contract.contractValue >= largeThreshold;
      if (isLarge) {
        largeCount += 1;
        events.push(buildProcurementEvent(contract, 'large_contract_award'));
        if (largeCount === 1) events.push(buildProcurementEvent(contract, 'first_large_contract'));
      }
      if (contract.customerRegion && seenRegions.size > 0 && !seenRegions.has(contract.customerRegion)) {
        events.push(buildProcurementEvent(contract, 'new_region'));
      }
      if (isLarge && seenCustomers.size > 0 && contract.customerInn && !seenCustomers.has(contract.customerInn)) {
        events.push(buildProcurementEvent(contract, 'new_major_customer'));
      }
      if (contract.customerRegion) seenRegions.add(contract.customerRegion);
      if (contract.customerInn) seenCustomers.add(contract.customerInn);
    }

    if (ordered.length >= 3) {
      events.push(buildProcurementEvent(ordered.at(-1), 'contract_series', { contract_count: ordered.length }));
    }

    const annual = new Map();
    for (const contract of ordered) {
      const year = contract.contractDate.slice(0, 4);
      annual.set(year, (annual.get(year) ?? 0) + contract.contractValue);
    }
    const years = [...annual.keys()].sort();
    if (years.length >= 2) {
      const previous = annual.get(years.at(-2));
      const latest = annual.get(years.at(-1));
      if (previous > 0 && latest / previous >= 1.5) {
        events.push(buildProcurementEvent(ordered.at(-1), 'significant_contract_volume_growth', {
          previous_annual_value: previous,
          current_annual_value: latest,
          change_ratio: (latest - previous) / previous,
        }));
      }
    }
  }

  return events;
}

export function normalizeGovernmentProcurementRecord(record, context) {
  return normalizeCompanyContextRecord(record, context, {
    sourceRecordType: 'government_contract_event',
    headline: `${record.company_name ?? `INN ${record.inn}`} — ${record.event_type}`,
    payload: {
      event_type: record.event_type,
      contract_number: record.contract_number,
      contract_date: record.contract_date,
      contract_value: record.contract_value,
      subject: record.subject,
      customer_inn: record.customer_inn,
      customer_name: record.customer_name,
      customer_region: record.customer_region,
      context_only: true,
      hiring_proof: false,
      ...(record.extra ?? {}),
    },
  });
}

export function normalizeCbrRegistryRecord(record, context) {
  const inn = normalizeLegalInn(record?.inn ?? record?.INN);
  if (!inn) return null;
  const sourceUrl = assertOfficialSourceUrl('cbr-registry', record.source_url ?? record.sourceUrl);
  if (!sourceUrl) return null;
  const companyName = toNonEmptyText(record.company_name ?? record.Name ?? record.ShortName);
  const ogrn = normalizeLegalOgrn(record.ogrn ?? record.OGRN);
  const identity = buildCompanyIdentity({ companyName, inn, ogrn, fallbackName: `INN ${inn}`, lineNumber: context.lineNumber });
  if (!identity) return null;
  const status = toNonEmptyText(record.status ?? record.Status);
  const participantTypes = stringArray(record.participant_types ?? record.participantTypes ?? record.FOTypes);
  const licenses = Array.isArray(record.licenses) ? record.licenses.map(normalizeLicense).filter(Boolean) : [];

  return {
    ...identity,
    fetchedAt: context.fetchedAt,
    occurredAt: toTimestampOrNull(record.updated_at) ?? context.fetchedAt,
    companyName,
    companyWebsiteUrl: null,
    inn,
    ogrn,
    orgExternalId: inn,
    signalExternalId: `cbr-registry:${inn}:${normalizeSourceKeyText(status) ?? 'unknown'}`,
    signalType: 'other',
    evidenceRole: 'context',
    sourceEntityType: 'legal_entity',
    sourceRecordType: 'financial_market_participant',
    headline: `${companyName ?? `INN ${inn}`} — реестр Банка России`,
    recordTitle: companyName ?? `INN ${inn}`,
    sourceUrl,
    summary: [status, ...participantTypes].filter(Boolean).join('; '),
    payload: {
      event_type: 'regulatory_registry_status',
      participant_types: participantTypes,
      status,
      active: status?.toLowerCase() === 'active',
      licenses,
      context_only: true,
      intent_signal: false,
      hiring_proof: false,
    },
  };
}

export function normalizeRosstatOpenDataRecord(record, context) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const sourceUrl = assertOfficialSourceUrl('rosstat-open-data', record.source_url ?? record.url);
  const datasetId = toNonEmptyText(record.dataset_id);
  const recordId = toNonEmptyText(record.record_id ?? record.id);
  const title = toNonEmptyText(record.title ?? record.indicator_name);
  if (!sourceUrl || !datasetId || !recordId || !title) return null;
  const primarySourceKey = `dataset:${normalizeSourceKeyText(datasetId)}`;
  const period = toNonEmptyText(record.period);

  return {
    orgName: `Rosstat aggregate ${datasetId}`,
    orgDisplayName: `Росстат: ${datasetId}`,
    companyName: null,
    companyDomain: null,
    companyWebsiteUrl: null,
    inn: null,
    ogrn: null,
    primarySourceKey,
    orgSourceKeys: [primarySourceKey],
    orgSourceAliasKeys: [],
    orgExternalId: datasetId,
    fetchedAt: context.fetchedAt,
    occurredAt: toTimestampOrNull(record.published_at) ?? context.fetchedAt,
    signalExternalId: `rosstat-open-data:${datasetId}:${recordId}`,
    signalType: 'other',
    evidenceRole: 'context',
    sourceEntityType: 'aggregate_market',
    sourceRecordType: 'aggregate_statistic',
    headline: title,
    recordTitle: title,
    sourceUrl,
    summary: [record.region, period, record.value, record.unit].map(toNonEmptyText).filter(Boolean).join('; '),
    payload: {
      event_type: 'market_baseline',
      dataset_id: datasetId,
      record_id: recordId,
      period,
      region: toNonEmptyText(record.region),
      industry: toNonEmptyText(record.industry),
      indicator: toNonEmptyText(record.indicator),
      value: finiteNumber(record.value),
      unit: toNonEmptyText(record.unit),
      aggregation_scope: toNonEmptyText(record.aggregation_scope) ?? (record.region ? 'region' : 'federal'),
      company_attributed: false,
      context_only: true,
      hiring_proof: false,
    },
  };
}

export function normalizeRospatentOpenDataRecord(record, context) {
  const inn = normalizeLegalInn(record?.applicant_inn ?? record?.inn);
  if (!inn) return null;
  const sourceUrl = assertOfficialSourceUrl('rospatent-open-data', record.source_url ?? record.url);
  if (!sourceUrl) return null;
  const companyName = toNonEmptyText(record.applicant_name ?? record.company_name);
  const identity = buildCompanyIdentity({ companyName, inn, fallbackName: `INN ${inn}`, lineNumber: context.lineNumber });
  if (!identity) return null;
  const recordId = toNonEmptyText(record.record_id ?? record.id ?? record.application_number);
  const recordType = toNonEmptyText(record.record_type ?? record.type) ?? 'intellectual_property';
  if (!recordId) return null;
  const title = toNonEmptyText(record.title ?? record.name) ?? `${recordType} ${recordId}`;
  const applicationDate = toTimestampOrNull(record.application_date);
  const registrationDate = toTimestampOrNull(record.registration_date);

  return {
    ...identity,
    fetchedAt: context.fetchedAt,
    occurredAt: registrationDate ?? applicationDate ?? context.fetchedAt,
    companyName,
    companyWebsiteUrl: null,
    inn,
    ogrn: null,
    orgExternalId: inn,
    signalExternalId: `rospatent-open-data:${recordType}:${recordId}`,
    signalType: 'other',
    evidenceRole: 'context',
    sourceEntityType: 'legal_entity',
    sourceRecordType: 'intellectual_property_record',
    headline: `${companyName ?? `INN ${inn}`} — ${title}`,
    recordTitle: title,
    sourceUrl,
    summary: [recordType, recordId, title].join('; '),
    payload: {
      event_type: 'intellectual_property_activity',
      record_type: recordType,
      record_id: recordId,
      title,
      application_date: applicationDate,
      registration_date: registrationDate,
      context_strength: 'weak',
      context_only: true,
      hiring_proof: false,
    },
  };
}

export function assertOfficialSourceUrl(sourceId, value) {
  const url = toUrlOrNull(value);
  const catalog = OFFICIAL_OPEN_DATA_CATALOG[sourceId];
  if (!url || !catalog) return null;
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') return null;
  return catalog.allowedHosts.includes(parsed.hostname.toLowerCase()) ? url : null;
}

function normalizeFnsRawRecord(record) {
  const inn = normalizeLegalInn(record?.inn ?? record?.INN ?? record?.['ИННЮЛ']);
  const dataset = normalizeSourceKeyText(record?.dataset ?? record?.dataset_type);
  const sourceUrl = assertOfficialSourceUrl('fns-open-data', record?.source_url ?? record?.url);
  const period = toNonEmptyText(record?.period ?? record?.year ?? record?.['ОтчПериод']);
  if (!inn || !dataset || !sourceUrl || !period) return null;
  return {
    inn,
    dataset,
    sourceUrl,
    period,
    companyName: toNonEmptyText(record.company_name ?? record.name ?? record['НаимОрг']),
    employeeCount: finiteNumber(record.employee_count ?? record.staff_count ?? record['КолРаб']),
    revenue: finiteNumber(record.revenue ?? record.income ?? record['СумДоход']),
    expenses: finiteNumber(record.expenses ?? record['СумРасход']),
    penaltyAmount: finiteNumber(record.penalty_amount ?? record['СумШтраф']),
    supportAmount: finiteNumber(record.support_amount ?? record['СумПоддерж']),
    supportType: toNonEmptyText(record.support_type ?? record['ВидПоддерж']),
    smeStatus: toNonEmptyText(record.sme_status ?? record.msp_category ?? record['КатСубМСП']),
    taxRegime: toNonEmptyText(record.tax_regime ?? record['РежимНалог']),
  };
}

function buildFnsEvent(record, event) {
  return {
    inn: record.inn,
    company_name: event.companyName,
    dataset: record.dataset,
    period: record.period,
    source_url: record.sourceUrl,
    event_type: event.eventType,
    external_id: `${record.dataset}:${record.period}:${record.inn}:${event.eventType}`,
    value: event.value,
    previous_value: event.previousValue ?? null,
    change_ratio: event.changeRatio ?? null,
    employee_count: record.employeeCount,
    revenue: record.revenue,
    expenses: event.expenses ?? record.expenses,
    company_size_band: event.sizeBand ?? null,
    sme_status: record.smeStatus,
    support_type: event.supportType ?? record.supportType,
    significant_financial_trajectory_change: event.significantTrajectoryChange === true,
  };
}

function normalizeProcurementRawRecord(record) {
  const inn = normalizeLegalInn(record?.supplier_inn ?? record?.inn);
  const contractNumber = toNonEmptyText(record?.contract_number ?? record?.reg_number ?? record?.id);
  const sourceUrl = assertOfficialSourceUrl('government-procurement', record?.source_url ?? record?.url);
  const contractDate = dateOnly(record?.contract_date ?? record?.sign_date ?? record?.date);
  const contractValue = finiteNumber(record?.contract_value ?? record?.price ?? record?.value);
  if (!inn || !contractNumber || !sourceUrl || !contractDate || contractValue === null) return null;
  return {
    inn,
    companyName: toNonEmptyText(record.supplier_name ?? record.company_name),
    ogrn: normalizeLegalOgrn(record.supplier_ogrn ?? record.ogrn),
    contractNumber,
    contractDate,
    contractValue,
    subject: toNonEmptyText(record.subject ?? record.contract_subject),
    customerInn: normalizeLegalInn(record.customer_inn),
    customerName: toNonEmptyText(record.customer_name),
    customerRegion: toNonEmptyText(record.customer_region ?? record.region),
    sourceUrl,
  };
}

function buildProcurementEvent(contract, eventType, extra = {}) {
  return {
    inn: contract.inn,
    ogrn: contract.ogrn,
    company_name: contract.companyName,
    event_type: eventType,
    external_id: `${contract.contractNumber}:${eventType}`,
    contract_number: contract.contractNumber,
    contract_date: contract.contractDate,
    contract_value: contract.contractValue,
    subject: contract.subject,
    customer_inn: contract.customerInn,
    customer_name: contract.customerName,
    customer_region: contract.customerRegion,
    source_url: contract.sourceUrl,
    extra,
  };
}

function normalizeCompanyContextRecord(record, context, options) {
  const inn = normalizeLegalInn(record?.inn);
  const ogrn = normalizeLegalOgrn(record?.ogrn);
  if (!inn) return null;
  const sourceUrl = assertOfficialSourceUrl(context.sourceId, record.source_url);
  if (!sourceUrl) return null;
  const companyName = toNonEmptyText(record.company_name);
  const identity = buildCompanyIdentity({ companyName, inn, ogrn, fallbackName: `INN ${inn}`, lineNumber: context.lineNumber });
  if (!identity) return null;
  const externalId = toNonEmptyText(record.external_id) ?? `${inn}:${record.event_type}:${context.lineNumber}`;
  const occurredAt = toTimestampOrNull(record.contract_date ?? record.period) ?? context.fetchedAt;
  return {
    ...identity,
    fetchedAt: context.fetchedAt,
    occurredAt,
    companyName,
    companyWebsiteUrl: null,
    inn,
    ogrn,
    orgExternalId: inn,
    signalExternalId: `${context.sourceId}:${externalId}`,
    signalType: 'other',
    evidenceRole: 'context',
    sourceEntityType: 'legal_entity',
    sourceRecordType: options.sourceRecordType,
    headline: options.headline,
    recordTitle: options.headline,
    sourceUrl,
    summary: [record.event_type, record.period, record.contract_number].map(toNonEmptyText).filter(Boolean).join('; '),
    payload: options.payload,
  };
}

function normalizeLicense(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    number: toNonEmptyText(value.number ?? value.LIC_Number),
    name: toNonEmptyText(value.name ?? value.LIC_Name ?? value.VidD),
    starts_at: toTimestampOrNull(value.starts_at ?? value.LIC_DTStart),
    ends_at: toTimestampOrNull(value.ends_at ?? value.LIC_DTEnd),
    active: typeof value.active === 'boolean' ? value.active : !toTimestampOrNull(value.ends_at ?? value.LIC_DTEnd),
  };
}

function groupBy(values, keyOf) {
  const grouped = new Map();
  for (const value of values) {
    const key = keyOf(value);
    const group = grouped.get(key) ?? [];
    group.push(value);
    grouped.set(key, group);
  }
  return grouped;
}

function comparePeriods(left, right) {
  return String(left.period).localeCompare(String(right.period), 'en', { numeric: true });
}

function numericChange(previous, current) {
  if (!Number.isFinite(previous) || !Number.isFinite(current) || previous === 0) {
    return { direction: 'flat', ratio: null };
  }
  const ratio = (current - previous) / Math.abs(previous);
  return { direction: ratio > 0 ? 'up' : ratio < 0 ? 'down' : 'flat', ratio };
}

function classifyCompanySize(value) {
  if (!Number.isFinite(value)) return null;
  if (value < 16) return 'micro';
  if (value < 101) return 'small';
  if (value < 251) return 'medium';
  return 'large';
}

function finiteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumber(value, fallback) {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : fallback;
}

function stringArray(value) {
  if (Array.isArray(value)) return value.map(toNonEmptyText).filter(Boolean);
  return parseCommaSeparated(toNonEmptyText(value));
}

function dateOnly(value) {
  const timestamp = toTimestampOrNull(value);
  return timestamp?.slice(0, 10) ?? null;
}
