import { createHash } from 'node:crypto';

const TITLE_STOP_WORDS = new Set([
  'в', 'на', 'и', 'или', 'для', 'по', 'к', 'из', 'the', 'a', 'an', 'of', 'for', 'to', 'in',
]);

/**
 * Cross-source vacancy identity deliberately requires a canonical organization
 * identity. Name-only company matching is never sufficient for cross-posting.
 */
export function buildCanonicalVacancyIdentity(record) {
  const organizationKey = resolveStrongOrganizationKey(record);
  const title = normalizeVacancyTitle(record?.title ?? record?.name ?? record?.position);
  if (!organizationKey || !title) return null;

  const location = normalizeLocation(record?.location ?? record?.area ?? record?.city);
  const employment = normalizeToken(record?.employment ?? record?.employmentType ?? record?.employment_type);
  const schedule = normalizeToken(record?.schedule ?? record?.workFormat ?? record?.work_format);
  const descriptionTokens = tokenizeDescription(record?.description ?? record?.descriptionText ?? record?.body);
  const descriptionSignature = buildDescriptionSignature(descriptionTokens);

  return Object.freeze({
    organizationKey,
    title,
    location,
    employment,
    schedule,
    descriptionTokens,
    descriptionSignature,
    exactFingerprint: hash([
      organizationKey,
      title,
      location ?? '',
      employment ?? '',
      schedule ?? '',
      descriptionSignature ?? '',
    ].join('|')),
  });
}

export function areLikelyCrossPostedVacancies(leftRecord, rightRecord, options = {}) {
  const left = buildCanonicalVacancyIdentity(leftRecord);
  const right = buildCanonicalVacancyIdentity(rightRecord);
  if (!left || !right) return false;
  if (left.organizationKey !== right.organizationKey) return false;
  if (left.title !== right.title) return false;

  const locationCompatible = !left.location || !right.location || left.location === right.location;
  if (!locationCompatible) return false;

  if (left.exactFingerprint === right.exactFingerprint) return true;

  const minDescriptionSimilarity = options.minDescriptionSimilarity ?? 0.72;
  const similarity = jaccard(left.descriptionTokens, right.descriptionTokens);
  if (similarity !== null && similarity >= minDescriptionSimilarity) return true;

  // Very short descriptions do not carry enough entropy. In that case require
  // both employment and schedule to agree instead of guessing from title alone.
  return similarity === null
    && Boolean(left.employment && right.employment && left.employment === right.employment)
    && Boolean(left.schedule && right.schedule && left.schedule === right.schedule);
}

export function clusterCrossPostedVacancies(records, options = {}) {
  const clusters = [];
  for (const record of records ?? []) {
    let cluster = null;
    for (const candidate of clusters) {
      if (areLikelyCrossPostedVacancies(candidate.records[0], record, options)) {
        cluster = candidate;
        break;
      }
    }
    if (!cluster) {
      const identity = buildCanonicalVacancyIdentity(record);
      cluster = {
        canonicalDemandId: identity?.exactFingerprint ?? `unresolved:${clusters.length + 1}`,
        records: [],
      };
      clusters.push(cluster);
    }
    cluster.records.push(record);
  }

  return Object.freeze(clusters.map((cluster) => Object.freeze({
    canonicalDemandId: cluster.canonicalDemandId,
    records: Object.freeze([...cluster.records]),
    duplicateCount: Math.max(0, cluster.records.length - 1),
  })));
}

export function normalizeVacancyTitle(value) {
  const tokens = normalizeText(value)
    ?.split(' ')
    .filter((token) => token && !TITLE_STOP_WORDS.has(token));
  return tokens?.length ? tokens.join(' ') : null;
}

function resolveStrongOrganizationKey(record) {
  const explicit = nonEmptyText(record?.canonicalOrgId ?? record?.canonical_org_id ?? record?.orgId ?? record?.org_id);
  if (explicit) return `org:${explicit}`;

  const keys = [
    ...(Array.isArray(record?.orgSourceKeys) ? record.orgSourceKeys : []),
    ...(Array.isArray(record?.organizationKeys) ? record.organizationKeys : []),
  ];
  const strong = keys.find((key) => /^(inn:\d{10}|ogrn:\d{13}|domain:[a-z0-9.-]+)$/.test(String(key)));
  return strong ? String(strong) : null;
}

function normalizeLocation(value) {
  if (Array.isArray(value)) value = value.join(' ');
  const text = normalizeText(value);
  if (!text) return null;
  return text
    .replace(/\b(город|г|область|обл|район|р-н)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

function normalizeToken(value) {
  return normalizeText(value)?.replace(/\s+/g, '-') ?? null;
}

function tokenizeDescription(value) {
  const text = normalizeText(value);
  if (!text) return Object.freeze([]);
  const tokens = text.split(' ').filter((token) => token.length >= 3);
  const unique = [...new Set(tokens)].slice(0, 400);
  return Object.freeze(unique);
}

function buildDescriptionSignature(tokens) {
  if (!Array.isArray(tokens) || tokens.length < 8) return null;
  return hash([...tokens].sort().join('|')).slice(0, 24);
}

function jaccard(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length < 8 || right.length < 8) return null;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  for (const token of leftSet) if (rightSet.has(token)) intersection += 1;
  const union = leftSet.size + rightSet.size - intersection;
  return union > 0 ? intersection / union : null;
}

function normalizeText(value) {
  const text = nonEmptyText(value);
  if (!text) return null;
  return text
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[^a-zа-я0-9+#.]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

function nonEmptyText(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}
