#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import tls from 'node:tls';

import { activateValidatedSnapshot } from './adapters/snapshot-activation.mjs';
import { normalizeLegalInn, parseCommaSeparated, toNonEmptyText } from './adapters/rf-source-runtime.mjs';
import { fetchWithSourcePolicy } from './adapters/source-http.mjs';

const SOURCE_ID = 'rospatent-open-data';
const META_URL = 'https://rospatent.gov.ru/opendata/7730176088-tz/meta.csv';
const DATASET_PATH = '/opendata/7730176088-tz/';
const MAX_BYTES = 1_000_000_000;
const DEFAULT_RANGE_BYTES = 8 * 1024 * 1024;

// Add OS-trusted roots to Node's bundled roots without disabling TLS checks.
if (typeof tls.getCACertificates === 'function' && typeof tls.setDefaultCACertificates === 'function') {
  tls.setDefaultCACertificates([
    ...tls.getCACertificates('default'),
    ...tls.getCACertificates('system'),
  ]);
}

export function assertOfficialRospatentDatasetUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw invalidDatasetUrl(); }
  if (
    url.protocol !== 'https:'
    || !['rospatent.gov.ru', 'www.rospatent.gov.ru'].includes(url.hostname.toLowerCase())
    || !url.pathname.startsWith(DATASET_PATH)
    || !/^data-\d{8}-structure-\d{8}\.csv$/i.test(basename(url.pathname))
    || url.search || url.hash || url.username || url.password
  ) throw invalidDatasetUrl();
  return url.href;
}

export async function discoverLatestRospatentDatasetUrl(fetchImpl = globalThis.fetch) {
  const response = await fetchWithSourcePolicy(META_URL, {
    fetchImpl,
    headers: { accept: 'text/csv' },
    redirect: 'follow',
    sourceName: 'Rospatent trademark open-data metadata',
    timeoutMs: 30_000,
  });
  if (!response.ok) throw new Error(`Rospatent metadata returned HTTP ${response.status}.`);
  if (new URL(response.url || META_URL).href !== META_URL) {
    throw new Error('Rospatent metadata redirected away from the canonical official URL.');
  }
  const candidates = (await response.text()).split(/\r?\n/)
    .map((line) => line.split(';').at(-1)?.trim())
    .filter((value) => {
      try { assertOfficialRospatentDatasetUrl(value); return true; } catch { return false; }
    })
    .sort((left, right) => datasetDate(right).localeCompare(datasetDate(left)) || right.localeCompare(left));
  if (candidates.length === 0) throw new Error('Rospatent metadata exposed no official trademark dataset URL.');
  return candidates[0];
}

export async function parseRospatentCsvStream(readable, { sourceUrl, trackedInns, maxRecords = 100_000 }) {
  const officialSourceUrl = assertOfficialRospatentDatasetUrl(sourceUrl);
  const allowed = trackedInnSet(trackedInns);
  if (allowed.size === 0) throw new Error('At least one tracked 10-digit legal-entity INN is required.');
  const records = [];
  let headers = null;
  const decoder = new TextDecoder('utf-8');
  const parser = createCsvRowParser((row) => {
    if (!headers) {
      headers = row.map((value, index) => normalizeHeader(index === 0 ? value.replace(/^\uFEFF/, '') : value));
      for (const required of ['registration number', 'right holder name', 'right holder inn']) {
        if (!headers.includes(required)) throw new Error(`Rospatent CSV is missing required column: ${required}.`);
      }
      return;
    }
    if (row.every((value) => value === '')) return;
    const raw = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']));
    const inn = normalizeLegalInn(raw['right holder inn']);
    const recordId = toNonEmptyText(raw['registration number']);
    const name = toNonEmptyText(raw['right holder name']);
    if (!inn || !allowed.has(inn) || !recordId || !name) return;
    records.push({
      applicant_inn: inn,
      applicant_name: name,
      record_id: recordId,
      application_number: toNonEmptyText(raw['application number']),
      record_type: 'trademark',
      title: `Trademark registration ${recordId}`,
      application_date: compactDate(raw['application date']),
      registration_date: compactDate(raw['registration date']),
      source_url: officialSourceUrl,
    });
    if (records.length > maxRecords) throw new Error(`Rospatent filtered records exceeded the ${maxRecords}-record safety limit.`);
  });
  for await (const chunk of readable) parser.write(typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }));
  parser.write(decoder.decode());
  parser.close();
  return records;
}

export function buildRospatentSnapshot({ records, trackedInns, dataset, generatedAt = new Date().toISOString() }) {
  const allowed = trackedInnSet(trackedInns);
  const sourceUrl = assertOfficialRospatentDatasetUrl(dataset.source_url);
  if (!/^[a-f0-9]{64}$/i.test(dataset.sha256 ?? '') || !Number.isSafeInteger(dataset.bytes) || dataset.bytes < 1) {
    throw new Error('Rospatent dataset metadata failed checksum/size validation.');
  }
  const keyed = new Map();
  for (const record of records) {
    const inn = normalizeLegalInn(record?.applicant_inn);
    const recordId = toNonEmptyText(record?.record_id);
    if (inn && allowed.has(inn) && recordId && record?.source_url === sourceUrl) {
      keyed.set(`${inn}:${recordId}`, { ...record, applicant_inn: inn, record_id: recordId });
    }
  }
  const rospatent = [...keyed.values()].sort((left, right) => (
    left.applicant_inn.localeCompare(right.applicant_inn)
    || left.record_id.localeCompare(right.record_id, 'en', { numeric: true })
  ));
  if (rospatent.length === 0) throw new Error('Rospatent snapshot has no deterministically validated records for tracked INNs.');
  return {
    schema_version: 1,
    source_id: SOURCE_ID,
    generated_at: generatedAt,
    tracked_inns: [...allowed].sort(),
    dataset: { ...dataset, source_url: sourceUrl, records: rospatent.length },
    rospatent,
  };
}

export async function syncRospatentOpenDataSnapshot({
  outputFile,
  trackedInns,
  fetchImpl = globalThis.fetch,
  rangeBytes = DEFAULT_RANGE_BYTES,
  activate = true,
  activationRootDirectory,
  validateOnly = false,
}) {
  const outputPath = outputFile ? resolve(outputFile) : null;
  const allowed = trackedInnSet(trackedInns);
  if (allowed.size === 0) throw new Error('At least one tracked 10-digit legal-entity INN is required.');
  if (!Number.isSafeInteger(rangeBytes) || rangeBytes < 1 || rangeBytes > 64 * 1024 * 1024) {
    throw new Error('Rospatent range size must be between 1 byte and 64 MiB.');
  }
  if (!validateOnly && !outputPath) throw new Error('Rospatent sync requires an output file unless validateOnly is enabled.');
  if (outputPath && await exists(outputPath)) throw new Error(`Refusing to overwrite existing snapshot: ${outputPath}`);
  if (outputPath) await mkdir(dirname(outputPath), { recursive: true });
  const temporaryOutput = outputPath ? join(dirname(outputPath), `.${basename(outputPath)}.${process.pid}.tmp`) : null;
  try {
    const sourceUrl = await discoverLatestRospatentDatasetUrl(fetchImpl);
    const download = await createDatasetStream({ sourceUrl, fetchImpl, rangeBytes });
    const records = await parseRospatentCsvStream(download.readable, { sourceUrl, trackedInns: allowed });
    const snapshot = buildRospatentSnapshot({ records, trackedInns: allowed, dataset: download.metadata() });
    if (validateOnly) return { outputFile: null, snapshot, activation: null, validatedOnly: true };
    await writeFile(temporaryOutput, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryOutput, outputPath);
    const activation = activate ? await activateValidatedSnapshot({
      sourceId: SOURCE_ID,
      snapshotFile: outputPath,
      recordCount: snapshot.rospatent.length,
      sourceUrls: [sourceUrl],
      ...(activationRootDirectory ? { rootDirectory: activationRootDirectory } : {}),
    }) : null;
    return { outputFile: outputPath, snapshot, activation, validatedOnly: false };
  } finally {
    if (temporaryOutput) await rm(temporaryOutput, { force: true });
  }
}

async function createDatasetStream({ sourceUrl, fetchImpl, rangeBytes }) {
  const officialUrl = assertOfficialRospatentDatasetUrl(sourceUrl);
  const response = await fetchWithSourcePolicy(officialUrl, {
    fetchImpl, method: 'HEAD', redirect: 'follow', sourceName: 'Rospatent trademark dataset metadata', timeoutMs: 30_000,
  });
  if (!response.ok) throw new Error(`Rospatent dataset metadata returned HTTP ${response.status}.`);
  if (assertOfficialRospatentDatasetUrl(response.url || officialUrl) !== officialUrl) throw new Error('Rospatent dataset redirected to a different artifact.');
  const bytes = Number(response.headers.get('content-length'));
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_BYTES) throw new Error(`Rospatent dataset content-length must be between 1 and ${MAX_BYTES} bytes.`);
  const digest = createHash('sha256');
  let downloaded = 0;
  let completed = false;
  async function* readable() {
    for (let start = 0; start < bytes; start += rangeBytes) {
      const end = Math.min(bytes - 1, start + rangeBytes - 1);
      const chunk = await fetchRange({ officialUrl, start, end, bytes, fetchImpl });
      digest.update(chunk);
      downloaded += chunk.length;
      yield chunk;
    }
    if (downloaded !== bytes) throw new Error(`Rospatent dataset size mismatch: expected ${bytes}, received ${downloaded}.`);
    completed = true;
  }
  return {
    readable: readable(),
    metadata() {
      if (!completed) throw new Error('Rospatent dataset stream was not fully consumed.');
      return {
        source_url: officialUrl,
        sha256: digest.digest('hex'),
        bytes,
        etag: boundedHeader(response.headers.get('etag')),
        last_modified: boundedHeader(response.headers.get('last-modified')),
      };
    },
  };
}

async function fetchRange({ officialUrl, start, end, bytes, fetchImpl }) {
  const response = await fetchWithSourcePolicy(officialUrl, {
    fetchImpl,
    headers: { range: `bytes=${start}-${end}` },
    redirect: 'follow',
    retries: 2,
    sourceName: `Rospatent trademark dataset range ${start}-${end}`,
    timeoutMs: 90_000,
  });
  if (response.status !== 206) throw new Error(`Rospatent dataset range returned HTTP ${response.status} instead of 206.`);
  if (assertOfficialRospatentDatasetUrl(response.url || officialUrl) !== officialUrl) throw new Error('Rospatent dataset range redirected.');
  const expected = `bytes ${start}-${end}/${bytes}`;
  if (response.headers.get('content-range') !== expected) throw new Error(`Rospatent dataset returned unexpected Content-Range: ${response.headers.get('content-range') ?? 'missing'}.`);
  const chunk = Buffer.from(await response.arrayBuffer());
  if (chunk.length !== end - start + 1) throw new Error('Rospatent dataset range byte count mismatch.');
  return chunk;
}

function createCsvRowParser(onRow) {
  let row = [], field = '', quoted = false, pendingQuote = false, skipLf = false;
  const push = () => { row.push(field); field = ''; };
  return {
    write(value) {
      for (const char of value) {
        if (skipLf) { skipLf = false; if (char === '\n') continue; }
        if (quoted) {
          if (pendingQuote) {
            if (char === '"') { field += '"'; pendingQuote = false; continue; }
            quoted = false; pendingQuote = false;
          } else if (char === '"') { pendingQuote = true; continue; }
          else { field += char; continue; }
        }
        if (char === '"' && field === '') quoted = true;
        else if (char === ',') push();
        else if (char === '\n' || char === '\r') { push(); onRow(row); row = []; if (char === '\r') skipLf = true; }
        else if (!/\s/.test(char) || field !== '') field += char;
      }
    },
    close() {
      if (quoted && !pendingQuote) throw new Error('Rospatent CSV ended inside a quoted field.');
      if (field !== '' || row.length > 0) { push(); onRow(row); }
    },
  };
}

function invalidDatasetUrl() { return new Error('Invalid official Rospatent trademark dataset URL.'); }
function trackedInnSet(values) {
  const source = values instanceof Set ? [...values] : Array.isArray(values) ? values : parseCommaSeparated(values);
  return new Set(source.map(normalizeLegalInn).filter(Boolean));
}
function normalizeHeader(value) { return value.trim().toLowerCase().replace(/\s+/g, ' '); }
function compactDate(value) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(toNonEmptyText(value) ?? '');
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}
function datasetDate(value) { return /\/data-(\d{8})-/i.exec(value)?.[1] ?? ''; }
function boundedHeader(value) { return typeof value === 'string' && value.length <= 512 && !/[\r\n]/.test(value) ? value : null; }
async function exists(path) { try { await access(path); return true; } catch { return false; } }

function parseCli(argv) {
  const options = { outputFile: null, trackedInns: null, validateOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--output') options.outputFile = argv[++index];
    else if (argv[index] === '--inns') options.trackedInns = argv[++index];
    else if (argv[index] === '--validate-only') options.validateOnly = true;
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  options.trackedInns ??= process.env.GOVERNMENT_ENRICHMENT_INNS?.trim();
  if (!options.validateOnly) {
    options.outputFile ??= process.env.ROSPATENT_OPEN_DATA_SYNC_OUTPUT_FILE?.trim();
    options.outputFile ??= resolve('packages/db/scripts/.snapshots/rospatent-open-data', `snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  }
  if (!options.trackedInns) throw new Error('Usage: sync-rospatent-open-data-snapshot.mjs [--output <versioned.json>] --inns <10-digit INNs> [--validate-only]');
  return options;
}

async function main() {
  const result = await syncRospatentOpenDataSnapshot(parseCli(process.argv.slice(2)));
  console.log(JSON.stringify({
    ok: true,
    source: SOURCE_ID,
    outputFile: result.outputFile,
    trackedLegalEntities: result.snapshot.tracked_inns.length,
    records: result.snapshot.rospatent.length,
    dataset: result.snapshot.dataset,
    activated: Boolean(result.activation),
    validatedOnly: result.validatedOnly === true,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
