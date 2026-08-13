#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { installGovernmentCaRuntime } from './adapters/government-ca-runtime.mjs';
import { activateValidatedSnapshot, resolveVersionedSnapshotOutput } from './adapters/snapshot-activation.mjs';
import { toNonEmptyText } from './adapters/rf-source-runtime.mjs';
import { fetchWithSourcePolicy } from './adapters/source-http.mjs';

const SOURCE_ID = 'rosstat-open-data';
const LIST_URL = 'https://rosstat.gov.ru/opendata/list.csv';
const MAX_LIST_BYTES = 4 * 1024 * 1024;
const MAX_META_BYTES = 256 * 1024;
const MAX_DATA_BYTES = 20 * 1024 * 1024;
const TARGET_TITLE = 'Уровень безработицы населения в возрасте 15 лет и старше по субъектам Российской Федерации';

installGovernmentCaRuntime();

export function assertOfficialRosstatDatasetUrl(value, { datasetId = null, kind = null } = {}) {
  let url;
  try { url = new URL(value); } catch { throw invalidRosstatUrl(); }
  if (url.protocol !== 'https:' || !['rosstat.gov.ru', 'www.rosstat.gov.ru'].includes(url.hostname.toLowerCase()) || url.username || url.password || url.search || url.hash) throw invalidRosstatUrl();
  if (url.pathname === '/opendata/list.csv') return url.href;
  const match = /^\/opendata\/(7708234640-[A-Za-z0-9_-]+)\/(meta\.csv|data-\d{8}T\d{4,6}-structure-\d{8}T\d{4,6}\.csv)$/.exec(url.pathname);
  if (!match || (datasetId && match[1] !== datasetId) || (kind === 'meta' && match[2] !== 'meta.csv') || (kind === 'data' && !match[2].startsWith('data-'))) throw invalidRosstatUrl();
  return url.href;
}

export async function discoverLatestRosstatDataset(fetchImpl = globalThis.fetch) {
  const list = await fetchRosstat(LIST_URL, fetchImpl, MAX_LIST_BYTES, 'Rosstat open-data catalog');
  const rows = parseDelimited(decodeUtf8(list.bytes), ',');
  const candidates = rows.slice(1).map((row) => ({ dataset_id: row[0]?.trim(), title: row[1]?.trim(), meta_url: row[2]?.trim() }))
    .filter((entry) => entry.dataset_id && entry.title?.startsWith(TARGET_TITLE) && !/^\s*\(Архив\)/i.test(entry.title))
    .slice(0, 12);
  if (candidates.length === 0) throw new Error('Rosstat catalog exposed no current regional unemployment dataset.');
  const datasets = [];
  for (const candidate of candidates) {
    const metaUrl = assertOfficialRosstatDatasetUrl(candidate.meta_url, { datasetId: candidate.dataset_id, kind: 'meta' });
    const metadata = await fetchRosstat(metaUrl, fetchImpl, MAX_META_BYTES, `Rosstat metadata ${candidate.dataset_id}`);
    const fields = new Map(parseDelimited(decodeRosstatMetadata(metadata.bytes), ',').slice(1).map((row) => [row[0]?.trim(), row.slice(1).join(',').trim()]));
    if (fields.get('identifier') !== candidate.dataset_id) throw new Error(`Rosstat metadata identifier mismatch for ${candidate.dataset_id}.`);
    const dataEntry = [...fields.entries()].find(([key, value]) => key?.startsWith('data-') && value?.startsWith('https://'));
    if (!dataEntry) throw new Error(`Rosstat metadata ${candidate.dataset_id} exposed no official data artifact.`);
    const dataUrl = assertOfficialRosstatDatasetUrl(dataEntry[1], { datasetId: candidate.dataset_id, kind: 'data' });
    const modified = compactDate(fields.get('modified'));
    const title = toNonEmptyText(fields.get('title')) ?? candidate.title;
    const period = inferQuarterPeriod(title);
    if (!modified || !period) throw new Error(`Rosstat metadata ${candidate.dataset_id} has no valid modified date or quarter.`);
    datasets.push({
      dataset_id: candidate.dataset_id,
      title,
      meta_url: metaUrl,
      data_url: dataUrl,
      modified,
      published_at: modified,
      period,
      metadata_sha256: sha256(metadata.bytes),
      metadata_bytes: metadata.bytes.length,
    });
  }
  return datasets.sort((left, right) => right.modified.localeCompare(left.modified) || right.dataset_id.localeCompare(left.dataset_id))[0];
}

export function parseRosstatAggregateCsv(csv, { dataset }) {
  const datasetId = toNonEmptyText(dataset?.dataset_id);
  const sourceUrl = assertOfficialRosstatDatasetUrl(dataset?.data_url, { datasetId, kind: 'data' });
  const period = /^\d{4}-Q[1-4]$/.test(dataset?.period ?? '') ? dataset.period : null;
  const title = toNonEmptyText(dataset?.title);
  const publishedAt = dateOnly(dataset?.published_at);
  if (!datasetId || !period || !title || !publishedAt) throw new Error('Rosstat aggregate parser requires validated dataset metadata.');
  const rows = parseDelimited(String(csv), ';').filter((row) => row.some((value) => value.trim() !== ''));
  if (rows.length < 2) throw new Error('Rosstat aggregate CSV contains no data rows.');
  const headers = rows[0].map((value) => value.replace(/^\uFEFF/, '').trim().toLowerCase());
  if (headers[0] !== 'territories' || headers[1] !== 'indicators') throw new Error('Rosstat aggregate CSV is missing territories/indicators columns.');
  const records = [];
  const seen = new Set();
  for (const row of rows.slice(1)) {
    const region = toNonEmptyText(row[0]);
    const value = decimalNumber(row[1]);
    if (!region || value === null || value < 0 || value > 100) continue;
    const slug = transliterateSlug(region);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    records.push({
      dataset_id: datasetId,
      record_id: `${period}:${slug}`,
      title: `Уровень безработицы — ${region}`,
      period,
      region,
      indicator: 'unemployment_rate',
      value,
      unit: 'percent',
      aggregation_scope: aggregationScope(region),
      source_url: sourceUrl,
      published_at: publishedAt,
    });
  }
  if (records.length === 0) throw new Error('Rosstat aggregate CSV produced no validated records.');
  return records;
}

export function buildRosstatSnapshot({ records, dataset, generatedAt = new Date().toISOString() }) {
  validateDatasetReceipt(dataset);
  const keyed = new Map();
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    if (record.inn != null || record.ogrn != null || record.company_name != null || record.company_domain != null) continue;
    if (record.dataset_id !== dataset.dataset_id || record.source_url !== dataset.data_url || !/^\d{4}-Q[1-4]:[a-z0-9-]+$/.test(record.record_id ?? '')) continue;
    const value = decimalNumber(record.value);
    if (!toNonEmptyText(record.title) || !toNonEmptyText(record.region) || value === null || value < 0 || value > 100) continue;
    keyed.set(record.record_id, { ...record, value });
  }
  const rosstat = [...keyed.values()].sort((left, right) => left.record_id.localeCompare(right.record_id));
  if (rosstat.length === 0) throw new Error('Rosstat snapshot has no validated aggregate records.');
  return {
    schema_version: 1,
    source_id: SOURCE_ID,
    generated_at: generatedAt,
    dataset: { ...dataset, records: rosstat.length },
    rosstat,
  };
}

export async function syncRosstatOpenDataSnapshot({
  outputFile,
  fetchImpl = globalThis.fetch,
  activate = true,
  activationRootDirectory,
  validateOnly = false,
}) {
  const outputPath = outputFile ? resolve(outputFile) : null;
  if (!validateOnly && !outputPath) throw new Error('Rosstat sync requires an output file unless validateOnly is enabled.');
  if (outputPath && await exists(outputPath)) throw new Error(`Refusing to overwrite existing snapshot: ${outputPath}`);
  if (outputPath) await mkdir(dirname(outputPath), { recursive: true });
  const temporaryOutput = outputPath ? join(dirname(outputPath), `.${basename(outputPath)}.${process.pid}.tmp`) : null;
  try {
    const discovered = await discoverLatestRosstatDataset(fetchImpl);
    const downloaded = await fetchRosstat(discovered.data_url, fetchImpl, MAX_DATA_BYTES, `Rosstat aggregate dataset ${discovered.dataset_id}`);
    const records = parseRosstatAggregateCsv(decodeUtf8(downloaded.bytes), { dataset: discovered });
    const dataset = { ...discovered, sha256: sha256(downloaded.bytes), bytes: downloaded.bytes.length };
    const snapshot = buildRosstatSnapshot({ records, dataset });
    if (validateOnly) return { outputFile: null, snapshot, activation: null, validatedOnly: true };
    await writeFile(temporaryOutput, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryOutput, outputPath);
    const activation = activate ? await activateValidatedSnapshot({
      sourceId: SOURCE_ID,
      snapshotFile: outputPath,
      recordCount: snapshot.rosstat.length,
      sourceUrls: [dataset.data_url],
      ...(activationRootDirectory ? { rootDirectory: activationRootDirectory } : {}),
    }) : null;
    return { outputFile: outputPath, snapshot, activation, validatedOnly: false };
  } finally {
    if (temporaryOutput) await rm(temporaryOutput, { force: true });
  }
}

async function fetchRosstat(url, fetchImpl, maxBytes, sourceName) {
  const officialUrl = assertOfficialRosstatDatasetUrl(url);
  const response = await fetchWithSourcePolicy(officialUrl, {
    fetchImpl, headers: { accept: 'text/csv,text/plain' }, redirect: 'follow', retries: 2, sourceName, timeoutMs: 45_000,
  });
  if (!response.ok) throw new Error(`${sourceName} returned HTTP ${response.status}.`);
  const finalUrl = assertOfficialRosstatDatasetUrl(response.url || officialUrl);
  if (finalUrl !== officialUrl) throw new Error(`${sourceName} redirected to a different artifact.`);
  const contentLength = response.headers.get('content-length');
  const declared = contentLength === null ? null : Number(contentLength);
  if (declared !== null && (!Number.isSafeInteger(declared) || declared < 1 || declared > maxBytes)) throw new Error(`${sourceName} content-length exceeds the ${maxBytes}-byte safety limit.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1 || bytes.length > maxBytes) throw new Error(`${sourceName} body must be between 1 and ${maxBytes} bytes.`);
  return { bytes, finalUrl };
}

function parseDelimited(value, delimiter) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quoted) {
      if (char === '"' && value[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === '') quoted = true;
    else if (char === delimiter) { row.push(field); field = ''; }
    else if (char === '\r' || char === '\n') {
      row.push(field); field = ''; rows.push(row); row = [];
      if (char === '\r' && value[index + 1] === '\n') index += 1;
    } else field += char;
  }
  if (quoted) throw new Error('CSV ended inside a quoted field.');
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function decodeRosstatMetadata(bytes) {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  const replacements = [...utf8].filter((char) => char === '\uFFFD').length;
  return replacements > 2 ? new TextDecoder('windows-1251').decode(bytes) : utf8;
}
function decodeUtf8(bytes) { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
function inferQuarterPeriod(title) {
  const match = /\b(I{1,3}|IV)\s+квартал[ае]?\s+(\d{4})\s*г/i.exec(title ?? '');
  const quarter = { I: 1, II: 2, III: 3, IV: 4 }[match?.[1]?.toUpperCase()];
  return quarter ? `${match[2]}-Q${quarter}` : null;
}
function compactDate(value) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(toNonEmptyText(value) ?? '');
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}
function dateOnly(value) { const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(toNonEmptyText(value) ?? ''); return match ? `${match[1]}-${match[2]}-${match[3]}` : null; }
function decimalNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
function aggregationScope(region) {
  if (/российская\s+феде[рp]ация/i.test(region)) return 'federal';
  if (/федеральный\s+округ/i.test(region)) return 'federal-district';
  return 'region';
}
function transliterateSlug(value) {
  const map = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'iu', я: 'ia',
  };
  return [...String(value).toLowerCase()].map((char) => map[char] ?? char).join('').normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 160);
}
function validateDatasetReceipt(dataset) {
  if (!dataset || !toNonEmptyText(dataset.dataset_id)) throw new Error('Rosstat dataset metadata is missing.');
  assertOfficialRosstatDatasetUrl(dataset.data_url, { datasetId: dataset.dataset_id, kind: 'data' });
  if (!/^[a-f0-9]{64}$/i.test(dataset.sha256 ?? '') || !Number.isSafeInteger(dataset.bytes) || dataset.bytes < 1) throw new Error('Rosstat dataset failed checksum/size validation.');
}
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function invalidRosstatUrl() { return new Error('Invalid official Rosstat dataset URL.'); }
async function exists(path) { try { await access(path); return true; } catch { return false; } }

function parseCli(argv) {
  const options = { outputFile: null, validateOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--output') options.outputFile = argv[++index];
    else if (argv[index] === '--validate-only') options.validateOnly = true;
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!options.validateOnly) options.outputFile ??= process.env.ROSSTAT_OPEN_DATA_SYNC_OUTPUT_FILE?.trim() ?? resolveVersionedSnapshotOutput(SOURCE_ID);
  return options;
}

async function main() {
  const result = await syncRosstatOpenDataSnapshot(parseCli(process.argv.slice(2)));
  console.log(JSON.stringify({
    ok: true, source: SOURCE_ID, outputFile: result.outputFile,
    dataset: result.snapshot.dataset.dataset_id, period: result.snapshot.dataset.period,
    records: result.snapshot.rosstat.length, activated: Boolean(result.activation), validatedOnly: result.validatedOnly === true,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
