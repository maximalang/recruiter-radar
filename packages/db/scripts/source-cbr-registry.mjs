import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createStandardSourceRuntime, loadEnvFile } from './adapters/rf-source-runtime.mjs';
import {
  extractSourceSection,
  normalizeCbrRegistryRecord,
  parseGovernmentEnrichmentInns,
} from './adapters/government-open-data.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
loadEnvFile(resolve(scriptDir, '../../../.env'));
const SOURCE_ID = 'cbr-registry';
const CBR_ENDPOINT = 'https://www.cbr.ru/FO_ZoomWS/FinOrg.asmx';

const runtime = createStandardSourceRuntime({
  sourceId: SOURCE_ID,
  signalType: 'other',
  evidenceRole: 'context',
  sourceRecordType: 'financial_market_participant',
  inputFileEnvName: 'CBR_REGISTRY_INPUT_FILE',
  usageText: 'Set CBR_REGISTRY_INPUT_FILE or provide tracked INNs through GOVERNMENT_ENRICHMENT_INNS. The official CBR SOAP service is used without credentials.',
  extractRecords: (parsed) => extractSourceSection(parsed, 'cbr', parseGovernmentEnrichmentInns()),
  normalizeRecord: normalizeCbrRegistryRecord,
  buildSummaryExtras: (input) => ({ liveProvider: input.liveProvider, innsRequested: input.innsRequested }),
});

export async function resolveCbrRegistryInput() {
  const inputFilePath = process.env.CBR_REGISTRY_INPUT_FILE?.trim();
  if (inputFilePath) return runtime.resolveFileInput(inputFilePath);
  const inns = parseGovernmentEnrichmentInns(process.env.CBR_REGISTRY_INNS ?? process.env.GOVERNMENT_ENRICHMENT_INNS).slice(0, 50);
  if (inns.length === 0) throw new Error('No CBR input configured. Set CBR_REGISTRY_INPUT_FILE or provide tracked 10-digit INNs.');
  const records = [];
  for (const inn of inns) {
    const record = await fetchCbrParticipantByInn(inn);
    if (record) records.push(record);
  }
  return runtime.buildInputFromRecords({
    inputMode: 'live-public',
    inputFilePath: null,
    records,
    extra: { liveProvider: 'cbr-finorg-soap', innsRequested: inns.length },
  });
}

export const resolveCbrRegistryConfiguredInput = resolveCbrRegistryInput;
export const buildFetchSummary = runtime.buildFetchSummary;
export async function runCbrRegistryCli(argv = process.argv.slice(2)) { await runtime.runCli(argv, resolveCbrRegistryConfiguredInput); }

export async function fetchCbrParticipantByInn(inn, fetchImpl = globalThis.fetch) {
  if (!/^\d{10}$/.test(String(inn))) {
    throw new Error('CBR FinOrg lookup requires a 10-digit legal-entity INN.');
  }
  const envelope = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetFullInfoByINN xmlns="http://web.cbr.ru/"><INN>${inn}</INN></GetFullInfoByINN></soap:Body></soap:Envelope>`;
  const response = await fetchImpl(CBR_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'text/xml; charset=utf-8', soapaction: '"http://web.cbr.ru/GetFullInfoByINN"' },
    body: envelope,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`CBR FinOrg request failed with HTTP ${response.status}.`);
  const xml = await response.text();
  return parseCbrParticipantXml(xml);
}

export function parseCbrParticipantXml(xml) {
  const inn = tag(xml, 'INN');
  if (!/^\d{10}$/.test(inn ?? '')) return null;
  return {
    inn,
    ogrn: tag(xml, 'OGRN'),
    company_name: tag(xml, 'Name') ?? tag(xml, 'ShortName'),
    status: tag(xml, 'Status'),
    participant_types: block(xml, 'FOTypes').match(/<string>([\s\S]*?)<\/string>/g)?.map((entry) => decodeXml(entry.replace(/<\/?string>/g, ''))) ?? [],
    licenses: blocks(xml, 'LicInfo').map((entry) => ({
      number: tag(entry, 'LIC_Number'),
      name: tag(entry, 'LIC_Name') ?? tag(entry, 'VidD'),
      starts_at: tag(entry, 'LIC_DTStart'),
      ends_at: tag(entry, 'LIC_DTEnd'),
      active: !tag(entry, 'LIC_DTEnd'),
    })),
    source_url: CBR_ENDPOINT,
  };
}

function tag(xml, name) {
  const match = String(xml).match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? decodeXml(match[1].trim()) || null : null;
}
function block(xml, name) { return tag(xml, name) ?? ''; }
function blocks(xml, name) { return [...String(xml).matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'gi'))].map((match) => match[1]); }
function decodeXml(value) { return String(value).replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&'); }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runCbrRegistryCli();
