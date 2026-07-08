/**
 * Role category classifier.
 *
 * Recruitment agencies most often win mandates for HR, Sales, Finance,
 * operations, industrial, and logistics roles. Tech roles are commonly
 * filled in-house, via employee referral, or by tech-specialist boutiques
 * — so a company hiring outside tech is a stronger lead signal for a
 * generalist agency. Industrial (factory / production / warehouse-floor)
 * and logistics (driver / courier / supply-chain) are first-class
 * categories because they are two of the largest non-IT agency markets in
 * Russia and were previously folded into `operations` / `other`, hiding
 * them from any role-aware reasoning.
 *
 * Classification is deterministic, case-insensitive keyword matching
 * over the role title in English and Russian. First matching category
 * wins; "other" is the fallback and is treated as non-tech.
 */

export type RoleCategory =
  | 'tech'
  | 'sales'
  | 'hr'
  | 'finance'
  | 'operations'
  | 'industrial'
  | 'logistics'
  | 'other'

interface CategoryRule {
  category: RoleCategory
  keywords: string[]
}

const RULES: CategoryRule[] = [
  {
    category: 'hr',
    keywords: [
      'hr',
      'human resources',
      'recruiter',
      'recruitment',
      'talent acquisition',
      'people operations',
      'people ops',
      'персонал',
      'рекрутер',
      'рекрутинг',
      'подбор',
      'кадры',
    ],
  },
  {
    category: 'finance',
    keywords: [
      'accountant',
      'accounting',
      'finance',
      'financial',
      'cfo',
      'controller',
      'treasurer',
      'audit',
      'auditor',
      'бухгалтер',
      'финанс',
      'аудит',
      'казначей',
    ],
  },
  {
    category: 'sales',
    keywords: [
      'sales',
      'account executive',
      'account manager',
      'business development',
      'bdr',
      'sdr',
      'продаж',
      'клиент',
      'b2b',
    ],
  },
  {
    category: 'industrial',
    keywords: [
      'manufacturing',
      'factory',
      'production worker',
      'machine operator',
      'cnc',
      'welder',
      'fitter',
      'turner',
      'производств',
      'завод',
      'фабрик',
      'рабочий',
      'станочник',
      'оператор линии',
      'сварщик',
      'токарь',
      'слесарь',
      'промышленн',
    ],
  },
  {
    category: 'logistics',
    keywords: [
      'logistics',
      'supply chain',
      'warehouse',
      'warehouse worker',
      'forklift',
      'driver',
      'courier',
      'dispatcher',
      'fleet',
      'shipping',
      'freight',
      'логист',
      'склад',
      'кладовщик',
      'кладовщ',
      'водитель',
      'курьер',
      'доставк',
      'перевозк',
      'транспорт',
      'экспедитор',
      'диспетчер',
      'грузчик',
      'груз',
    ],
  },
  {
    category: 'tech',
    keywords: [
      'engineer',
      'developer',
      'programmer',
      'software',
      'devops',
      'sre',
      'data scientist',
      'data engineer',
      'ml ',
      'machine learning',
      'qa',
      'tester',
      'sysadmin',
      'system administrator',
      'разработчик',
      'программист',
      'инженер',
      'devops',
      'тестировщик',
      'администратор',
      'frontend',
      'backend',
      'fullstack',
      'full-stack',
    ],
  },
  {
    category: 'operations',
    keywords: [
      'operations',
      'project manager',
      'program manager',
      'product manager',
      'office manager',
      'operations manager',
      'операци',
      'проект',
      'офис',
    ],
  },
]

const HR_OVERRIDE_KEYWORDS = ['hr', 'recruit', 'talent', 'persona', 'персонал', 'рекрут', 'подбор']

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

export function classifyRoleCategory(title: string): RoleCategory {
  const haystack = normalize(title)
  if (!haystack) return 'other'

  for (const rule of RULES) {
    if (rule.keywords.some((k) => haystack.includes(k))) {
      if (rule.category === 'operations' && HR_OVERRIDE_KEYWORDS.some((k) => haystack.includes(k))) {
        return 'hr'
      }
      return rule.category
    }
  }
  return 'other'
}

export interface RoleMixSummary {
  total: number
  counts: Record<RoleCategory, number>
  nonTechCount: number
  nonTechShare: number
}

const ZERO_COUNTS: Record<RoleCategory, number> = {
  tech: 0,
  sales: 0,
  hr: 0,
  finance: 0,
  operations: 0,
  industrial: 0,
  logistics: 0,
  other: 0,
}

export function summarizeRoleMix(roles: string[]): RoleMixSummary {
  const counts: Record<RoleCategory, number> = { ...ZERO_COUNTS }
  for (const role of roles) {
    counts[classifyRoleCategory(role)] += 1
  }
  const total = roles.length
  const nonTechCount = total - counts.tech
  const nonTechShare = total > 0 ? nonTechCount / total : 0
  return { total, counts, nonTechCount, nonTechShare }
}

// ─── Seniority ───────────────────────────────────────────────────────────────

/**
 * Seniority level of a role title — the dominant fit signal for executive
 * search agencies, and a useful disambiguator between a company hiring a
 * C-level officer (strong lead) vs the same company hiring a junior in the
 * same function (weaker lead for an executive agency).
 *
 *   - 'senior': C-level, director, head, VP, partner, principal, lead-of,
 *               главный, руководитель, директор, начальник, завотделом,
 *               коммерческий директор, финансовый директор, CTO/CFO/COO/CMO.
 *   - 'entry':  explicit junior markers (junior, intern, стажер, младший,
 *               assistant, помощник).
 *   - 'mid':    everything else (the default for a plain "manager" / "инженер"
 *               with no seniority marker).
 *
 * Pure + deterministic, case-insensitive. 'senior' wins over 'entry' when both
 * markers appear (e.g. "junior head of" is pathological; a director is a
 * director). First-match over the SENIOR list, then ENTRY, else 'mid'.
 */
export type Seniority = 'senior' | 'mid' | 'entry'

const SENIOR_KEYWORDS: readonly string[] = [
  // English C-suite / leadership
  'c-level',
  ' cto',
  ' cfo',
  ' coo',
  ' cmo',
  ' cio',
  ' ceo',
  'chief ',
  'director',
  'head of',
  ' vp',
  'vice president',
  'partner',
  'principal',
  'managing director',
  'general manager',
  'country manager',
  // Russian leadership
  'генеральный директор',
  'коммерческий директор',
  'финансовый директор',
  'исполнительный директор',
  'директор',
  'руководитель',
  'начальник',
  'заведующий',
  'заведующая',
  'главный',
  'управляющий',
  'партнёр',
  'партнер',
  'член правления',
  'замдиректора',
  'заместитель директора',
]

const ENTRY_KEYWORDS: readonly string[] = [
  'junior',
  'intern',
  'internship',
  'стажер',
  'стажёр',
  'младший',
  'assistant',
  'помощник',
  'помощница',
  'trainee',
  'стажировка',
]

function normalizeSeniorityHaystack(title: string): string {
  // Pad with spaces so ' cto' / ' vp' match as tokens, not as substrings of
  // a longer word. Lowercased ru-RU for consistent Cyrillic folding.
  return ` ${title.trim().toLowerCase()} `
}

export function detectSeniority(title: string): Seniority {
  const haystack = normalizeSeniorityHaystack(title)
  if (haystack.trim() === '') return 'mid'

  // Senior wins over entry — a title with both markers is read as senior
  // (e.g. a directorship implied by context). This is intentionally
  // conservative for executive-search: better to surface a senior lead
  // than to bury it on a false junior token.
  if (SENIOR_KEYWORDS.some((k) => haystack.includes(k))) return 'senior'
  if (ENTRY_KEYWORDS.some((k) => haystack.includes(k))) return 'entry'
  return 'mid'
}

/**
 * Whether a list of role titles contains at least one senior role. Used by
 * mode-aware ranking/explanation to decide whether an executive-search agency
 * gets a seniority reason line, without re-deriving the count at every call.
 */
export function hasSeniorRole(roles: readonly string[]): boolean {
  return roles.some((r) => detectSeniority(r) === 'senior')
}
