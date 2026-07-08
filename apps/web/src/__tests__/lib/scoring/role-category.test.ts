import {
  classifyRoleCategory,
  summarizeRoleMix,
  detectSeniority,
  hasSeniorRole,
  type RoleCategory,
  type Seniority,
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

  it.each<[string, RoleCategory]>([
    ['Production Worker', 'industrial'],
    ['Machine Operator', 'industrial'],
    ['CNC Operator', 'industrial'],
    ['Welder', 'industrial'],
    ['Рабочий на производство', 'industrial'],
    ['Оператор линии', 'industrial'],
    ['Сварщик', 'industrial'],
    ['Слесарь', 'industrial'],
  ])('classifies "%s" as industrial (non-IT agency market)', (title, expected) => {
    expect(classifyRoleCategory(title)).toBe(expected)
  })

  it.each<[string, RoleCategory]>([
    ['Logistics Manager', 'logistics'],
    ['Supply Chain Analyst', 'logistics'],
    ['Warehouse Worker', 'logistics'],
    ['Forklift Driver', 'logistics'],
    ['Driver', 'logistics'],
    ['Courier', 'logistics'],
    ['Водитель категории C', 'logistics'],
    ['Курьер по доставке', 'logistics'],
    ['Логист', 'logistics'],
    ['Кладовщик', 'logistics'],
    ['Экспедитор', 'logistics'],
    ['Грузчик на склад', 'logistics'],
  ])('classifies "%s" as logistics (non-IT agency market)', (title, expected) => {
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

  it('counts industrial and logistics roles as non-tech (universality)', () => {
    // A manufacturing + logistics company — the canonical non-IT agency client.
    // These must count toward nonTechCount so the existing intent.non-tech-mix
    // bonus fires for non-IT hiring, not only for HR/Sales/Finance.
    const mix = summarizeRoleMix([
      'Сварщик',
      'Токарь',
      'Водитель',
      'Кладовщик',
      'Backend Engineer',
    ])
    expect(mix.counts.industrial).toBe(2)
    expect(mix.counts.logistics).toBe(2)
    expect(mix.counts.tech).toBe(1)
    expect(mix.nonTechCount).toBe(4)
    expect(mix.nonTechShare).toBeCloseTo(0.8, 5)
  })
})

describe('detectSeniority', () => {
  it.each<[string, Seniority]>([
    // Executive / senior — the signal executive-search agencies care about.
    ['CFO', 'senior'],
    ['Chief Financial Officer', 'senior'],
    ['CTO', 'senior'],
    ['CEO', 'senior'],
    ['Chief Operating Officer', 'senior'],
    ['VP of Engineering', 'senior'],
    ['Vice President of Sales', 'senior'],
    ['Director of Operations', 'senior'],
    ['Head of Marketing', 'senior'],
    ['Managing Director', 'senior'],
    ['General Director', 'senior'],
    ['Генеральный директор', 'senior'],
    ['Коммерческий директор', 'senior'],
    ['Финансовый директор', 'senior'],
    ['Руководитель отдела продаж', 'senior'],
    ['Начальник цеха', 'senior'],
    ['Главный инженер', 'senior'],
    ['Член правления', 'senior'],
  ])('classifies "%s" as senior', (title, expected) => {
    expect(detectSeniority(title)).toBe(expected)
  })

  it.each<[string, Seniority]>([
    ['Junior Developer', 'entry'],
    ['Intern', 'entry'],
    ['Стажёр', 'entry'],
    ['Младший специалист', 'entry'],
    ['Assistant Manager', 'entry'],
    ['Помощник руководителя', 'entry'],
  ])('classifies "%s" as entry', (title, expected) => {
    expect(detectSeniority(title)).toBe(expected)
  })

  it.each<[string, Seniority]>([
    ['Software Engineer', 'mid'],
    ['Accountant', 'mid'],
    ['Менеджер по продажам', 'mid'],
    ['Бухгалтер', 'mid'],
    ['Sales Manager', 'mid'],
  ])('classifies "%s" as mid (no seniority marker)', (title, expected) => {
    expect(detectSeniority(title)).toBe(expected)
  })

  it('treats empty/whitespace title as mid', () => {
    expect(detectSeniority('')).toBe('mid')
    expect(detectSeniority('   ')).toBe('mid')
  })

  it('detects senior inside a longer title without false-token matches', () => {
    // "director" appears as a token, not as a substring of a longer word.
    expect(detectSeniority('Regional Sales Director')).toBe('senior')
    // A plain "manager" is NOT senior — no director/head/vp/lead marker.
    expect(detectSeniority('Account Manager')).toBe('mid')
  })
})

describe('hasSeniorRole', () => {
  it('returns true when any role is senior', () => {
    expect(hasSeniorRole(['Accountant', 'CFO', 'Junior Developer'])).toBe(true)
  })

  it('returns false when no role is senior', () => {
    expect(hasSeniorRole(['Accountant', 'Sales Manager', 'Junior Developer'])).toBe(false)
  })

  it('returns false on an empty list', () => {
    expect(hasSeniorRole([])).toBe(false)
  })
})
