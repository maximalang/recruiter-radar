import { describe, it, expect } from '@jest/globals'
import { HiringPatternDetector, type HiringPattern, type LeadCandidate } from '@/lib/lead-discovery/hiring-pattern-detector'

describe('HiringPatternDetector', () => {
  const sampleVacancies = [
    {
      id: '1',
      name: 'Senior Frontend Developer',
      employer: { id: 'company1', name: 'TechCorp' },
      salary: { from: 200000, to: 300000, currency: 'RUB' },
      published_at: '2024-05-28T10:00:00Z',
      area: { id: '1', name: 'Москва' },
      requirement: 'React, TypeScript',
      responsibility: 'Разработка UI'
    },
    {
      id: '2',
      name: 'Backend Developer',
      employer: { id: 'company1', name: 'TechCorp' },
      salary: { from: 250000, to: 350000, currency: 'RUB' },
      published_at: '2024-05-28T11:00:00Z',
      area: { id: '1', name: 'Москва' },
      requirement: 'Node.js, Python',
      responsibility: 'API разработка'
    },
    {
      id: '3',
      name: 'Product Manager',
      employer: { id: 'company1', name: 'TechCorp' },
      salary: { from: 300000, to: 400000, currency: 'RUB' },
      published_at: '2024-05-28T12:00:00Z',
      area: { id: '1', name: 'Москва' },
      requirement: 'Strategy, Analytics',
      responsibility: 'Продуктовая стратегия'
    },
    {
      id: '4',
      name: 'Junior Developer',
      employer: { id: 'company2', name: 'StartupXYZ' },
      salary: { from: 150000, to: 200000, currency: 'RUB' },
      published_at: '2024-05-27T10:00:00Z',
      area: { id: '2', name: 'Санкт-Петербург' },
      requirement: 'JavaScript, React',
      responsibility: 'Frontend задачи'
    }
  ]

  describe('analyzeVacancies', () => {
    it('identifies companies with burst hiring', () => {
      const patterns = HiringPatternDetector.analyzeVacancies(sampleVacancies)
      console.log('Patterns found:', patterns)

      const techCorp = patterns.find(p => p.companyId === 'company1')
      expect(techCorp).toBeDefined()
      expect(techCorp?.totalScore).toBeGreaterThan(1.0)
      expect(techCorp?.vacancyCount).toBe(3)
      expect(techCorp?.signals.some(s => s.signalType === 'burst')).toBe(true)
    })

    it('calculates role diversity correctly', () => {
      const patterns = HiringPatternDetector.analyzeVacancies(sampleVacancies)

      const techCorp = patterns.find(p => p.companyId === 'company1')
      expect(techCorp).toBeDefined()
      expect(techCorp?.roleDiversity).toBe(2) // tech, management (Product Manager is categorized as management, not hr)
      expect(techCorp?.signals.some(s => s.signalType === 'diverse')).toBe(true)
    })

    it('scores premium salaries', () => {
      const patterns = HiringPatternDetector.analyzeVacancies(sampleVacancies)

      const techCorp = patterns.find(p => p.companyId === 'company1')
      expect(techCorp).toBeDefined()
      expect(techCorp?.averageSalary).toBeGreaterThan(200000)
      expect(techCorp?.signals.some(s => s.signalType === 'premium')).toBe(true)
    })

    it('filters out low-scoring companies', () => {
      const patterns = HiringPatternDetector.analyzeVacancies(sampleVacancies)

      // StartupXYZ should not appear as it only has 1 vacancy
      const startup = patterns.find(p => p.companyId === 'company2')
      expect(startup).toBeUndefined()
    })

    it('sorts patterns by score descending', () => {
      const patterns = HiringPatternDetector.analyzeVacancies(sampleVacancies)

      expect(patterns.length).toBeGreaterThan(0)
      for (let i = 0; i < patterns.length - 1; i++) {
        expect(patterns[i].totalScore).toBeGreaterThanOrEqual(patterns[i + 1].totalScore)
      }
    })
  })

  describe('categorizeRole', () => {
    it('correctly categorizes tech roles', () => {
      expect(HiringPatternDetector['categorizeRole']('Frontend Developer')).toBe('tech')
      expect(HiringPatternDetector['categorizeRole']('Backend Engineer')).toBe('tech')
      expect(HiringPatternDetector['categorizeRole']('Full Stack Developer')).toBe('tech')
    })

    it('correctly categorizes management roles', () => {
      expect(HiringPatternDetector['categorizeRole']('Product Manager')).toBe('management')
      expect(HiringPatternDetector['categorizeRole']('Engineering Director')).toBe('management')
      expect(HiringPatternDetector['categorizeRole']('VP of Engineering')).toBe('management')
    })

    it('correctly categorizes HR roles', () => {
      expect(HiringPatternDetector['categorizeRole']('HR Business Partner')).toBe('hr')
      expect(HiringPatternDetector['categorizeRole']('Recruiter')).toBe('hr')
      expect(HiringPatternDetector['categorizeRole']('Talent Acquisition Manager')).toBe('hr')
    })

    it('correctly categorizes sales roles', () => {
      expect(HiringPatternDetector['categorizeRole']('Sales Manager')).toBe('sales')
      expect(HiringPatternDetector['categorizeRole']('Business Development')).toBe('sales')
    })

    it('correctly categorizes finance roles', () => {
      expect(HiringPatternDetector['categorizeRole']('Finance Controller')).toBe('finance')
      expect(HiringPatternDetector['categorizeRole']('Senior Accountant')).toBe('finance')
    })

    it('defaults to other for uncategorized roles', () => {
      expect(HiringPatternDetector['categorizeRole']('Marketing Specialist')).toBe('other')
      expect(HiringPatternDetector['categorizeRole']('Office Manager')).toBe('other')
    })
  })

  describe('digestToLeadCandidates', () => {
    const sampleDigestItems = [
      {
        rank: 1,
        org_id: 'company1',
        hh_employer_id: 'emp1',
        employer_name: 'TechCorp',
        vacancies_count: 5,
        distinct_vacancy_names_count: 3,
        latest_published_at: '2024-05-28T10:00:00Z',
        total_score: 350,
        confidence_gate: 'A', // Add confidence gate
        reasons: ['high hiring activity', 'diverse roles'],
        opener: 'Компания активно нанимает',
        source_families: ['hh'],
        evidence_titles: ['Frontend Developer', 'Backend Developer', 'Product Manager'],
        candidate_source_keys: [],
        location_names: ['Москва']
      }
    ]

    it('converts digest items to lead candidates', () => {
      const candidates = HiringPatternDetector.digestToLeadCandidates(sampleDigestItems)

      expect(candidates).toHaveLength(1)
      const candidate = candidates[0]
      expect(candidate.companyId).toBe('company1')
      expect(candidate.companyName).toBe('TechCorp')
      expect(candidate.score).toBe(3.5) // 350/100
      expect(candidate.confidence).toBe('A')
      expect(candidate.signals).toHaveLength(3) // high score burst, multiple vacancies burst, and diverse signals
    })

    it('filters out low-confidence items', () => {
      const lowConfidenceItem = {
        ...sampleDigestItems[0],
        confidence_gate: 'D'
      }

      const candidates = HiringPatternDetector.digestToLeadCandidates([lowConfidenceItem])
      expect(candidates).toHaveLength(0)
    })
  })

  describe('filterByICP', () => {
    const sampleLeads: LeadCandidate[] = [
      {
        id: '1',
        companyId: 'company1',
        companyName: 'Large Corp',
        score: 3.5,
        confidence: 'A',
        signals: [],
        nextAction: 'Contact',
        reasons: [],
        detectedAt: new Date()
      },
      {
        id: '2',
        companyId: 'company2',
        companyName: 'Small Startup',
        score: 2.0,
        confidence: 'B',
        signals: [],
        nextAction: 'Contact',
        reasons: [],
        detectedAt: new Date()
      }
    ]

    it('filters by minimum score', () => {
      const filtered = HiringPatternDetector.filterByICP(sampleLeads, {
        minScore: 3.0
      })

      expect(filtered).toHaveLength(1)
      expect(filtered[0].companyId).toBe('company1')
    })

    it('returns all leads when no filters applied', () => {
      const filtered = HiringPatternDetector.filterByICP(sampleLeads, {})

      expect(filtered).toHaveLength(2)
      expect(filtered).toEqual(sampleLeads)
    })
  })
})