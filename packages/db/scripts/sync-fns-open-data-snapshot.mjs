#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { access, mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

import { SaxesParser } from 'saxes';

import { normalizeLegalInn, parseCommaSeparated, toNonEmptyText } from './adapters/rf-source-runtime.mjs';
import { fetchWithSourcePolicy } from './adapters/source-http.mjs';

const FNS_DATASETS = Object.freeze({
  headcount: Object.freeze({
    passportId: '7707329152-sshr2019',
    passportUrl: 'https://www.nalog.gov.ru/opendata/7707329152-sshr2019/',
    maxArchiveBytes: 750_000_000,
  }),
  'revenue-expenses': Object.freeze({
    passportId: '7707329152-revexp',
    passportUrl: 'https://www.nalog.gov.ru/opendata/7707329152-revexp/',
    maxArchiveBytes: 2_500_000_000,
  }),
  'tax-regime': Object.freeze({
    passportId: '7707329152-snr',
    passportUrl: 'https://www.nalog.gov.ru/rn77/opendata/7707329152-snr/',
    maxArchiveBytes: 1_500_000_000,
  }),
});

export function assertOfficialFnsArchiveUrl(dataset, value) {
  const config = FNS_DATASETS[dataset];
  if (!config) throw new Error(`Unsupported FNS dataset: ${dataset}.`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid official FNS archive URL for ${dataset}.`);
  }
  const expectedPrefix = `/opendata/${config.passportId}/`;
  if (
    parsed.protocol !== 'https:'
    || parsed.hostname.toLowerCase() !== 'file.nalog.ru'
    || !parsed.pathname.startsWith(expectedPrefix)
    || !/^data-[^/]+\.zip$/i.test(basename(parsed.pathname))
    || parsed.username
    || parsed.password
  ) {
    throw new Error(`Invalid official FNS archive URL for ${dataset}.`);
  }
  return parsed.href;
}

export async function discoverLatestFnsArchiveUrl(dataset, fetchImpl = globalThis.fetch) {
  const config = FNS_DATASETS[dataset];
  if (!config) throw new Error(`Unsupported FNS dataset: ${dataset}.`);
  const response = await fetchWithSourcePolicy(config.passportUrl, {
    fetchImpl,
    headers: { accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    sourceName: `FNS ${dataset} passport`,
    timeoutMs: 30_000,
  });
  if (!response.ok) throw new Error(`FNS passport ${dataset} returned HTTP ${response.status}.`);
  const finalUrl = new URL(response.url || config.passportUrl);
  if (finalUrl.protocol !== 'https:' || !['nalog.gov.ru', 'www.nalog.gov.ru'].includes(finalUrl.hostname.toLowerCase())) {
    throw new Error(`FNS passport ${dataset} redirected outside nalog.gov.ru.`);
  }
  const html = await response.text();
  const candidates = [...html.matchAll(/https:\/\/file\.nalog\.ru\/opendata\/[^"'<>\s]+\.zip/gi)]
    .map((match) => match[0].replaceAll('&amp;', '&'))
    .filter((url) => {
      try {
        assertOfficialFnsArchiveUrl(dataset, url);
        return true;
      } catch {
        return false;
      }
    })
    .sort(compareArchiveUrlsNewestFirst);
  if (candidates.length === 0) throw new Error(`FNS passport ${dataset} exposed no official archive URL.`);
  return candidates[0];
}

export async function parseFnsXmlStream(readable, { dataset, sourceUrl, trackedInns, maxRecords = 100_000 }) {
  if (!FNS_DATASETS[dataset]) throw new Error(`Unsupported FNS dataset: ${dataset}.`);
  const officialSourceUrl = assertOfficialFnsArchiveUrl(dataset, sourceUrl);
  const allowed = normalizeTrackedInns(trackedInns);
  if (allowed.size === 0) throw new Error('At least one tracked 10-digit legal-entity INN is required.');
  const records = [];
  const diagnostics = {
    documents: 0,
    legalEntityDocuments: 0,
    trackedLegalEntityDocuments: 0,
    metricElements: 0,
    periodDocuments: 0,
    tagCounts: Object.create(null),
  };
  let current = null;
  const parser = new SaxesParser({ fragment: true });
  parser.on('opentag', (tag) => {
    const name = localName(tag.name);
    if (Object.hasOwn(diagnostics.tagCounts, name) || Object.keys(diagnostics.tagCounts).length < 20) {
      diagnostics.tagCounts[name] = (diagnostics.tagCounts[name] ?? 0) + 1;
    }
    const attributes = plainAttributes(tag.attributes);
    if (name === 'Документ') {
      current = { period: normalizeFnsDate(attributes['ДатаСост'] ?? attributes['ДатаДок']) };
      diagnostics.documents += 1;
      if (current.period) diagnostics.periodDocuments += 1;
      return;
    }
    if (!current) return;
    if (name === 'СведНП') {
      current.inn = normalizeLegalInn(attributes['ИННЮЛ']);
      current.companyName = toNonEmptyText(attributes['НаимОрг']);
      if (current.inn) diagnostics.legalEntityDocuments += 1;
      if (current.inn && allowed.has(current.inn)) diagnostics.trackedLegalEntityDocuments += 1;
      return;
    }
    if (dataset === 'headcount' && name === 'СведССЧР') {
      current.employeeCount = finiteNumber(attributes['КолРаб']);
      diagnostics.metricElements += 1;
    } else if (dataset === 'revenue-expenses' && name === 'СведДоходРасх') {
      current.revenue = finiteNumber(attributes['СумДоход']);
      current.expenses = finiteNumber(attributes['СумРасход']);
      diagnostics.metricElements += 1;
    } else if (dataset === 'tax-regime' && name === 'СведСНР') {
      current.taxRegime = normalizeTaxRegime(attributes);
      diagnostics.metricElements += 1;
    }
  });
  parser.on('closetag', (tag) => {
    if (localName(tag.name) !== 'Документ' || !current) return;
    const record = buildDatasetRecord(dataset, current, officialSourceUrl, allowed);
    current = null;
    if (!record) return;
    records.push(record);
    if (records.length > maxRecords) throw new Error(`FNS ${dataset} exceeded the ${maxRecords} filtered-record limit.`);
  });

  let decoder = null;
  let undecoded = Buffer.alloc(0);
  const declarationStripper = createXmlDeclarationStripper();
  for await (const chunk of readable) {
    let decoded;
    if (typeof chunk === 'string') {
      decoded = chunk;
    } else {
      if (!decoder) {
        undecoded = Buffer.concat([undecoded, chunk]);
        const declarationEnd = undecoded.indexOf('?>');
        if (declarationEnd === -1 && undecoded.length < 1024) continue;
        decoder = new TextDecoder(detectXmlEncoding(undecoded));
        decoded = decoder.decode(undecoded, { stream: true });
        undecoded = Buffer.alloc(0);
      } else {
        decoded = decoder.decode(chunk, { stream: true });
      }
    }
    parser.write(declarationStripper.write(decoded));
  }
  if (!decoder && undecoded.length > 0) {
    decoder = new TextDecoder(detectXmlEncoding(undecoded));
    parser.write(declarationStripper.write(decoder.decode(undecoded, { stream: true })));
  }
  if (decoder) parser.write(declarationStripper.write(decoder.decode()));
  parser.write(declarationStripper.close()).close();
  Object.defineProperty(records, 'diagnostics', { value: diagnostics, enumerable: false });
  return records;
}

export function buildFnsSnapshot({ records, trackedInns, datasets, generatedAt = new Date().toISOString() }) {
  const allowed = normalizeTrackedInns(trackedInns);
  const keyedRecords = new Map();
  for (const record of records) {
    if (!allowed.has(record.inn) || !FNS_DATASETS[record.dataset] || !record.period) continue;
    keyedRecords.set(`${record.dataset}:${record.period}:${record.inn}`, { ...record });
  }
  const fns = [...keyedRecords.values()]
    .sort((left, right) => (
      left.dataset.localeCompare(right.dataset)
      || left.period.localeCompare(right.period)
      || left.inn.localeCompare(right.inn)
    ));
  return {
    schema_version: 1,
    source_id: 'fns-open-data',
    generated_at: generatedAt,
    tracked_inns: [...allowed].sort(),
    datasets: datasets.map((dataset) => ({ ...dataset })),
    fns,
  };
}

export async function syncFnsOpenDataSnapshot({
  outputFile,
  trackedInns,
  datasetNames = Object.keys(FNS_DATASETS),
  previousSnapshotFile = null,
  fetchImpl = globalThis.fetch,
}) {
  const outputPath = resolve(outputFile);
  const outputDirectory = dirname(outputPath);
  const allowed = normalizeTrackedInns(trackedInns);
  if (allowed.size === 0) throw new Error('At least one tracked 10-digit legal-entity INN is required.');
  const uniqueDatasets = [...new Set(datasetNames)];
  if (uniqueDatasets.length === 0 || uniqueDatasets.some((dataset) => !FNS_DATASETS[dataset])) {
    throw new Error(`Datasets must be selected from: ${Object.keys(FNS_DATASETS).join(', ')}.`);
  }
  if (await pathExists(outputPath)) {
    throw new Error(`Refusing to overwrite existing snapshot; publish to a new versioned filename: ${outputPath}`);
  }

  await mkdir(outputDirectory, { recursive: true });
  const temporaryDirectory = await mkdtemp(join(outputDirectory, '.rr-fns-sync-'));
  const temporaryOutput = join(outputDirectory, `.${basename(outputPath)}.${process.pid}.tmp`);
  const previousSnapshot = previousSnapshotFile
    ? await readPreviousSnapshot(previousSnapshotFile, allowed)
    : { fns: [], datasets: [] };
  const records = [...previousSnapshot.fns];
  const datasets = [...previousSnapshot.datasets];
  const parserDiagnostics = [];
  try {
    for (const dataset of uniqueDatasets) {
      const sourceUrl = await discoverLatestFnsArchiveUrl(dataset, fetchImpl);
      const archivePath = join(temporaryDirectory, `${dataset}.zip`);
      const downloaded = await downloadOfficialFnsArchive(dataset, sourceUrl, archivePath, fetchImpl);
      const unzip = spawn(resolveUnzipCommand(), ['-p', archivePath], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let unzipError = '';
      unzip.stderr.setEncoding('utf8');
      unzip.stderr.on('data', (chunk) => { unzipError = `${unzipError}${chunk}`.slice(-65_536); });
      const unzipCompletion = new Promise((resolvePromise, rejectPromise) => {
        unzip.once('error', rejectPromise);
        unzip.once('close', resolvePromise);
      });
      const parsed = await parseFnsXmlStream(unzip.stdout, { dataset, sourceUrl, trackedInns: allowed });
      const exitCode = await unzipCompletion;
      if (exitCode !== 0) throw new Error(`unzip failed for FNS ${dataset}: ${unzipError.trim() || `exit ${exitCode}`}`);
      parserDiagnostics.push({ dataset, ...parsed.diagnostics });
      records.push(...parsed);
      const metadata = { dataset, source_url: sourceUrl, sha256: downloaded.sha256, bytes: downloaded.bytes, records: parsed.length };
      const existingIndex = datasets.findIndex((entry) => entry.dataset === dataset && entry.source_url === sourceUrl);
      if (existingIndex >= 0) datasets[existingIndex] = metadata;
      else datasets.push(metadata);
    }

    const snapshot = buildFnsSnapshot({ records, trackedInns: allowed, datasets });
    if (snapshot.fns.length === 0) {
      throw new Error(`Official FNS archives contained no records for the tracked INNs; refusing to publish an empty snapshot. Parser diagnostics: ${JSON.stringify(parserDiagnostics)}`);
    }
    await writeFile(temporaryOutput, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryOutput, outputPath);
    return { outputFile: outputPath, snapshot };
  } finally {
    await rm(temporaryOutput, { force: true });
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function downloadOfficialFnsArchive(dataset, sourceUrl, destination, fetchImpl) {
  const officialUrl = assertOfficialFnsArchiveUrl(dataset, sourceUrl);
  const metadata = await fetchWithSourcePolicy(officialUrl, {
    fetchImpl,
    method: 'HEAD',
    redirect: 'follow',
    sourceName: `FNS ${dataset} archive metadata`,
    timeoutMs: 30_000,
  });
  if (!metadata.ok) throw new Error(`FNS archive ${dataset} returned HTTP ${metadata.status}.`);
  const finalUrl = assertOfficialFnsArchiveUrl(dataset, metadata.url || officialUrl);
  if (finalUrl !== officialUrl) throw new Error(`FNS archive ${dataset} redirected to a different archive; re-run passport discovery.`);
  const maxBytes = FNS_DATASETS[dataset].maxArchiveBytes;
  const declaredBytes = Number(metadata.headers.get('content-length'));
  if (!Number.isSafeInteger(declaredBytes) || declaredBytes <= 0) throw new Error(`FNS ${dataset} archive did not expose a valid content-length.`);
  if (declaredBytes > maxBytes) throw new Error(`FNS ${dataset} archive exceeds the ${maxBytes}-byte safety limit.`);

  let bytes = 0;
  const digest = createHash('sha256');
  const archive = await open(destination, 'wx');
  const chunkBytes = 8 * 1024 * 1024;
  try {
    for (let start = 0; start < declaredBytes; start += chunkBytes) {
      const end = Math.min(declaredBytes - 1, start + chunkBytes - 1);
      const chunk = await fetchArchiveRange({ dataset, officialUrl, start, end, declaredBytes, fetchImpl });
      await archive.write(chunk, 0, chunk.length, start);
      digest.update(chunk);
      bytes += chunk.length;
    }
  } finally {
    await archive.close();
  }
  if (bytes !== declaredBytes) throw new Error(`FNS ${dataset} archive size mismatch: expected ${declaredBytes}, received ${bytes}.`);
  return { bytes, sha256: digest.digest('hex') };
}

async function fetchArchiveRange({ dataset, officialUrl, start, end, declaredBytes, fetchImpl }) {
  const expectedBytes = end - start + 1;
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchWithSourcePolicy(officialUrl, {
        fetchImpl,
        headers: { range: `bytes=${start}-${end}` },
        redirect: 'follow',
        retries: 1,
        sourceName: `FNS ${dataset} archive range ${start}-${end}`,
        timeoutMs: 90_000,
      });
      const responseUrl = assertOfficialFnsArchiveUrl(dataset, response.url || officialUrl);
      if (responseUrl !== officialUrl) throw new Error(`FNS ${dataset} range redirected to a different archive.`);
      if (response.status !== 206) throw new Error(`FNS ${dataset} range request returned HTTP ${response.status} instead of 206.`);
      const contentRange = response.headers.get('content-range');
      if (contentRange !== `bytes ${start}-${end}/${declaredBytes}`) {
        throw new Error(`FNS ${dataset} returned unexpected Content-Range: ${contentRange ?? 'missing'}.`);
      }
      const chunk = Buffer.from(await response.arrayBuffer());
      if (chunk.length !== expectedBytes) throw new Error(`FNS ${dataset} range ${start}-${end} returned ${chunk.length} bytes; expected ${expectedBytes}.`);
      return chunk;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolvePromise) => setTimeout(resolvePromise, 250 * attempt));
    }
  }
  throw lastError ?? new Error(`FNS ${dataset} range ${start}-${end} failed.`);
}

async function readPreviousSnapshot(filePath, allowed) {
  const parsed = JSON.parse(await readFile(resolve(filePath), 'utf8'));
  if (parsed?.schema_version !== 1 || parsed?.source_id !== 'fns-open-data' || !Array.isArray(parsed.fns) || !Array.isArray(parsed.datasets)) {
    throw new Error('Previous FNS snapshot has an unsupported or invalid schema.');
  }
  const fns = parsed.fns.filter((record) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
    if (!allowed.has(normalizeLegalInn(record.inn))) return false;
    try {
      return Boolean(assertOfficialFnsArchiveUrl(record.dataset, record.source_url));
    } catch {
      return false;
    }
  });
  const datasets = parsed.datasets.filter((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    if (!FNS_DATASETS[entry.dataset]) return false;
    if (!/^[a-f0-9]{64}$/i.test(entry.sha256 ?? '')) return false;
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes <= 0) return false;
    if (!Number.isSafeInteger(entry.records) || entry.records < 0) return false;
    try {
      return Boolean(assertOfficialFnsArchiveUrl(entry.dataset, entry.source_url));
    } catch {
      return false;
    }
  });
  return { fns, datasets };
}

function buildDatasetRecord(dataset, current, sourceUrl, allowed) {
  if (!current.inn || !allowed.has(current.inn) || !current.period) return null;
  const base = {
    dataset,
    period: current.period,
    inn: current.inn,
    company_name: current.companyName ?? `INN ${current.inn}`,
  };
  if (dataset === 'headcount' && current.employeeCount !== null && current.employeeCount !== undefined) {
    return { ...base, employee_count: current.employeeCount, source_url: sourceUrl };
  }
  if (dataset === 'revenue-expenses' && current.revenue !== null && current.revenue !== undefined) {
    return { ...base, revenue: current.revenue, expenses: current.expenses ?? null, source_url: sourceUrl };
  }
  if (dataset === 'tax-regime' && current.taxRegime) {
    return { ...base, tax_regime: current.taxRegime, source_url: sourceUrl };
  }
  return null;
}

function normalizeTrackedInns(values) {
  const source = values instanceof Set ? [...values] : Array.isArray(values) ? values : parseCommaSeparated(values);
  return new Set(source.map(normalizeLegalInn).filter(Boolean));
}

function normalizeFnsDate(value) {
  const text = toNonEmptyText(value);
  if (!text) return null;
  const russian = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
  if (russian) return `${russian[3]}-${russian[2]}-${russian[1]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

function normalizeTaxRegime(attributes) {
  const regimes = [
    ['ПризнЕСХН', 'unified-agricultural-tax'],
    ['ПризнУСН', 'simplified-tax-system'],
    ['ПризнАУСН', 'automated-simplified-tax-system'],
    ['ПризнСРП', 'production-sharing-agreement'],
  ].filter(([attribute]) => ['1', 'true'].includes(String(attributes[attribute]).toLowerCase()))
    .map(([, regime]) => regime);
  return regimes.length > 0 ? regimes.join(',') : null;
}

function plainAttributes(attributes) {
  return Object.fromEntries(Object.entries(attributes).map(([name, value]) => [localName(name), typeof value === 'string' ? value : value.value]));
}

function localName(value) {
  return String(value).split(':').at(-1);
}

function createXmlDeclarationStripper() {
  let pending = '';
  return {
    write(value) {
      pending += value;
      let output = '';
      while (pending) {
        const start = pending.search(/<\?xml/i);
        if (start === -1) {
          const emitLength = Math.max(0, pending.length - 4);
          output += pending.slice(0, emitLength);
          pending = pending.slice(emitLength);
          break;
        }
        output += pending.slice(0, start);
        const end = pending.indexOf('?>', start + 5);
        if (end === -1) {
          pending = pending.slice(start);
          break;
        }
        pending = pending.slice(end + 2);
      }
      return output;
    },
    close() {
      if (/^<\?xml/i.test(pending)) throw new Error('FNS XML ended inside an XML declaration.');
      const output = pending;
      pending = '';
      return output;
    },
  };
}

function detectXmlEncoding(bytes) {
  const prefix = bytes.subarray(0, 1024).toString('latin1');
  const declared = /<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(prefix)?.[1]?.toLowerCase() ?? 'utf-8';
  if (['utf-8', 'utf8'].includes(declared)) return 'utf-8';
  if (['windows-1251', 'cp1251'].includes(declared)) return 'windows-1251';
  throw new Error(`Unsupported FNS XML encoding: ${declared}.`);
}

function finiteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function compareArchiveUrlsNewestFirst(left, right) {
  const leftDate = /data-(\d{8})-/i.exec(left)?.[1] ?? '';
  const rightDate = /data-(\d{8})-/i.exec(right)?.[1] ?? '';
  return rightDate.localeCompare(leftDate) || right.localeCompare(left);
}

function resolveUnzipCommand() {
  const configured = process.env.FNS_OPEN_DATA_UNZIP_PATH?.trim();
  if (configured) {
    if (!isAbsolute(configured) || !/^unzip(?:\.exe)?$/i.test(basename(configured)) || !existsSync(configured)) {
      throw new Error('FNS_OPEN_DATA_UNZIP_PATH must be an existing absolute path to unzip or unzip.exe.');
    }
    return configured;
  }
  if (process.platform === 'win32') {
    const gitUnzip = 'C:\\Program Files\\Git\\usr\\bin\\unzip.exe';
    if (existsSync(gitUnzip)) return gitUnzip;
  }
  return 'unzip';
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseCli(argv) {
  const options = { outputFile: null, trackedInns: null, datasetNames: Object.keys(FNS_DATASETS), previousSnapshotFile: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--output') options.outputFile = argv[++index];
    else if (value === '--inns') options.trackedInns = argv[++index];
    else if (value === '--include') options.datasetNames = parseCommaSeparated(argv[++index]);
    else if (value === '--previous') options.previousSnapshotFile = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  options.outputFile ??= process.env.FNS_OPEN_DATA_SYNC_OUTPUT_FILE?.trim();
  options.trackedInns ??= process.env.GOVERNMENT_ENRICHMENT_INNS?.trim();
  if (!options.outputFile) throw new Error('Usage: sync-fns-open-data-snapshot.mjs --output <new-versioned-snapshot.json> --inns <10-digit INNs> [--include headcount,revenue-expenses,tax-regime] [--previous <snapshot.json>]');
  return options;
}

async function main() {
  const result = await syncFnsOpenDataSnapshot(parseCli(process.argv.slice(2)));
  console.log(JSON.stringify({
    ok: true,
    source: 'fns-open-data',
    outputFile: result.outputFile,
    trackedLegalEntities: result.snapshot.tracked_inns.length,
    records: result.snapshot.fns.length,
    datasets: result.snapshot.datasets,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
