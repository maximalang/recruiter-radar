/**
 * Department structure extractor.
 *
 * Pure helper that surfaces department names from a career page's HTML.
 * Department breadth feeds Intent (role/function diversity) and helps
 * agencies orient outreach toward the right HR contact within a company.
 */

export interface Department {
  name: string
  confidence: 'high' | 'medium' | 'low'
}

const ENGLISH_DEPARTMENTS = [
  'engineering',
  'sales',
  'marketing',
  'hr',
  'finance',
  'legal',
  'design',
  'product',
  'support',
  'operations',
  'data',
  'analytics',
  'security',
  'devops',
  'qa',
  'research',
  'logistics',
  'procurement',
  'accounting',
] as const

const RUSSIAN_DEPARTMENTS = [
  'разработка',
  'маркетинг',
  'продажи',
  'финансы',
  'бухгалтерия',
  'логистика',
  'дизайн',
  'аналитика',
  'поддержка',
  'кадры',
  'юристы',
  'снабжение',
] as const

const KNOWN_DEPARTMENTS = new Set<string>([
  ...ENGLISH_DEPARTMENTS,
  ...RUSSIAN_DEPARTMENTS,
])

const HEADING_RE = /<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/gi
const DATA_DEPT_RE = /data-department\s*=\s*["']([^"']+)["']/gi
const HREF_RE = /href\s*=\s*["']([^"']+)["']/gi
const CAREER_PATH_RE = /\/(?:careers?|jobs?|vacancy|vacancies|rabota)\/([a-zа-яё][a-zа-яё0-9_-]*)/i

const CONFIDENCE_RANK: Record<Department['confidence'], number> = {
  low: 0,
  medium: 1,
  high: 2,
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '')
}

function canonicalize(raw: string): string | null {
  const cleaned = stripTags(raw).trim().toLowerCase()
  if (!cleaned) return null
  if (KNOWN_DEPARTMENTS.has(cleaned)) return cleaned
  return null
}

export function extractDepartments(html: string): Department[] {
  if (!html) return []

  const found = new Map<string, Department>()
  const upsert = (name: string, confidence: Department['confidence']) => {
    const existing = found.get(name)
    if (!existing || CONFIDENCE_RANK[confidence] > CONFIDENCE_RANK[existing.confidence]) {
      found.set(name, { name, confidence })
    }
  }

  for (const m of html.matchAll(HEADING_RE)) {
    const name = canonicalize(m[1])
    if (name) upsert(name, 'high')
  }

  for (const m of html.matchAll(DATA_DEPT_RE)) {
    const name = canonicalize(m[1])
    if (name) upsert(name, 'high')
  }

  for (const m of html.matchAll(HREF_RE)) {
    const href = m[1]
    const pathMatch = href.match(CAREER_PATH_RE)
    if (!pathMatch) continue
    const name = canonicalize(pathMatch[1])
    if (name) upsert(name, 'medium')
  }

  return Array.from(found.values())
}
