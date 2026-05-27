/**
 * Career-page contact-path extractor.
 *
 * Pure helper for finding multiple categorized contact paths in raw HTML/text
 * pulled from a company career page. Output feeds Reachability scoring and
 * outreach automation: we want as many independent safe contact channels as
 * we can find, ranked by how purpose-built they are for hiring (HR mailbox >
 * generic info > personal email).
 */

export type ContactCategory =
  | 'hr-email'
  | 'careers-email'
  | 'generic-email'
  | 'personal-email'
  | 'phone'
  | 'contact-form'
  | 'telegram'
  | 'whatsapp'

export interface ContactPath {
  category: ContactCategory
  value: string
  confidence: 'high' | 'medium' | 'low'
}

const HR_LOCAL_PARTS = new Set([
  'hr',
  'recruit',
  'recruiter',
  'recruiters',
  'recruiting',
  'recruitment',
  'talent',
  'people',
  'hire',
  'hiring',
  'jobs',
  'job',
  'kadry',
  'personal',
])

const CAREERS_LOCAL_PARTS = new Set([
  'career',
  'careers',
  'vacancy',
  'vacancies',
  'rabota',
])

const GENERIC_LOCAL_PARTS = new Set([
  'info',
  'contact',
  'contacts',
  'hello',
  'support',
  'office',
  'mail',
  'admin',
  'team',
  'help',
  'sales',
])

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const MAILTO_RE = /mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/gi
const HREF_RE = /href\s*=\s*["']([^"']+)["']/gi
const TEL_HREF_RE = /href\s*=\s*["']tel:([+\d\s\-()]+)["']/gi
const PHONE_TEXT_RE = /\+7[\s\-]*\(?\d{3}\)?[\s\-]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/g
const TG_RE = /https?:\/\/t\.me\/[A-Za-z0-9_]+/gi
const WA_RE = /https?:\/\/wa\.me\/\d+/gi
const CONTACT_PATH_RE = /\/(contacts?|feedback)(?:\/|$|\?)/i

function classifyEmail(email: string): {
  category: ContactCategory
  confidence: 'high' | 'medium' | 'low'
} {
  const local = email.split('@')[0].toLowerCase()
  if (HR_LOCAL_PARTS.has(local)) return { category: 'hr-email', confidence: 'high' }
  if (CAREERS_LOCAL_PARTS.has(local)) return { category: 'careers-email', confidence: 'high' }
  if (GENERIC_LOCAL_PARTS.has(local)) return { category: 'generic-email', confidence: 'medium' }
  if (/^[a-z]+[.\-][a-z]+$/.test(local)) {
    return { category: 'personal-email', confidence: 'low' }
  }
  return { category: 'generic-email', confidence: 'medium' }
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '')
  if (!digits.startsWith('+')) return null
  if (digits.length < 8) return null
  return digits
}

function resolveUrl(href: string, baseUrl?: string): string | null {
  try {
    if (/^https?:\/\//i.test(href)) return href
    if (!baseUrl) return null
    return new URL(href, baseUrl).toString()
  } catch {
    return null
  }
}

export function extractContactPaths(html: string, baseUrl?: string): ContactPath[] {
  if (!html) return []

  const out: ContactPath[] = []
  const seen = new Set<string>()
  const push = (path: ContactPath) => {
    const key = `${path.category}:${path.value}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(path)
  }

  const emails = new Set<string>()
  for (const m of html.matchAll(MAILTO_RE)) emails.add(m[1].toLowerCase())
  for (const m of html.matchAll(EMAIL_RE)) emails.add(m[0].toLowerCase())
  for (const email of emails) {
    const { category, confidence } = classifyEmail(email)
    push({ category, value: email, confidence })
  }

  const phones = new Set<string>()
  for (const m of html.matchAll(TEL_HREF_RE)) {
    const n = normalizePhone(m[1])
    if (n) phones.add(n)
  }
  for (const m of html.matchAll(PHONE_TEXT_RE)) {
    const n = normalizePhone(m[0])
    if (n) phones.add(n)
  }
  for (const phone of phones) push({ category: 'phone', value: phone, confidence: 'medium' })

  for (const m of html.matchAll(HREF_RE)) {
    const href = m[1]
    if (/^(mailto|tel):/i.test(href)) continue
    if (!CONTACT_PATH_RE.test(href)) continue
    const resolved = resolveUrl(href, baseUrl)
    if (!resolved) continue
    push({ category: 'contact-form', value: resolved, confidence: 'medium' })
  }

  for (const m of html.matchAll(TG_RE)) {
    push({ category: 'telegram', value: m[0], confidence: 'medium' })
  }
  for (const m of html.matchAll(WA_RE)) {
    push({ category: 'whatsapp', value: m[0], confidence: 'medium' })
  }

  return out
}
