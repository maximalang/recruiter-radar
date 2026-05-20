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

export function buildRussianLegalNameSourceKey(value) {
  const normalizedName = normalizeRussianLegalName(value);
  return normalizedName ? `ru-legal-name:${normalizedName}` : null;
}

export function buildSourceKeyAliases(sourceKeys, aliasKeys = [], currentSourceKey = null) {
  return [...asArray(sourceKeys), ...asArray(aliasKeys)].filter(
    (sourceKey, index, sourceKeyList) => Boolean(sourceKey)
      && sourceKey !== currentSourceKey
      && sourceKeyList.indexOf(sourceKey) === index,
  );
}

export function normalizeRussianLegalName(value) {
  const normalizedText = normalizeLegalNameText(value);

  if (!normalizedText || isRussianSoleProprietorName(normalizedText)) {
    return null;
  }

  let strippedText = normalizedText;
  let legalFormRemoved = false;

  for (const legalForm of RUSSIAN_LEGAL_FORMS) {
    const nextText = stripLegalForm(strippedText, legalForm);

    if (nextText !== strippedText) {
      legalFormRemoved = true;
      strippedText = nextText;
    }
  }

  if (!legalFormRemoved) {
    return null;
  }

  strippedText = compactLegalNameText(strippedText);

  return strippedText.length >= 3 ? strippedText : null;
}

export function isRussianSoleProprietorName(value) {
  const normalizedText = normalizeLegalNameText(value);

  if (!normalizedText) {
    return false;
  }

  return normalizedText === '\u0438\u043f'
    || normalizedText.startsWith('\u0438\u043f ')
    || normalizedText.startsWith('\u0438 \u043f ')
    || normalizedText === '\u0438\u043d\u0434\u0438\u0432\u0438\u0434\u0443\u0430\u043b\u044c\u043d\u044b\u0439 \u043f\u0440\u0435\u0434\u043f\u0440\u0438\u043d\u0438\u043c\u0430\u0442\u0435\u043b\u044c'
    || normalizedText.startsWith('\u0438\u043d\u0434\u0438\u0432\u0438\u0434\u0443\u0430\u043b\u044c\u043d\u044b\u0439 \u043f\u0440\u0435\u0434\u043f\u0440\u0438\u043d\u0438\u043c\u0430\u0442\u0435\u043b\u044c ');
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

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  return value ? [value] : [];
}

const RUSSIAN_LEGAL_FORMS = Object.freeze([
  '\u043e\u0431\u0449\u0435\u0441\u0442\u0432\u043e \u0441 \u043e\u0433\u0440\u0430\u043d\u0438\u0447\u0435\u043d\u043d\u043e\u0439 \u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043d\u043d\u043e\u0441\u0442\u044c\u044e',
  '\u043f\u0443\u0431\u043b\u0438\u0447\u043d\u043e\u0435 \u0430\u043a\u0446\u0438\u043e\u043d\u0435\u0440\u043d\u043e\u0435 \u043e\u0431\u0449\u0435\u0441\u0442\u0432\u043e',
  '\u043e\u0442\u043a\u0440\u044b\u0442\u043e\u0435 \u0430\u043a\u0446\u0438\u043e\u043d\u0435\u0440\u043d\u043e\u0435 \u043e\u0431\u0449\u0435\u0441\u0442\u0432\u043e',
  '\u0437\u0430\u043a\u0440\u044b\u0442\u043e\u0435 \u0430\u043a\u0446\u0438\u043e\u043d\u0435\u0440\u043d\u043e\u0435 \u043e\u0431\u0449\u0435\u0441\u0442\u0432\u043e',
  '\u0430\u043a\u0446\u0438\u043e\u043d\u0435\u0440\u043d\u043e\u0435 \u043e\u0431\u0449\u0435\u0441\u0442\u0432\u043e',
  '\u0430\u0432\u0442\u043e\u043d\u043e\u043c\u043d\u0430\u044f \u043d\u0435\u043a\u043e\u043c\u043c\u0435\u0440\u0447\u0435\u0441\u043a\u0430\u044f \u043e\u0440\u0433\u0430\u043d\u0438\u0437\u0430\u0446\u0438\u044f',
  '\u043d\u0435\u043a\u043e\u043c\u043c\u0435\u0440\u0447\u0435\u0441\u043a\u0430\u044f \u043e\u0440\u0433\u0430\u043d\u0438\u0437\u0430\u0446\u0438\u044f',
  '\u043e \u043e \u043e',
  '\u043e\u043e\u043e',
  '\u043f\u0430\u043e',
  '\u043e\u0430\u043e',
  '\u0437\u0430\u043e',
  '\u0430\u043e',
]);

function stripLegalForm(value, legalForm) {
  return (' ' + value + ' ').replaceAll(' ' + legalForm + ' ', ' ').trim();
}

function normalizeLegalNameText(value) {
  const text = toNonEmptyText(value);

  if (!text) {
    return null;
  }

  let normalized = '';

  for (const char of text.toLowerCase().replaceAll('\u0451', '\u0435')) {
    normalized += isLegalNameSeparatorChar(char) ? ' ' : char;
  }

  return compactLegalNameText(normalized);
}

function compactLegalNameText(value) {
  return value.trim().replace(/\s+/g, ' ');
}

function isLegalNameSeparatorChar(char) {
  const code = char.charCodeAt(0);
  return code === 34
    || code === 39
    || code === 40
    || code === 41
    || code === 44
    || code === 45
    || code === 46
    || code === 58
    || code === 59
    || code === 171
    || code === 187
    || code === 8211
    || code === 8212
    || code === 8216
    || code === 8217
    || code === 8220
    || code === 8221
    || code === 8222;
}
