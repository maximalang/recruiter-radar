import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetchYouTubeCompanyChannels } from './adapters/youtube-company-channels.mjs';
import { normalizeContextEventRecord } from './adapters/rf-source-normalizers.mjs';
import { createStandardSourceRuntime, loadEnvFile, parseJson } from './adapters/rf-source-runtime.mjs';
import { stripBom } from './adapters/source-records.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const SOURCE_ID = 'youtube-company-channels';
const DEFAULT_CACHE = resolve(scriptDir, './.cache/youtube-company-channels-state.json');
loadEnvFile(resolve(scriptDir, '../../../.env'));

const runtime = createStandardSourceRuntime({
  sourceId: SOURCE_ID, signalType: 'other', evidenceRole: 'context', sourceRecordType: 'youtube_company_video',
  inputFileEnvName: 'YOUTUBE_COMPANY_CHANNELS_INPUT_FILE',
  usageText: 'Input: YOUTUBE_COMPANY_CHANNELS_TARGETS_JSON/FILE plus YOUTUBE_API_KEY. Company-owned channels only.',
  normalizeRecord: (record, context) => normalizeContextEventRecord(record, context, { sourceRecordType: 'youtube_company_video', defaultEventType: 'company_news', contextOnly: true }),
  buildSummaryExtras: (input) => input.inputMode === 'live-api' ? { liveProvider: 'youtube-data-api-v3', targetsProcessed: input.targetsProcessed, ownershipVerified: input.ownershipVerified, quotaUsed: input.quotaUsed, deferredTargets: input.deferredTargets, zeroReason: input.zeroReason ?? undefined } : {},
});

export function resolveYouTubeCompanyChannelsInput() {
  const file = process.env.YOUTUBE_COMPANY_CHANNELS_INPUT_FILE?.trim();
  if (file) return runtime.resolveFileInput(file);
  const targetsFile = process.env.YOUTUBE_COMPANY_CHANNELS_TARGETS_FILE?.trim();
  const targetsJson = process.env.YOUTUBE_COMPANY_CHANNELS_TARGETS_JSON?.trim();
  if (!targetsFile && !targetsJson) throw new Error('No YouTube company channel targets configured.');
  const targets = targetsFile ? parseJson(stripBom(readFileSync(resolve(process.cwd(), targetsFile), 'utf8')), targetsFile) : parseJson(targetsJson, 'YOUTUBE_COMPANY_CHANNELS_TARGETS_JSON');
  return { inputMode: 'live-pending', targets };
}

export async function resolveYouTubeCompanyChannelsLiveInput({ targets }, options = {}) {
  const cachePath = resolve(process.cwd(), process.env.YOUTUBE_COMPANY_CHANNELS_CACHE_FILE?.trim() || DEFAULT_CACHE);
  const state = readState(cachePath);
  const fetched = await fetchYouTubeCompanyChannels(targets, { apiKey: process.env.YOUTUBE_API_KEY, cache: state.channels, quota: { remainingUnits: Number(process.env.YOUTUBE_DAILY_QUOTA_BUDGET ?? 100) - Number(state.quotaUsed ?? 0) }, fetchImpl: options.fetchImpl, fetchCompanyPage: options.fetchCompanyPage, now: options.now });
  writeState(cachePath, state, fetched);
  return runtime.buildInputFromRecords({ inputMode: 'live-api', inputFilePath: null, records: fetched.records, rejectAllSkipped: true, extra: { targetsProcessed: targets.length, ownershipVerified: fetched.diagnostics.filter((x) => x.ownershipVerified).length, quotaUsed: fetched.quotaUsed, deferredTargets: fetched.diagnostics.filter((x) => x.deferred).length, zeroReason: fetched.records.length ? null : 'no-recent-company-videos' } });
}
export async function resolveYouTubeCompanyChannelsConfiguredInput(options = {}) { const input = resolveYouTubeCompanyChannelsInput(); return input.inputMode === 'live-pending' ? resolveYouTubeCompanyChannelsLiveInput(input, options) : input; }
export const buildFetchSummary = runtime.buildFetchSummary;
export async function runYouTubeCompanyChannelsCli(argv = process.argv.slice(2)) { await runtime.runCli(argv, resolveYouTubeCompanyChannelsConfiguredInput); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runYouTubeCompanyChannelsCli();

function readState(path) { try { const s = JSON.parse(stripBom(readFileSync(path, 'utf8'))); return s?.version === 1 ? s : freshState(); } catch { return freshState(); } }
function freshState() { return { version: 1, quotaDate: new Date().toISOString().slice(0, 10), quotaUsed: 0, channels: {} }; }
function writeState(path, prior, fetched) {
  const today = new Date().toISOString().slice(0, 10), sameDay = prior.quotaDate === today;
  const next = { version: 1, quotaDate: today, quotaUsed: (sameDay ? Number(prior.quotaUsed ?? 0) : 0) + fetched.quotaUsed, channels: { ...prior.channels } };
  for (const x of fetched.cacheUpdates) next.channels[x.channelId] = { etag: x.etag, updatedAt: new Date().toISOString() };
  mkdirSync(dirname(path), { recursive: true }); const temp = `${path}.${process.pid}.tmp`; writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`); renameSync(temp, path);
}
