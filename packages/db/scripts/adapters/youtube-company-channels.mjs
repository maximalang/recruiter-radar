import { fetchWithSourcePolicy } from './source-http.mjs';

const API_ROOT = 'https://www.googleapis.com/youtube/v3';
const LOOKBACK_DAYS = 45;

export async function fetchYouTubeCompanyChannels(targets, options = {}) {
  if (!Array.isArray(targets)) throw new TypeError('YouTube targets must be an array.');
  const apiKey = text(options.apiKey);
  if (!apiKey) throw new Error('YOUTUBE_API_KEY is required.');
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const fetchCompanyPage = options.fetchCompanyPage ?? defaultFetchCompanyPage;
  const remainingUnits = Number(options.quota?.remainingUnits ?? 0);
  const cutoff = (options.now instanceof Date ? options.now : new Date()).getTime() - LOOKBACK_DAYS * 86_400_000;
  const records = [], diagnostics = [], cacheUpdates = [];
  let quotaUsed = 0;

  for (const raw of targets.slice(0, 50)) {
    const target = normalizeTarget(raw);
    if (!target) { diagnostics.push({ ownershipVerified: false, error: 'invalid-target' }); continue; }
    if (remainingUnits - quotaUsed < 2) { diagnostics.push({ channelId: target.channelId, deferred: 'quota-budget' }); continue; }
    let proof;
    try { proof = await fetchCompanyPage(target.ownershipProofUrl); } catch { proof = ''; }
    if (!containsExactChannelLink(proof, target.channelId)) { diagnostics.push({ channelId: target.channelId, ownershipVerified: false }); continue; }

    const channel = await getJson(`${API_ROOT}/channels?part=snippet,contentDetails&id=${encodeURIComponent(target.channelId)}&key=${encodeURIComponent(apiKey)}&fields=items(id,snippet/title,contentDetails/relatedPlaylists/uploads)`, { fetchImpl });
    quotaUsed += 1;
    const item = channel.value?.items?.[0];
    if (item?.id !== target.channelId || !item?.contentDetails?.relatedPlaylists?.uploads) { diagnostics.push({ channelId: target.channelId, ownershipVerified: false }); continue; }
    const cachedEtag = options.cache?.[target.channelId]?.etag;
    const uploads = await getJson(`${API_ROOT}/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(item.contentDetails.relatedPlaylists.uploads)}&maxResults=25&key=${encodeURIComponent(apiKey)}&fields=etag,items(id,snippet(title,description,resourceId/videoId,videoOwnerChannelId),contentDetails/videoPublishedAt)`, { fetchImpl, etag: cachedEtag });
    quotaUsed += 1;
    if (uploads.notModified) { diagnostics.push({ channelId: target.channelId, ownershipVerified: true, notModified: true }); continue; }
    for (const upload of uploads.value?.items ?? []) {
      if (upload.snippet?.videoOwnerChannelId !== target.channelId) continue;
      const occurred = new Date(upload.contentDetails?.videoPublishedAt);
      if (Number.isNaN(occurred.getTime()) || occurred.getTime() < cutoff) continue;
      const videoId = text(upload.snippet?.resourceId?.videoId);
      if (!videoId) continue;
      const headline = text(upload.snippet?.title) ?? `${target.companyName} video`;
      records.push({
        external_id: `youtube-video:${videoId}`, company_name: target.companyName,
        company_domain: target.companyDomain, company_website_url: target.companyWebsiteUrl,
        source_url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
        headline, summary: text(upload.snippet?.description), event_type: classifyEvent(headline, upload.snippet?.description),
        published_at: occurred.toISOString(), extraction_method: 'youtube-data-api-uploads-playlist',
        publisher: `YouTube company channel ${item.snippet?.title ?? target.channelId}`,
        category: 'company-video-context', context_only: true,
      });
    }
    if (uploads.etag) cacheUpdates.push({ channelId: target.channelId, etag: uploads.etag });
    diagnostics.push({ channelId: target.channelId, ownershipVerified: true, records: records.length });
  }
  return { records, diagnostics, cacheUpdates, quotaUsed };
}

async function getJson(url, { fetchImpl, etag }) {
  const headers = { Accept: 'application/json' };
  if (etag) headers['If-None-Match'] = etag;
  const response = await fetchWithSourcePolicy(url, { headers, redirect: 'error', fetchImpl, sourceName: 'youtube-company-channels', retries: 1 });
  if (response.status === 304) return { notModified: true, etag, value: null };
  if (!response.ok) throw new Error(`YouTube Data API returned HTTP ${response.status}`);
  return { notModified: false, etag: response.headers.get('etag'), value: await response.json() };
}

function normalizeTarget(value) {
  const channelId = text(value?.channel_id ?? value?.channelId), companyName = text(value?.company_name ?? value?.companyName);
  const companyDomain = domain(value?.company_domain ?? value?.companyDomain), companyWebsiteUrl = url(value?.company_website_url ?? value?.companyWebsiteUrl);
  const ownershipProofUrl = url(value?.ownership_proof_url ?? value?.ownershipProofUrl);
  if (!/^UC[A-Za-z0-9_-]{6,}$/.test(channelId ?? '') || !companyName || !companyDomain || !companyWebsiteUrl || !ownershipProofUrl) return null;
  if (host(companyWebsiteUrl) !== companyDomain || host(ownershipProofUrl) !== companyDomain) return null;
  return { channelId, companyName, companyDomain, companyWebsiteUrl, ownershipProofUrl };
}

function containsExactChannelLink(html, id) { return new RegExp(`https?://(?:www\\.)?youtube\\.com/channel/${id}(?:["'/?#<\\s]|$)`, 'i').test(String(html)); }
function classifyEvent(...values) { const s = values.join(' ').toLowerCase(); if (/office|region|expan|офис|регион|расшир/.test(s)) return 'company_expansion'; if (/launch|запуск|production|производств/.test(s)) return 'product_launch'; if (/hiring|vacanc|career|ваканс|нанима/.test(s)) return 'hiring_context'; return 'company_news'; }
async function defaultFetchCompanyPage(target) { const r = await fetchWithSourcePolicy(target, { redirect: 'error', sourceName: 'youtube-company-channels ownership', retries: 1 }); if (!r.ok) throw new Error(`ownership page HTTP ${r.status}`); return r.text(); }
function text(v) { return typeof v === 'string' && v.trim() ? v.trim() : null; }
function url(v) { try { const u = new URL(text(v)); return u.protocol === 'https:' ? u.href : null; } catch { return null; } }
function host(v) { try { return new URL(v).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } }
function domain(v) { const s = text(v)?.toLowerCase().replace(/^www\./, ''); return s && s.includes('.') && !/[/:]/.test(s) ? s : null; }
