import {
  classifyRoleCategory,
  summarizeRoleMix,
  type RoleCategory,
} from '@/lib/scoring/role-category'

describe('classifyRoleCategory', () => {
  it.each<[string, RoleCategory]>([
    ['Backend Engineer', 'tech'],
    ['Senior Software Developer', 'tech'],
    ['Data Scientist', 'tech'],
    ['ML Engineer', 'tech'],
    ['DevOps Engineer', 'tech'],
    ['QA Automation Engineer', 'tech'],
    ['Frontend разработчик', 'tech'],
    ['Системный администратор', 'tech'],
  ])('classifies "%s" as tech', (title, expected) => {
    expect(classifyRoleCategory(title)).toBe(expected)
  })

  it.each<[string, RoleCategory]>([
    ['HR Business Partner', 'hr'],
    ['Talent Acquisition Manager', 'hr'],
    ['Recruiter', 'hr'],
    ['Менеджер по персоналу', 'hr'],
    ['Подбор персонала', 'hr'],
    ['People Operations Lead', 'hr'],
  ])('classifies "%s" as hr', (title, expected) => {
    expect(classifyRoleCategory(title)).toBe(expected)
  })

  it.each<[string, RoleCategory]>([
    ['Sales Manager', 'sales'],
    ['Account Executive', 'sales'],
    ['Business Development Representative', 'sales'],
    ['Менеджер по продажам', 'sales'],
    ['Руководитель отдела продаж', 'sales'],
  ])('classifies "%s" as sales', (title, expected) => {
    expect(classifyRoleCategory(title)).toBe(expected)
  })

  it.each<[string, RoleCategory]>([
    ['Chief Accountant', 'finance'],
    ['Financial Controller', 'finance'],
    ['Бухгалтер', 'finance'],
    ['Главный бухгалтер', 'finance'],
    ['Финансовый аналитик', 'finance'],
    ['CFO', 'finance'],
  ])('classifies "%s" as finance', (title, expected) => {
    expect(classifyRoleCategory(title)).toBe(expected)
  })

  it.each<[string, RoleCategory]>([
    ['Operations Manager', 'operations'],
    ['Project Manager', 'operations'],
    ['Менеджер проектов', 'operations'],
    ['Office Manager', 'operations'],
  ])('classifies "%s" as operations', (title, expected) => {
    expect(classifyRoleCategory(title)).toBe(expected)
  })

  it('falls back to "other" when no keyword matches', () => {
    expect(classifyRoleCategory('Yoga Instructor')).toBe('other')
    expect(classifyRoleCategory('')).toBe('other')
  })

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    expect(classifyRoleCategory('  senior BACKEND engineer  ')).toBe('tech')
    expect(classifyRoleCategory('  HR Specialist  ')).toBe('hr')
  })
})

describe('summarizeRoleMix', () => {
  it('returns zero counts on empty input', () => {
    const mix = summarizeRoleMix([])
    expect(mix.total).toBe(0)
    expect(mix.nonTechCount).toBe(0)
    expect(mix.nonTechShare).toBe(0)
    expect(mix.counts.tech).toBe(0)
  })

  it('counts each role exactly once and computes the non-tech share', () => {
    const mix = summarizeRoleMix([
      'Backend Engineer',
      'Backend Engineer',
      'HR Manager',
      'Sales Manager',
      'Chief Accountant',
    ])

    expect(mix.total).toBe(5)
    expect(mix.counts.tech).toBe(2)
    expect(mix.counts.hr).toBe(1)
    expect(mix.counts.sales).toBe(1)
    expect(mix.counts.finance).toBe(1)
    expect(mix.counts.operations).toBe(0)
    expect(mix.counts.other).toBe(0)
    expect(mix.nonTechCount).toBe(3)
    expect(mix.nonTechShare).toBeCloseTo(0.6, 5)
  })

  it('treats "other" as non-tech so it still flags outsourcing-likely roles', () => {
    const mix = summarizeRoleMix(['Yoga Instructor', 'Office Manager'])
    expect(mix.nonTechCount).toBe(2)
    expect(mix.nonTechShare).toBeCloseTo(1, 5)
  })
})
