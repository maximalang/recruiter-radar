import { fetchWithSourcePolicy } from './source-http.mjs';

export async function fetchTelegramCompanyChannels(targets, options = {}) {
  if (!Array.isArray(targets)) throw new TypeError('Telegram company channel targets must be an array.');
  if (!options.client) throw new Error('An authenticated MTProto client is required.');
  const now = options.now instanceof Date ? options.now : new Date();
  const cutoff = now.getTime() - 45 * 86_400_000;
  const fetchCompanyPage = options.fetchCompanyPage ?? defaultCompanyPage;
  const records = [], diagnostics = [], cacheUpdates = [];
  for (const raw of targets.slice(0, 50)) {
    const target = normalize(raw);
    if (!target) { diagnostics.push({ ownershipVerified: false, error: 'invalid-target' }); continue; }
    let proof = '';
    try { proof = await fetchCompanyPage(target.ownershipProofUrl); } catch {}
    if (!new RegExp(`https?://(?:www\\.)?t\\.me/${target.username}(?:["'/?#<\\s]|$)`, 'i').test(String(proof))) { diagnostics.push({ channelUsername: target.username, ownershipVerified: false }); continue; }
    try {
      const entity = await options.client.getEntity(target.username);
      if (String(entity?.username).toLowerCase() !== target.username.toLowerCase() || entity?.broadcast !== true || entity?.megagroup === true) { diagnostics.push({ channelUsername: target.username, ownershipVerified: false, error: 'not-public-broadcast-channel' }); continue; }
      const lastMessageId = positiveInteger(options.cache?.[target.username]?.lastMessageId) ?? 0;
      const messageOptions = lastMessageId > 0 ? { limit: 50, minId: lastMessageId } : { limit: 50 };
      const messages = await options.client.getMessages(entity, messageOptions);
      let count = 0;
      let maxMessageId = lastMessageId;
      for (const message of messages ?? []) {
        const occurred = date(message?.date);
        const body = text(message?.message);
        const messageId = positiveInteger(message?.id);
        if (!messageId || messageId <= lastMessageId) continue;
        maxMessageId = Math.max(maxMessageId, messageId);
        if (!body || !occurred || occurred.getTime() < cutoff) continue;
        const eventType = classify(body);
        if (!eventType) continue;
        records.push({ external_id: `telegram-post:${target.username}:${messageId}`, company_name: target.companyName, company_domain: target.companyDomain, company_website_url: target.companyWebsiteUrl, source_url: `https://t.me/${target.username}/${messageId}`, headline: body.slice(0, 180), summary: body.slice(0, 1000), event_type: eventType, published_at: occurred.toISOString(), extraction_method: 'telegram-mtproto-public-channel-history', publisher: `Telegram public corporate channel @${target.username}`, category: 'company-channel-context' }); count += 1;
      }
      if (maxMessageId > lastMessageId) cacheUpdates.push({ channelUsername: target.username, lastMessageId: maxMessageId });
      diagnostics.push({ channelUsername: target.username, ownershipVerified: true, records: count });
    } catch (error) {
      diagnostics.push({
        channelUsername: target.username,
        ownershipVerified: false,
        error: redactSensitiveError(error, options.sensitiveValues),
      });
    }
  }
  return { records, diagnostics, cacheUpdates };
}

export async function createTelegramMtprotoClient({ apiId, apiHash, session }) {
  const id = Number(apiId);
  if (!Number.isInteger(id) || id <= 0 || !text(apiHash) || !text(session)) throw new Error('TELEGRAM_API_ID, TELEGRAM_API_HASH, and authenticated TELEGRAM_SESSION are required.');
  let client = null;
  try {
    const { TelegramClient, sessions } = await import('teleproto');
    client = new TelegramClient(new sessions.StringSession(session), id, apiHash, {
      connectionRetries: 3,
      autoReconnect: false,
    });
    await client.connect();
    if (!await client.checkAuthorization()) {
      throw new Error('not-authorized');
    }
    return client;
  } catch {
    await client?.disconnect().catch(() => {});
    throw new Error('Telegram MTProto connection or authorization failed.');
  }
}

function redactSensitiveError(error, sensitiveValues = []) {
  let message = error instanceof Error ? error.message : 'mtproto-error';
  for (const value of sensitiveValues) {
    const secret = text(value);
    if (secret) message = message.replaceAll(secret, '[redacted]');
  }
  return message.slice(0, 200);
}

function normalize(v) { const username = text(v?.channel_username ?? v?.channelUsername)?.replace(/^@/, ''); const companyName = text(v?.company_name ?? v?.companyName), companyDomain = domain(v?.company_domain ?? v?.companyDomain), companyWebsiteUrl = https(v?.company_website_url ?? v?.companyWebsiteUrl), ownershipProofUrl = https(v?.ownership_proof_url ?? v?.ownershipProofUrl); if (!/^[a-z][a-z0-9_]{4,31}$/i.test(username ?? '') || !companyName || !companyDomain || host(companyWebsiteUrl) !== companyDomain || host(ownershipProofUrl) !== companyDomain) return null; return { username, companyName, companyDomain, companyWebsiteUrl, ownershipProofUrl }; }
function classify(s) { const v = s.toLowerCase(); if (/mass hiring|массов.{0,8}(набор|наем|найм)/i.test(v)) return 'mass_hiring'; if (/hiring|ваканс|нанима|набор/i.test(v)) return 'hiring_context'; if (/office|офис|region|регион|expan|расшир/i.test(v)) return 'company_expansion'; if (/factory|production|завод|производств|launch|запуск/i.test(v)) return 'production_launch'; if (/new project|нов.{0,5}проект|direction|направлен/i.test(v)) return 'new_project'; return null; }
async function defaultCompanyPage(url) { const r = await fetchWithSourcePolicy(url, { sourceName: 'telegram-company-channels ownership', redirect: 'error', retries: 1 }); return r.text(); }
function date(v) { const d = v instanceof Date ? v : typeof v === 'number' ? new Date(v * 1000) : new Date(v); return Number.isNaN(d.getTime()) ? null : d; }
function text(v) { return typeof v === 'string' && v.trim() ? v.trim() : null; }
function https(v) { try { const u = new URL(text(v)); return u.protocol === 'https:' ? u.href : null; } catch { return null; } }
function host(v) { try { return new URL(v).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } }
function domain(v) { const s = text(v)?.toLowerCase().replace(/^www\./, ''); return s && s.includes('.') && !/[/:]/.test(s) ? s : null; }
function positiveInteger(v) { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; }
