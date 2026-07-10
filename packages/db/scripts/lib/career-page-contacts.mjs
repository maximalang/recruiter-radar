/**
 * Career-page contact extractor (ingest-side, deterministic).
 *
 * Mirrors the production TS extractor (apps/web/lib/scoring/contact-paths.ts)
 * so the ingest-time crawler and the runtime scorer agree on what counts as a
 * safe contact surface. Runs on raw career-page HTML the crawler already
 * fetched — no extra network, no fabrication. Every value is pulled verbatim
 * from the page (mail/tel href, visible text, t.me/wa.me link).
 *
 * Output is a compact, deduped contact-paths array persisted into
 * `signals.payload.contact_paths` (JSONB — no migration) so the digest SQL
 * query, the lead detail page, and FIUR reachability can all see the concrete
 * corporate surface the system found automatically.
 *
 * Categories (must match contact-paths.ts so contact-policy filtering works):
 *   hr-email        — hiring-purpose mailbox (hr/recruit/jobs/kadry/…)
 *   careers-email   — career/vacancy/rabota local-part
 *   generic-email   — info/contact/hello/office/… (safe non-personal)
 *   personal-email  — first.last pattern (LOW confidence; policy may exclude)
 *   phone           — +7 RU phone from tel: href or visible text
 *   contact-form    — /contacts or /feedback URL on the same domain
 *   telegram        — t.me link
 *   whatsapp        — wa.me link
 *
 * Conservative by design: a missed contact is cheap (AI enrichment can still
 * run), a fabricated one is expensive (it becomes false evidence the agency
 * acts on). So we require a real matched value, never synthesize one.
 */

/** Local-parts that mark a mailbox as hiring-purpose (HR / recruiting). */
const HR_LOCAL_PARTS = new Set([
  'hr', 'recruit', 'recruiter', 'recruiters', 'recruiting', 'recruitment',
  'talent', 'people', 'hire', 'hiring', 'jobs', 'job', 'kadry', 'personal',
]);

/** Local-parts that mark a mailbox as career/vacancy-specific. */
const CAREERS_LOCAL_PARTS = new Set([
  'career', 'careers', 'vacancy', 'vacancies', 'rabota',
]);

/** Generic but non-personal mailboxes (safe for all contact policies). */
const GENERIC_LOCAL_PARTS = new Set([
  'info', 'contact', 'contacts', 'hello', 'support', 'office', 'mail',
  'admin', 'team', 'help', 'sales',
]);

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const MAILTO_RE = /mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/gi;
const HREF_RE = /href\s*=\s*["']([^"']+)["']/gi;
const TEL_HREF_RE = /href\s*=\s*["']tel:([+\d\s\-()]+)["']/gi;
// +7 and 8 (RU domestic) phone shapes, with optional separators. Requires a
// leading +7 or 8 + 10 digits so a stray number in copy text does not misfire.
const PHONE_TEXT_RE = /(?:\+7|8)[\s\-]*\(?\d{3}\)?[\s\-]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/g;
const TG_RE = /https?:\/\/t\.me\/[A-Za-z0-9_]+/gi;
const WA_RE = /https?:\/\/wa\.me\/\d+/gi;
const CONTACT_PATH_RE = /\/(contacts?|feedback|obratnaya-svyaz|svyaz)(?:\/|$|\?)/i;

/** Classification outcome: category + how much to trust it. */
function classifyEmail(email) {
  const local = email.split('@')[0].toLowerCase();
  if (HR_LOCAL_PARTS.has(local)) return { category: 'hr-email', confidence: 'high' };
  if (CAREERS_LOCAL_PARTS.has(local)) return { category: 'careers-email', confidence: 'high' };
  if (GENERIC_LOCAL_PARTS.has(local)) return { category: 'generic-email', confidence: 'medium' };
  // first.last / first-last = likely a person → low confidence, policy-gated.
  if (/^[a-z]+[.\-][a-z]+$/.test(local)) {
    return { category: 'personal-email', confidence: 'low' };
  }
  return { category: 'generic-email', confidence: 'medium' };
}

function normalizePhone(raw) {
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.length < 8) return null;
  // Normalize RU domestic 8XXX → +7XXX so downstream display is consistent.
  if (digits.startsWith('8')) return `+7${digits.slice(1)}`;
  return digits.startsWith('+') ? digits : `+${digits}`;
}

function resolveUrl(href, baseUrl) {
  try {
    if (/^https?:\/\//i.test(href)) return href;
    if (!baseUrl) return null;
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Extract categorized, deduped contact paths from career-page HTML.
 *
 * @param {string} html   Raw career-page HTML (already fetched by the crawler).
 * @param {string|null} [baseUrl] Career-page URL, used to resolve relative
 *   contact-form links and same-domain form paths. Optional.
 * @returns {Array<{category: string, value: string, confidence: string}>}
 *   Deduped contact paths (category + value + confidence). Empty array when
 *   the page carries no contact surface — the caller records `contact_paths: []`
 *   so downstream reachability is gated honestly (no inflation).
 */
export function extractCareerPageContactPaths(html, baseUrl = null) {
  if (typeof html !== 'string' || html.length === 0) return [];

  const out = [];
  const seen = new Set();
  const push = (path) => {
    const key = `${path.category}:${path.value}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(path);
  };

  // Emails: prefer mailto: hrefs (explicit), then any visible address. A page
  // often lists the same address both ways — dedupe handles it.
  const emails = new Set();
  for (const m of html.matchAll(MAILTO_RE)) emails.add(m[1].toLowerCase());
  for (const m of html.matchAll(EMAIL_RE)) emails.add(m[0].toLowerCase());
  for (const email of emails) {
    const { category, confidence } = classifyEmail(email);
    push({ category, value: email, confidence });
  }

  // Phones: prefer tel: hrefs (structured), then visible RU phone text.
  const phones = new Set();
  for (const m of html.matchAll(TEL_HREF_RE)) {
    const n = normalizePhone(m[1]);
    if (n) phones.add(n);
  }
  for (const m of html.matchAll(PHONE_TEXT_RE)) {
    const n = normalizePhone(m[0]);
    if (n) phones.add(n);
  }
  for (const phone of phones) push({ category: 'phone', value: phone, confidence: 'medium' });

  // Contact / feedback form URLs on the same domain (RU + EN path patterns).
  for (const m of html.matchAll(HREF_RE)) {
    const href = m[1];
    if (/^(mailto|tel):/i.test(href)) continue;
    if (!CONTACT_PATH_RE.test(href)) continue;
    const resolved = resolveUrl(href, baseUrl);
    if (!resolved) continue;
    push({ category: 'contact-form', value: resolved, confidence: 'medium' });
  }

  // Messengers: t.me / wa.me links. Telegram HR bots are a common RU contact
  // surface for hiring.
  for (const m of html.matchAll(TG_RE)) {
    push({ category: 'telegram', value: m[0], confidence: 'medium' });
  }
  for (const m of html.matchAll(WA_RE)) {
    push({ category: 'whatsapp', value: m[0], confidence: 'medium' });
  }

  return out;
}

/**
 * Compress contact paths to a compact, payload-friendly shape.
 * Drops the `confidence` field for storage (recoverable from category) and
 * caps the count so a contact-heavy page does not bloat every signal payload.
 */
const MAX_PERSISTED_CONTACT_PATHS = 6;

export function toPersistableContactPaths(paths) {
  if (!Array.isArray(paths)) return [];
  // Rank: HR/careers first (the surfaces the agency actually wants), then
  // generic, then messengers, then phone, then form, then personal last.
  const rank = {
    'hr-email': 0, 'careers-email': 1, 'generic-email': 2,
    'telegram': 3, 'whatsapp': 4, 'phone': 5, 'contact-form': 6, 'personal-email': 7,
  };
  return paths
    .slice()
    .sort((a, b) => (rank[a.category] ?? 99) - (rank[b.category] ?? 99))
    .slice(0, MAX_PERSISTED_CONTACT_PATHS)
    .map((p) => ({ category: p.category, value: p.value }));
}
