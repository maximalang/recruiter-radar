#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, open, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

import { SaxesParser } from 'saxes';

import { activateValidatedSnapshot, resolveVersionedSnapshotOutput } from './adapters/snapshot-activation.mjs';
import { fetchWithSourcePolicy } from './adapters/source-http.mjs';
import { buildNoEligibleLegalEntitiesSummary, resolveTrackedCompanyInns } from './adapters/tracked-company-inns.mjs';

const SOURCE_ID = 'fedresurs';
const EXPORT_HOST = 'download.fedresurs.ru';
const DEFAULT_MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_RECORDS = 5_000;

export async function discoverLatestFedresursArchive({
  year = new Date().getUTCFullYear(),
  maxArchiveBytes = resolveMaxArchiveBytes(),
  fetchImpl = globalThis.fetch,
} = {}) {
  const indexUrl = `https://${EXPORT_HOST}/export_messages/${year}/`;
  const response = await fetchWithSourcePolicy(indexUrl, {
    fetchImpl,
    headers: { accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    sourceName: 'Fedresurs export index',
    timeoutMs: 30_000,
  });
  if (!response.ok) throw new Error(`Fedresurs export index returned HTTP ${response.status}.`);
  assertOfficialFedresursIndexUrl(response.url || indexUrl, year);
  const html = await response.text();
  const candidates = parseFedresursExportIndex(html, year)
    .filter((entry) => entry.bytes > 0 && entry.bytes <= maxArchiveBytes)
    .sort((left, right) => right.month - left.month);
  if (candidates.length === 0) {
    throw new Error(`Fedresurs exposed no ${year} monthly archive within the ${maxArchiveBytes}-byte safety limit.`);
  }
  return candidates[0];
}

export function parseFedresursExportIndex(html, year) {
  const entries = [];
  const pattern = new RegExp(`href=["']((\\d{2})-${year}\\.7z)["'][^>]*>[^<]*<\\/a>\\s+[^\\n<]*?\\s(\\d+(?:\\.\\d+)?[KMG])(?:\\s|<|$)`, 'gi');
  for (const match of String(html ?? '').matchAll(pattern)) {
    const month = Number(match[2]);
    const bytes = parseHumanSize(match[3]);
    if (month < 1 || month > 12 || !bytes) continue;
    entries.push({
      year,
      month,
      fileName: match[1],
      bytes,
      url: `https://${EXPORT_HOST}/export_messages/${year}/${match[1]}`,
    });
  }
  return entries;
}

export function assertOfficialFedresursArchiveUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('Invalid Fedresurs archive URL.'); }
  if (
    parsed.protocol !== 'https:'
    || parsed.hostname.toLowerCase() !== EXPORT_HOST
    || !/^\/export_messages\/\d{4}\/\d{2}-\d{4}\.7z$/i.test(parsed.pathname)
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error('Fedresurs archive URL is outside the approved public export path.');
  }
  return parsed.href;
}

export async function parseFedresursXmlStream(readable, {
  sourceUrl,
  trackedInns,
  maxRecords = DEFAULT_MAX_RECORDS,
} = {}) {
  const officialSourceUrl = assertOfficialFedresursArchiveUrl(sourceUrl);
  const allowed = normalizeTrackedInns(trackedInns);
  if (allowed.size === 0) throw new Error('At least one tracked 10-digit legal-entity INN is required.');

  const records = [];
  const diagnostics = {
    documents: 0,
    singleLegalEntityDocuments: 0,
    trackedDocuments: 0,
    ambiguousDocuments: 0,
  };
  let depth = 0;
  let current = null;
  const elementStack = [];
  const parser = new SaxesParser({ fragment: true });

  parser.on('opentag', (tag) => {
    depth += 1;
    const name = localName(tag.name);
    if (depth === 1) {
      current = freshDocument(++diagnostics.documents);
    }
    if (!current) return;
    elementStack.push({ name, text: '' });
    collectAttributes(current, tag.attributes);
  });

  parser.on('text', (text) => {
    const element = elementStack.at(-1);
    if (!element || element.text.length >= 8_192) return;
    element.text = `${element.text}${text}`.slice(0, 8_192);
  });

  parser.on('cdata', (text) => {
    const element = elementStack.at(-1);
    if (!element || element.text.length >= 8_192) return;
    element.text = `${element.text}${text}`.slice(0, 8_192);
  });

  parser.on('closetag', () => {
    const element = elementStack.pop();
    if (current && element) collectElementText(current, element.name, element.text);
    depth -= 1;
    if (depth !== 0 || !current) return;

    const record = finalizeDocument(current, officialSourceUrl, allowed, diagnostics);
    current = null;
    if (!record) return;
    records.push(record);
    if (records.length > maxRecords) {
      throw new Error(`Fedresurs filtered output exceeded the ${maxRecords}-record safety limit.`);
    }
  });

  let decoder = null;
  let undecoded = Buffer.alloc(0);
  const declarationStripper = createXmlDeclarationStripper();
  for await (const chunk of readable) {
    let decoded;
    if (typeof chunk === 'string') {
      decoded = chunk;
    } else if (!decoder) {
      undecoded = Buffer.concat([undecoded, chunk]);
      const declarationEnd = undecoded.indexOf('?>');
      if (declarationEnd === -1 && undecoded.length < 1024) continue;
      decoder = new TextDecoder(detectXmlEncoding(undecoded));
      decoded = decoder.decode(undecoded, { stream: true });
      undecoded = Buffer.alloc(0);
    } else {
      decoded = decoder.decode(chunk, { stream: true });
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

export async function syncFedresursSnapshot({
  outputFile,
  trackedInns,
  year = new Date().getUTCFullYear(),
  maxArchiveBytes = resolveMaxArchiveBytes(),
  fetchImpl = globalThis.fetch,
  activate = true,
} = {}) {
  const allowed = normalizeTrackedInns(trackedInns);
  if (allowed.size === 0) throw new Error('At least one tracked 10-digit legal-entity INN is required.');
  const outputPath = resolve(outputFile);
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryDirectory = await mkdtemp(join(dirname(outputPath), '.rr-fedresurs-sync-'));
  const temporaryOutput = join(dirname(outputPath), `.${basename(outputPath)}.${process.pid}.tmp`);

  try {
    const archive = await discoverLatestFedresursArchive({ year, maxArchiveBytes, fetchImpl });
    const archivePath = join(temporaryDirectory, archive.fileName);
    const downloaded = await downloadFedresursArchive(archive.url, archivePath, maxArchiveBytes, fetchImpl);
    const sevenZip = spawn(resolveSevenZipCommand(), ['x', '-so', archivePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let sevenZipError = '';
    sevenZip.stderr.setEncoding('utf8');
    sevenZip.stderr.on('data', (chunk) => { sevenZipError = `${sevenZipError}${chunk}`.slice(-65_536); });
    const completion = new Promise((resolvePromise, rejectPromise) => {
      sevenZip.once('error', rejectPromise);
      sevenZip.once('close', resolvePromise);
    });
    const records = await parseFedresursXmlStream(sevenZip.stdout, {
      sourceUrl: archive.url,
      trackedInns: allowed,
    });
    const exitCode = await completion;
    if (exitCode !== 0) throw new Error(`7z failed for Fedresurs archive: ${sevenZipError.trim() || `exit ${exitCode}`}`);
    if (records.length === 0) {
      throw new Error(`Fedresurs archive contained no unambiguous records for tracked INNs; refusing to replace the active snapshot. Diagnostics: ${JSON.stringify(records.diagnostics)}`);
    }

    const snapshot = {
      schema_version: 1,
      source_id: SOURCE_ID,
      generated_at: new Date().toISOString(),
      tracked_inns: [...allowed].sort(),
      archive: {
        source_url: archive.url,
        year: archive.year,
        month: archive.month,
        bytes: downloaded.bytes,
        sha256: downloaded.sha256,
      },
      records,
    };
    await writeFile(temporaryOutput, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryOutput, outputPath);
    const activation = activate
      ? await activateValidatedSnapshot({
          sourceId: SOURCE_ID,
          snapshotFile: outputPath,
          recordCount: records.length,
          sourceUrls: [archive.url],
        })
      : null;
    return { outputFile: outputPath, snapshot, activation, diagnostics: records.diagnostics };
  } finally {
    await rm(temporaryOutput, { force: true });
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function downloadFedresursArchive(sourceUrl, destination, maxArchiveBytes, fetchImpl) {
  const officialUrl = assertOfficialFedresursArchiveUrl(sourceUrl);
  const response = await fetchWithSourcePolicy(officialUrl, {
    fetchImpl,
    redirect: 'follow',
    sourceName: 'Fedresurs public export archive',
    timeoutMs: 180_000,
    retries: 1,
  });
  if (!response.ok) throw new Error(`Fedresurs archive returned HTTP ${response.status}.`);
  const finalUrl = assertOfficialFedresursArchiveUrl(response.url || officialUrl);
  if (finalUrl !== officialUrl) throw new Error('Fedresurs archive redirected to a different file.');
  const declaredBytes = Number(response.headers.get('content-length'));
  if (Number.isSafeInteger(declaredBytes) && declaredBytes > maxArchiveBytes) {
    throw new Error(`Fedresurs archive exceeds the ${maxArchiveBytes}-byte safety limit.`);
  }
  if (!response.body) throw new Error('Fedresurs archive response has no body.');

  const file = await open(destination, 'wx');
  const digest = createHash('sha256');
  let bytes = 0;
  try {
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxArchiveBytes) throw new Error(`Fedresurs archive exceeded the ${maxArchiveBytes}-byte safety limit while streaming.`);
      digest.update(buffer);
      await file.write(buffer);
    }
  } finally {
    await file.close();
  }
  if (bytes <= 0) throw new Error('Fedresurs archive download was empty.');
  if (Number.isSafeInteger(declaredBytes) && declaredBytes > 0 && bytes !== declaredBytes) {
    throw new Error(`Fedresurs archive size mismatch: expected ${declaredBytes}, received ${bytes}.`);
  }
  return { bytes, sha256: digest.digest('hex') };
}

function freshDocument(index) {
  return {
    index,
    inns: new Set(),
    names: new Set(),
    guids: new Set(),
    titles: new Set(),
    dates: new Set(),
  };
}

function collectAttributes(current, attributes) {
  for (const [rawName, rawAttribute] of Object.entries(attributes ?? {})) {
    const name = localName(rawName);
    const value = cleanText(rawAttribute?.value ?? rawAttribute);
    if (!value) continue;
    collectValue(current, name, value);
  }
}

function collectElementText(current, name, text) {
  const value = cleanText(text);
  if (!value) return;
  collectValue(current, name, value);
}

function collectValue(current, name, value) {
  const normalizedName = normalizeTagName(name);
  if (normalizedName.includes('inn') || normalizedName.includes('инн')) {
    const inn = normalizeLegalInn(value);
    if (inn) current.inns.add(inn);
  }
  if (/^(?:fullname|shortname|companyname|legalentityname|debtorname|name|наиморг|наименование)$/u.test(normalizedName)) {
    const candidate = cleanText(value, 500);
    if (candidate && candidate.length >= 3 && !/^\d+$/.test(candidate)) current.names.add(candidate);
  }
  if (/(?:guid|messageid|messageguid|идсообщ)/u.test(normalizedName)) {
    const guid = extractGuid(value);
    if (guid) current.guids.add(guid);
  }
  if (/(?:messagetype|messagetypename|messagename|title|видсообщ|типсообщ)/u.test(normalizedName)) {
    const title = cleanText(value, 1_000);
    if (title && title.length >= 3) current.titles.add(title);
  }
  if (/(?:publishdate|publicationdate|datepublish|publishedat|датапубл)/u.test(normalizedName)) {
    const timestamp = parseTimestamp(value);
    if (timestamp) current.dates.add(timestamp);
  }
}

function finalizeDocument(current, sourceUrl, allowed, diagnostics) {
  const legalInns = [...current.inns];
  if (legalInns.length !== 1) {
    if (legalInns.length > 1) diagnostics.ambiguousDocuments += 1;
    return null;
  }
  diagnostics.singleLegalEntityDocuments += 1;
  const inn = legalInns[0];
  if (!allowed.has(inn)) return null;
  diagnostics.trackedDocuments += 1;

  const companyName = chooseCompanyName([...current.names]);
  if (!companyName) return null;
  const headline = chooseHeadline([...current.titles]) ?? 'Сообщение Федресурс';
  const publishedAt = [...current.dates].sort().at(-1) ?? null;
  const guid = [...current.guids][0] ?? null;
  const stableId = guid ?? createHash('sha256')
    .update(`${inn}|${headline}|${publishedAt ?? ''}|${current.index}`)
    .digest('hex')
    .slice(0, 32);

  return {
    id: `fedresurs:${stableId}`,
    external_id: `fedresurs:${stableId}`,
    company_name: companyName,
    inn,
    headline,
    event_type: classifyEventType(headline),
    summary: headline,
    source_url: sourceUrl,
    published_at: publishedAt ?? undefined,
    publisher: 'Федресурс',
  };
}

function chooseCompanyName(names) {
  if (names.length === 0) return null;
  const legalForm = /(?:\bООО\b|\bАО\b|\bПАО\b|\bНАО\b|ОБЩЕСТВ|АКЦИОНЕР|КОМПАНИ|БАНК|CORP|COMPANY|LTD|LLC|JSC)/iu;
  return [...names].sort((left, right) => (
    Number(legalForm.test(right)) - Number(legalForm.test(left))
    || right.length - left.length
  ))[0];
}

function chooseHeadline(titles) {
  return [...titles].sort((left, right) => right.length - left.length)[0] ?? null;
}

function classifyEventType(value) {
  const text = String(value ?? '').toLowerCase();
  if (/банкрот|несостоятель/.test(text)) return 'bankruptcy';
  if (/ликвидац/.test(text)) return 'liquidation';
  if (/реорганизац|преобразован|слияни|присоединен/.test(text)) return 'reorganization';
  if (/залог/.test(text)) return 'pledge';
  if (/лиценз/.test(text)) return 'licence';
  if (/стоимост.*актив|чистых актив/.test(text)) return 'assets';
  return 'corporate_event';
}

function parseHumanSize(value) {
  const match = String(value ?? '').trim().match(/^(\d+(?:\.\d+)?)([KMG])$/i);
  if (!match) return null;
  const multiplier = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[match[2].toUpperCase()];
  return Math.round(Number(match[1]) * multiplier);
}

function assertOfficialFedresursIndexUrl(value, year) {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== EXPORT_HOST || parsed.pathname !== `/export_messages/${year}/`) {
    throw new Error('Fedresurs export index redirected outside the approved public path.');
  }
}

function normalizeTrackedInns(values) {
  const input = values instanceof Set ? [...values] : Array.isArray(values) ? values : String(values ?? '').split(/[\s,;]+/);
  return new Set(input.map(normalizeLegalInn).filter(Boolean));
}

function normalizeLegalInn(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return /^\d{10}$/.test(digits) ? digits : null;
}

function localName(value) {
  return String(value ?? '').split(':').at(-1) ?? '';
}

function normalizeTagName(value) {
  return localName(value).toLowerCase().replace(/[^a-zа-яё0-9]+/giu, '');
}

function cleanText(value, maxLength = 2_000) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maxLength) : null;
}

function extractGuid(value) {
  return String(value ?? '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)?.[0]?.toLowerCase() ?? null;
}

function parseTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function resolveMaxArchiveBytes() {
  const value = Number(process.env.FEDRESURS_MAX_ARCHIVE_BYTES);
  return Number.isSafeInteger(value) && value >= 10 * 1024 * 1024
    ? Math.min(value, 2 * 1024 * 1024 * 1024)
    : DEFAULT_MAX_ARCHIVE_BYTES;
}

function resolveSevenZipCommand() {
  const configured = process.env.FEDRESURS_7Z_PATH?.trim();
  if (configured) {
    if (!isAbsolute(configured) || !/^7z(?:\.exe)?$/i.test(basename(configured)) || !existsSync(configured)) {
      throw new Error('FEDRESURS_7Z_PATH must be an existing absolute path to 7z or 7z.exe.');
    }
    return configured;
  }
  return process.platform === 'win32' ? '7z.exe' : '7z';
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
      if (/^<\?xml/i.test(pending)) throw new Error('Fedresurs XML ended inside an XML declaration.');
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
  throw new Error(`Unsupported Fedresurs XML encoding: ${declared}.`);
}

function parseCli(argv) {
  const options = { outputFile: null, trackedInns: null, year: new Date().getUTCFullYear() };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--output') options.outputFile = argv[++index];
    else if (value === '--inns') options.trackedInns = argv[++index];
    else if (value === '--year') options.year = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  options.outputFile ??= process.env.FEDRESURS_SYNC_OUTPUT_FILE?.trim();
  options.trackedInns ??= process.env.GOVERNMENT_ENRICHMENT_INNS?.trim();
  options.outputFile ??= resolveVersionedSnapshotOutput(SOURCE_ID);
  return options;
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  options.trackedInns = await resolveTrackedCompanyInns({ explicitInns: options.trackedInns });
  if (options.trackedInns.length === 0) {
    console.log(JSON.stringify(buildNoEligibleLegalEntitiesSummary(SOURCE_ID), null, 2));
    return;
  }
  const result = await syncFedresursSnapshot(options);
  console.log(JSON.stringify({
    ok: true,
    source: SOURCE_ID,
    outputFile: result.outputFile,
    trackedLegalEntities: result.snapshot.tracked_inns.length,
    records: result.snapshot.records.length,
    archive: result.snapshot.archive,
    diagnostics: result.diagnostics,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
