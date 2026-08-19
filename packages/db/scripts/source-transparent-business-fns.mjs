import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { normalizeRegistryRecord } from './adapters/rf-source-normalizers.mjs';
import { createStandardSourceRuntime, loadEnvFile } from './adapters/rf-source-runtime.mjs';
import { resolveActiveSnapshot } from './adapters/snapshot-activation.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');
const SOURCE_ID = 'transparent-business-fns';
const UPSTREAM_SNAPSHOT_SOURCE = 'fns-open-data';

loadEnvFile(rootEnvPath);

const runtime = createStandardSourceRuntime({
  sourceId: SOURCE_ID,
  signalType: 'other',
  evidenceRole: 'enrichment',
  sourceRecordType: 'transparent_business_reference',
  inputFileEnvName: 'TRANSPARENT_BUSINESS_FNS_INPUT_FILE',
  usageText: 'Input: official FNS open-data snapshot by default; TRANSPARENT_BUSINESS_FNS_INPUT_FILE or an approved provider are optional overrides. Direct pb.nalog.ru scraping is not used.',
  extractRecords: extractTransparentBusinessFnsRecords,
  normalizeRecord: (record, context) => normalizeRegistryRecord(record, context, {
    sourceRecordType: 'transparent_business_reference',
  }),
  buildSummaryExtras: (input) => ({
    upstreamSnapshotSource: input.upstreamSnapshotSource,
  }),
});

export async function resolveTransparentBusinessFnsInput() {
  const inputFilePath = process.env.TRANSPARENT_BUSINESS_FNS_INPUT_FILE?.trim();
  if (inputFilePath) return runtime.resolveFileInput(inputFilePath);

  const activeFnsSnapshot = resolveActiveSnapshot(UPSTREAM_SNAPSHOT_SOURCE);
  if (activeFnsSnapshot) {
    const input = runtime.resolveFileInput(activeFnsSnapshot.snapshotPath);
    return {
      ...input,
      inputMode: 'official-open-data-snapshot',
      upstreamSnapshotSource: UPSTREAM_SNAPSHOT_SOURCE,
    };
  }

  const providerUrl = process.env.TRANSPARENT_BUSINESS_FNS_PROVIDER_API_URL?.trim();
  const providerToken = process.env.TRANSPARENT_BUSINESS_FNS_PROVIDER_API_TOKEN?.trim();
  if (providerUrl && providerToken) {
    return runtime.resolveProviderInput({ providerUrl, providerToken, providerLabel: `${SOURCE_ID} provider` });
  }

  throw new Error(
    'No input configured for transparent-business-fns. Run the official fns-open-data snapshot sync, '
      + 'set TRANSPARENT_BUSINESS_FNS_INPUT_FILE, or configure an approved provider.',
  );
}

export function extractTransparentBusinessFnsRecords(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.records)) return parsed.records;
  if (!Array.isArray(parsed?.fns)) return [];

  const trackedInns = parseTrackedInns(process.env.GOVERNMENT_ENRICHMENT_INNS);
  const tracked = trackedInns.length > 0 ? new Set(trackedInns) : null;
  const grouped = new Map();

  for (const raw of parsed.fns) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const inn = normalizeLegalEntityInn(raw.inn ?? raw.INN);
    if (!inn || (tracked && !tracked.has(inn))) continue;

    const current = grouped.get(inn) ?? {
      external_id: `fns-open-data:${inn}`,
      inn,
      company_name: null,
      ogrn: null,
      employee_count: null,
      msp_category: null,
      okved: null,
      okved_description: null,
      status: null,
      source_url: null,
      risk_flags: [],
      exclusion_flags: [],
      latest_period: null,
      latest_headcount_period: null,
      latest_sme_period: null,
    };

    current.company_name ||= cleanText(raw.company_name ?? raw.name);
    current.ogrn ||= cleanText(raw.ogrn ?? raw.OGRN);
    current.okved ||= cleanText(raw.okved ?? raw.main_okved);
    current.okved_description ||= cleanText(raw.okved_description ?? raw.activity_description);
    current.source_url = pickSourceUrl(current.source_url, raw.source_url);

    const period = cleanText(raw.period ?? raw.year);
    const dataset = cleanText(raw.dataset)?.toLowerCase() ?? '';
    if (period && (!current.latest_period || period > current.latest_period)) current.latest_period = period;

    if (dataset === 'headcount' && isNewer(period, current.latest_headcount_period)) {
      current.employee_count = finiteNumber(raw.employee_count ?? raw.staff_count);
      current.latest_headcount_period = period;
    }

    if ((dataset === 'sme-registry' || dataset === 'rsmp') && isNewer(period, current.latest_sme_period)) {
      current.msp_category = cleanText(raw.msp_category ?? raw.smb_category ?? raw.sme_status ?? raw.category);
      current.status = cleanText(raw.status ?? raw.sme_status);
      current.latest_sme_period = period;
    }

    if (dataset === 'tax-offence' || dataset === 'tax-offences') {
      pushUnique(current.risk_flags, 'tax-offence-or-penalty');
    }

    if (dataset === 'tax-regime') {
      const regime = cleanText(raw.tax_regime);
      if (regime) pushUnique(current.exclusion_flags, `tax-regime:${regime}`);
    }

    grouped.set(inn, current);
  }

  return [...grouped.values()].map((record) => {
    const {
      latest_period,
      latest_headcount_period,
      latest_sme_period,
      ...normalized
    } = record;
    return {
      ...normalized,
      detected_at: /^\d{4}$/.test(latest_period ?? '')
        ? `${latest_period}-12-31T00:00:00.000Z`
        : undefined,
    };
  });
}

export const resolveTransparentBusinessFnsConfiguredInput = resolveTransparentBusinessFnsInput;
export const buildFetchSummary = runtime.buildFetchSummary;

export async function runTransparentBusinessFnsCli(argv = process.argv.slice(2)) {
  await runtime.runCli(argv, resolveTransparentBusinessFnsConfiguredInput);
}

function parseTrackedInns(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  return value
    .split(/[\s,;]+/)
    .map(normalizeLegalEntityInn)
    .filter((inn, index, values) => inn && values.indexOf(inn) === index);
}

function normalizeLegalEntityInn(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return /^\d{10}$/.test(digits) ? digits : null;
}

function cleanText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function isNewer(candidate, current) {
  if (!current) return true;
  if (!candidate) return false;
  return candidate >= current;
}

function pickSourceUrl(current, candidate) {
  const value = cleanText(candidate);
  return value?.startsWith('https://') ? value : current;
}

function pushUnique(values, value) {
  if (!values.includes(value)) values.push(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runTransparentBusinessFnsCli();
}
