import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import { canonicalizePublicUrl } from './site-discovery.mjs';

const MAX_ENTRIES = 10_000;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1_000;
const ALLOWED_STAGES = new Set([
  'official-feed',
  'static-http',
  'structured-data',
  'rendered-dom',
  'extraction',
]);

export function shouldSkipExpensiveCareerFallback(previous, current) {
  if (previous?.reusableStatic !== true) return false;
  if (!previous?.extractionVersion || previous.extractionVersion !== current?.extractionVersion) return false;
  if (current?.notModified === true) return true;
  return isContentHash(previous?.contentHash)
    && previous.contentHash === current?.contentHash;
}

export function createCareerPagesIncrementalState({
  filePath,
  now = Date.now,
  maxEntries = MAX_ENTRIES,
  maxAgeMs = MAX_AGE_MS,
} = {}) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new TypeError('career-pages incremental state requires filePath');
  }
  const entries = loadEntries(filePath);
  let dirty = false;

  return {
    get(url) {
      const key = stateKey(url);
      return key ? entries.get(key) ?? null : null;
    },
    update(url, value) {
      const key = stateKey(url);
      if (!key) return false;
      entries.set(key, sanitizeEntry(value, now));
      dirty = true;
      return true;
    },
    flush() {
      if (!dirty) return false;
      const nowMs = Number(now());
      const retained = [...entries.entries()]
        .filter(([, entry]) => {
          const checkedAtMs = Date.parse(entry.checkedAt);
          return !Number.isFinite(nowMs)
            || !Number.isFinite(checkedAtMs)
            || nowMs - checkedAtMs <= maxAgeMs;
        })
        .sort((left, right) => Date.parse(right[1].checkedAt) - Date.parse(left[1].checkedAt))
        .slice(0, Math.max(1, maxEntries));
      const output = {
        schemaVersion: 1,
        targets: Object.fromEntries(retained),
      };
      const temporaryPath = `${filePath}.tmp`;
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(temporaryPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
      renameSync(temporaryPath, filePath);
      dirty = false;
      return true;
    },
  };
}

function loadEntries(filePath) {
  if (!existsSync(filePath)) return new Map();
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
    if (parsed?.schemaVersion !== 1 || !parsed.targets || typeof parsed.targets !== 'object') {
      return new Map();
    }
    return new Map(Object.entries(parsed.targets)
      .map(([key, value]) => [stateKey(key), sanitizeLoadedEntry(value)])
      .filter(([key, value]) => key && value));
  } catch {
    return new Map();
  }
}

function sanitizeEntry(value, now) {
  const timestamp = Number(now());
  return {
    etag: boundedHeader(value?.etag),
    lastModified: boundedHeader(value?.lastModified),
    contentHash: isContentHash(value?.contentHash) ? value.contentHash : null,
    reusableStatic: value?.reusableStatic === true,
    selectedStage: ALLOWED_STAGES.has(value?.selectedStage) ? value.selectedStage : null,
    extractionVersion: boundedVersion(value?.extractionVersion),
    checkedAt: new Date(Number.isFinite(timestamp) ? timestamp : Date.now()).toISOString(),
  };
}

function sanitizeLoadedEntry(value) {
  if (!value || typeof value !== 'object') return null;
  const checkedAtMs = Date.parse(value.checkedAt);
  if (!Number.isFinite(checkedAtMs)) return null;
  return {
    etag: boundedHeader(value.etag),
    lastModified: boundedHeader(value.lastModified),
    contentHash: isContentHash(value.contentHash) ? value.contentHash : null,
    reusableStatic: value.reusableStatic === true,
    selectedStage: ALLOWED_STAGES.has(value.selectedStage) ? value.selectedStage : null,
    extractionVersion: boundedVersion(value.extractionVersion),
    checkedAt: new Date(checkedAtMs).toISOString(),
  };
}

function stateKey(value) {
  let input;
  try {
    input = new URL(value);
  } catch {
    return null;
  }
  if (input.username || input.password) return null;
  return canonicalizePublicUrl(input.toString());
}

function boundedHeader(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= 512 ? text : null;
}

function isContentHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function boundedVersion(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return /^[a-z0-9._-]{1,40}$/i.test(text) ? text : null;
}
