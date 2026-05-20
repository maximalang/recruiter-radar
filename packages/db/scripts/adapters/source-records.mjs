export function stripBom(value) {
  if (typeof value !== 'string') {
    return value;
  }

  return value
    .replace(/^\uFEFF/, '')
    .replace(/^\u00EF\u00BB\u00BF/, '')
    .replace(/^\u043F\u00BB\u0457/, '');
}

export function dedupeNormalizedRecords(records, keySelector = defaultNormalizedRecordKey) {
  const seen = new Set();
  const deduped = [];
  let duplicateRecords = 0;

  for (const record of records) {
    const dedupeKey = keySelector(record);

    if (!dedupeKey) {
      deduped.push(record);
      continue;
    }

    if (seen.has(dedupeKey)) {
      duplicateRecords += 1;
      continue;
    }

    seen.add(dedupeKey);
    deduped.push(record);
  }

  return { records: deduped, duplicateRecords };
}

function defaultNormalizedRecordKey(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  return toNonEmptyText(record.signalExternalId)
    ?? toNonEmptyText(record.signalExternalID)
    ?? toNonEmptyText(record.signal_external_id)
    ?? null;
}

function toNonEmptyText(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}
