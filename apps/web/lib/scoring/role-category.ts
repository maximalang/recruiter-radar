/**
 * Role category classifier.
 *
 * Recruitment agencies most often win mandates for HR, Sales, Finance,
 * and operations roles. Tech roles are commonly filled in-house, via
 * employee referral, or by tech-specialist boutiques — so a company
 * hiring outside tech is a stronger lead signal for a generalist agency.
 *
 * Classification is deterministic, case-insensitive keyword matching
 * over the role title in English and Russian. First matching category
 * wins; "other" is the fallback and is treated as non-tech.
 */

export type RoleCategory = 'tech' | 'sales' | 'hr' | 'finance' | 'operations' | 'other'

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
