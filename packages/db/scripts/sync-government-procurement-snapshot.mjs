#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { SaxesParser } from 'saxes';

import { installGovernmentCaRuntime } from './adapters/government-ca-runtime.mjs';
import { activateValidatedSnapshot, resolveVersionedSnapshotOutput } from './adapters/snapshot-activation.mjs';
import { normalizeLegalInn, parseCommaSeparated, toNonEmptyText } from './adapters/rf-source-runtime.mjs';
import { fetchWithSourcePolicy } from './adapters/source-http.mjs';
import { buildNoEligibleLegalEntitiesSummary, resolveTrackedCompanyInns } from './adapters/tracked-company-inns.mjs';

const SOURCE_ID = 'government-procurement';
const EIS_ORIGIN = 'https://zakupki.gov.ru';
const CATALOG_PAGE_SIZE = 50;
const CATALOG_URL = `${EIS_ORIGIN}/epz/opendata/search/results.html?dataset44IdHidden=5&pageNumber=1&recordsPerPage=_${CATALOG_PAGE_SIZE}`;
const DEFAULT_CRAWL_DELAY_MS = 60_000;
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const MAX_RSS_BYTES = 8 * 1024 * 1024;
const MAX_TRACKED_INNS = 50;

installGovernmentCaRuntime();

export function assertOfficialEisUrl(value, expectedPath = null) {
  let url;
  try { url = new URL(value, EIS_ORIGIN); } catch { throw invalidEisUrl(); }
  const allowedPaths = [
    '/epz/opendata/search/results.html',
    '/epz/opendata/card/passport-info.html',
    '/epz/contract/search/rss',
    '/epz/contract/contractCard/common-info.html',
  ];
  if (
    url.protocol !== 'https:'
    || url.hostname.toLowerCase() !== 'zakupki.gov.ru'
    || url.username || url.password || url.hash
    || !allowedPaths.includes(url.pathname)
    || (expectedPath && url.pathname !== expectedPath)
  ) throw invalidEisUrl();
  return url.href;
}

export async function discoverEisContractCatalog(fetchImpl = globalThis.fetch, options = {}) {
  const defaultGate = createRequestGate(fetchImpl === globalThis.fetch ? DEFAULT_CRAWL_DELAY_MS : 0);
  const request = options.request ?? ((url) => fetchEis(
    url,
    fetchImpl,
    MAX_CATALOG_BYTES,
    'EIS contract open-data catalog',
    defaultGate,
  ));
  const passports = new Map();
  const pageReceipts = [];
  for (let page = 1; page <= 4; page += 1) {
    const pageUrl = new URL(CATALOG_URL);
    pageUrl.searchParams.set('pageNumber', String(page));
    const { bytes, text, finalUrl } = await request(pageUrl.href);
    assertCatalogUrl(finalUrl, page);
    const pagePassports = parseCatalogPassports(text);
    for (const passport of pagePassports) passports.set(passport.passport_id, passport);
    pageReceipts.push({ source_url: pageUrl.href, sha256: sha256(bytes), bytes: bytes.length, passports: pagePassports.length });
    if (pagePassports.length < CATALOG_PAGE_SIZE) break;
  }
  if (passports.size === 0) throw new Error('EIS contract catalog exposed no official 44-FZ contract passports.');
  const combined = Buffer.concat(pageReceipts.map((receipt) => Buffer.from(receipt.sha256, 'hex')));
  return {
    source_url: CATALOG_URL,
    sha256: pageReceipts.length === 1 ? pageReceipts[0].sha256 : sha256(combined),
    bytes: pageReceipts.reduce((sum, receipt) => sum + receipt.bytes, 0),
    passports: [...passports.values()].sort((left, right) => left.passport_id.localeCompare(right.passport_id)),
    pages: pageReceipts,
  };
}

export function parseEisContractRss(xml, { supplierInn, sourceUrl }) {
  const inn = normalizeLegalInn(supplierInn);
  if (!inn) throw new Error('EIS RSS parsing requires one 10-digit legal-entity supplier INN.');
  const officialFeed = assertOfficialEisRssUrl(sourceUrl, inn);
  const items = [];
  let current = null;
  let field = null;
  const parser = new SaxesParser({ fragment: false });
  parser.on('opentag', (tag) => {
    const name = localName(tag.name);
    if (name === 'item') current = {};
    if (current && ['title', 'link', 'description', 'pubDate', 'author'].includes(name)) {
      field = name;
      current[field] = '';
    }
  });
  parser.on('text', (value) => { if (current && field) current[field] += value; });
  parser.on('cdata', (value) => { if (current && field) current[field] += value; });
  parser.on('closetag', (tag) => {
    const name = localName(tag.name);
    if (field === name) field = null;
    if (name === 'item' && current) { items.push(current); current = null; }
  });
  parser.write(String(xml)).close();
  if (items.length > CATALOG_PAGE_SIZE) throw new Error(`EIS RSS exceeded the ${CATALOG_PAGE_SIZE}-item safety limit.`);
  const records = items.map((item) => parseEisRssItem(item, inn)).filter(Boolean);
  if (items.length > 0 && records.length === 0 && !String(xml).includes(inn)) {
    throw new Error('EIS RSS did not echo the requested supplier INN.');
  }
  if (items.length > 0 && items.some((item) => !descriptionSupplierInn(item.description)?.includes(inn))) {
    throw new Error('EIS RSS did not echo the requested supplier INN in every item.');
  }
  Object.defineProperty(records, 'feedUrl', { value: officialFeed, enumerable: false });
  return records;
}

export function buildGovernmentProcurementSnapshot({ records, trackedInns, catalog, feeds, generatedAt = new Date().toISOString() }) {
  const allowed = trackedInnSet(trackedInns);
  validateReceipt(catalog, 'EIS catalog');
  const keyed = new Map();
  for (const record of records) {
    const inn = normalizeLegalInn(record?.supplier_inn);
    const contractNumber = toNonEmptyText(record?.contract_number);
    const contractDate = dateOnly(record?.contract_date);
    const contractValue = finiteNumber(record?.contract_value);
    let sourceUrl = null;
    try { sourceUrl = assertOfficialEisUrl(record?.source_url, '/epz/contract/contractCard/common-info.html'); } catch { /* rejected below */ }
    if (!inn || !allowed.has(inn) || !contractNumber || !contractDate || contractValue === null || !sourceUrl) continue;
    const sourceNumber = new URL(sourceUrl).searchParams.get('reestrNumber');
    if (sourceNumber !== contractNumber) continue;
    keyed.set(`${inn}:${contractNumber}`, { ...record, supplier_inn: inn, contract_number: contractNumber, contract_date: contractDate, contract_value: contractValue, source_url: sourceUrl });
  }
  const procurement = [...keyed.values()].sort((left, right) => left.supplier_inn.localeCompare(right.supplier_inn) || left.contract_date.localeCompare(right.contract_date) || left.contract_number.localeCompare(right.contract_number));
  if (procurement.length === 0) throw new Error('EIS snapshot has no validated contract records for tracked legal-entity INNs.');
  for (const feed of feeds) validateReceipt(feed, 'EIS RSS feed');
  return {
    schema_version: 1,
    source_id: SOURCE_ID,
    generated_at: generatedAt,
    tracked_inns: [...allowed].sort(),
    catalog: { ...catalog, passports: Array.isArray(catalog.passports) ? catalog.passports.length : catalog.passports },
    feeds: feeds.map((feed) => ({ ...feed })),
    procurement,
  };
}

export async function syncGovernmentProcurementSnapshot({
  outputFile,
  trackedInns,
  fetchImpl = globalThis.fetch,
  crawlDelayMs = DEFAULT_CRAWL_DELAY_MS,
  activate = true,
  activationRootDirectory,
  validateOnly = false,
}) {
  const allowed = trackedInnSet(trackedInns);
  if (allowed.size === 0) throw new Error('At least one tracked 10-digit legal-entity INN is required.');
  if (allowed.size > MAX_TRACKED_INNS) throw new Error(`EIS sync supports at most ${MAX_TRACKED_INNS} tracked legal entities per run.`);
  if (!Number.isSafeInteger(crawlDelayMs) || crawlDelayMs < 0 || crawlDelayMs > 300_000) throw new Error('EIS crawl delay must be between 0 and 300000 milliseconds.');
  if (fetchImpl === globalThis.fetch && crawlDelayMs < DEFAULT_CRAWL_DELAY_MS) throw new Error('Live EIS sync must respect the published 60-second crawl delay.');
  const outputPath = outputFile ? resolve(outputFile) : null;
  if (!validateOnly && !outputPath) throw new Error('EIS sync requires an output file unless validateOnly is enabled.');
  if (outputPath && await exists(outputPath)) throw new Error(`Refusing to overwrite existing snapshot: ${outputPath}`);
  if (outputPath) await mkdir(dirname(outputPath), { recursive: true });
  const temporaryOutput = outputPath ? join(dirname(outputPath), `.${basename(outputPath)}.${process.pid}.tmp`) : null;
  const gate = createRequestGate(crawlDelayMs);
  const request = async (url, maxBytes = MAX_CATALOG_BYTES, sourceName = 'EIS public data') => {
    return fetchEis(url, fetchImpl, maxBytes, sourceName, gate);
  };
  try {
    const catalog = await discoverEisContractCatalog(fetchImpl, { request });
    const records = [];
    const feeds = [];
    for (const inn of [...allowed].sort()) {
      const feedUrl = buildEisRssUrl(inn);
      const downloaded = await request(feedUrl, MAX_RSS_BYTES, `EIS contract RSS for tracked INN ${inn}`);
      assertOfficialEisRssUrl(downloaded.finalUrl, inn);
      const parsed = parseEisContractRss(downloaded.text, { supplierInn: inn, sourceUrl: feedUrl });
      records.push(...parsed);
      feeds.push({ supplier_inn: inn, source_url: feedUrl, sha256: sha256(downloaded.bytes), bytes: downloaded.bytes.length, records: parsed.length });
    }
    const snapshot = buildGovernmentProcurementSnapshot({ records, trackedInns: allowed, catalog, feeds });
    if (validateOnly) return { outputFile: null, snapshot, activation: null, validatedOnly: true };
    await writeFile(temporaryOutput, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryOutput, outputPath);
    const activation = activate ? await activateValidatedSnapshot({
      sourceId: SOURCE_ID,
      snapshotFile: outputPath,
      recordCount: snapshot.procurement.length,
      sourceUrls: [catalog.source_url, ...feeds.map((feed) => feed.source_url)],
      ...(activationRootDirectory ? { rootDirectory: activationRootDirectory } : {}),
    }) : null;
    return { outputFile: outputPath, snapshot, activation, validatedOnly: false };
  } finally {
    if (temporaryOutput) await rm(temporaryOutput, { force: true });
  }
}

async function fetchEis(url, fetchImpl, maxBytes, sourceName, beforeRequest = async () => {}) {
  const officialUrl = assertOfficialEisUrl(url);
  let response;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await beforeRequest();
    response = await fetchWithSourcePolicy(officialUrl, {
      fetchImpl, headers: { accept: 'application/rss+xml,text/html,application/xhtml+xml' }, redirect: 'follow', retries: 0, sourceName, timeoutMs: 45_000,
    });
    if (response.ok || response.status !== 404 || attempt === 4) break;
  }
  if (!response?.ok) throw new Error(`${sourceName} returned HTTP ${response?.status ?? 'unknown'}.`);
  const finalUrl = assertOfficialEisUrl(response.url || officialUrl);
  const contentLength = response.headers.get('content-length');
  const declared = contentLength === null ? null : Number(contentLength);
  if (declared !== null && (!Number.isSafeInteger(declared) || declared < 1 || declared > maxBytes)) throw new Error(`${sourceName} content-length exceeds the ${maxBytes}-byte safety limit.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1 || bytes.length > maxBytes) throw new Error(`${sourceName} body must be between 1 and ${maxBytes} bytes.`);
  return { bytes, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), finalUrl };
}

function parseCatalogPassports(html) {
  const passports = new Map();
  for (const match of String(html).matchAll(/href=["']([^"']*\/epz\/opendata\/card\/passport-info\.html\?passportId=(7710568760-Contracts-[A-Za-z0-9_-]+))["']/g)) {
    const passportUrl = assertOfficialEisUrl(match[1], '/epz/opendata/card/passport-info.html');
    passports.set(match[2], { passport_id: match[2], passport_url: passportUrl });
  }
  return [...passports.values()];
}

function parseEisRssItem(item, inn) {
  const fields = descriptionFields(item.description);
  if (normalizeLegalInn(fields.get('Поставщик (исполнитель, подрядчик)')) !== inn) return null;
  const sourceUrl = assertOfficialEisUrl(item.link, '/epz/contract/contractCard/common-info.html');
  const contractNumber = new URL(sourceUrl).searchParams.get('reestrNumber');
  if (!/^\d{10,25}$/.test(contractNumber ?? '')) return null;
  const contractLine = fields.get('Контракт №');
  const dateMatch = /(?:^|\s)от\s+(\d{2}\.\d{2}\.\d{4})(?:\s|$)/.exec(contractLine ?? '');
  const contractDate = dateOnly(dateMatch?.[1]);
  const contractValue = finiteNumber(fields.get('Цена контракта'));
  if (!contractDate || contractValue === null) return null;
  return {
    contract_number: contractNumber,
    supplier_inn: inn,
    supplier_name: null,
    customer_name: toNonEmptyText(fields.get('Заказчик') ?? item.author),
    contract_date: contractDate,
    contract_value: contractValue,
    subject: null,
    source_url: sourceUrl,
    published_at: validTimestamp(item.pubDate),
    updated_at: dateOnly(fields.get('Обновлено')),
    status: toNonEmptyText(fields.get('Статус контракта')),
  };
}

function descriptionFields(value) {
  const normalized = String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/gi, '\u00a0')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  const fields = new Map();
  for (const line of normalized.split(/\r?\n/).map((item) => item.replace(/\s+/g, ' ').trim()).filter(Boolean)) {
    const separator = line.indexOf(':');
    if (separator > 0) fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return fields;
}

function descriptionSupplierInn(value) { return descriptionFields(value).get('Поставщик (исполнитель, подрядчик)') ?? ''; }
function buildEisRssUrl(inn) {
  const url = new URL('/epz/contract/search/rss', EIS_ORIGIN);
  for (const [key, value] of Object.entries({ searchType: 'false', morphology: 'on', fz44: 'on', pageNumber: '1', recordsPerPage: '_50', supplierTitle: inn })) url.searchParams.set(key, value);
  return url.href;
}
function assertOfficialEisRssUrl(value, inn) {
  const url = new URL(assertOfficialEisUrl(value, '/epz/contract/search/rss'));
  const expected = new URL(buildEisRssUrl(inn));
  if (url.href !== expected.href) throw invalidEisUrl();
  return url.href;
}
function assertCatalogUrl(value, page) {
  const url = new URL(assertOfficialEisUrl(value, '/epz/opendata/search/results.html'));
  if (url.searchParams.get('dataset44IdHidden') !== '5' || url.searchParams.get('pageNumber') !== String(page) || url.searchParams.get('recordsPerPage') !== '_50') throw invalidEisUrl();
  return url.href;
}
function validateReceipt(receipt, name) {
  if (!receipt || !/^[a-f0-9]{64}$/i.test(receipt.sha256 ?? '') || !Number.isSafeInteger(receipt.bytes) || receipt.bytes < 1) throw new Error(`${name} failed checksum/size validation.`);
}
function trackedInnSet(values) {
  const source = values instanceof Set ? [...values] : Array.isArray(values) ? values : parseCommaSeparated(values);
  return new Set(source.map(normalizeLegalInn).filter(Boolean));
}
function createRequestGate(waitMs) {
  let lastRequestAt = null;
  return async () => {
    if (lastRequestAt !== null) await delay(Math.max(0, waitMs - (Date.now() - lastRequestAt)));
    lastRequestAt = Date.now();
  };
}
function dateOnly(value) {
  const text = toNonEmptyText(value);
  if (!text) return null;
  const ru = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
  if (ru) return `${ru[3]}-${ru[2]}-${ru[1]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}
function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value ?? '').replace(/[\s\u00a0₽]/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function validTimestamp(value) { const parsed = Date.parse(value ?? ''); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function localName(value) { return String(value).split(':').at(-1); }
function invalidEisUrl() { return new Error('Invalid official EIS URL.'); }
function delay(ms) { return ms > 0 ? new Promise((resolvePromise) => setTimeout(resolvePromise, ms)) : Promise.resolve(); }
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
  if (!options.validateOnly) options.outputFile ??= process.env.GOVERNMENT_PROCUREMENT_SYNC_OUTPUT_FILE?.trim() ?? resolveVersionedSnapshotOutput(SOURCE_ID);
  return options;
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  options.trackedInns = await resolveTrackedCompanyInns({ explicitInns: options.trackedInns });
  if (options.trackedInns.length === 0) {
    console.log(JSON.stringify(buildNoEligibleLegalEntitiesSummary(SOURCE_ID), null, 2));
    return;
  }
  const result = await syncGovernmentProcurementSnapshot(options);
  console.log(JSON.stringify({
    ok: true, source: SOURCE_ID, outputFile: result.outputFile,
    trackedLegalEntities: result.snapshot.tracked_inns.length,
    catalogPassports: result.snapshot.catalog.passports,
    feeds: result.snapshot.feeds.length, records: result.snapshot.procurement.length,
    activated: Boolean(result.activation), validatedOnly: result.validatedOnly === true,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
