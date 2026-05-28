/**
 * Lead Discovery System - Hiring Pattern Detection
 *
 * Identifies companies actively hiring based on patterns from multiple sources.
 * Focuses on signals that indicate immediate need for recruitment services.
 */

import type { HhDigestItem } from '@/lib/hhDigest'

export interface HiringSignal {
  companyId: string
  companyName: string
  signalType: 'burst' | 'diverse' | 'premium' | 'fresh'
  strength: number // 0-1
  evidence: string[]
  detectedAt: Date
}

export interface HiringPattern {
  companyId: string
  companyName: string
  totalScore: number // 0-4
  signals: HiringSignal[]
  vacancyCount: number
  roleDiversity: number
  averageSalary?: number
  isFresh: boolean
  hasCareerPage?: boolean
}

export interface LeadCandidate {
  id: string
  companyId: string
  companyName: string
  score: number
  confidence: 'A' | 'B' | 'C' | 'D'
  signals: HiringSignal[]
  nextAction: string
  reasons: string[]
  detectedAt: Date
}

/**
 * Detects hiring patterns from HH vacancy data
 */
export class HiringPatternDetector {
  /**
   * Analyzes a list of vacancies to identify hiring patterns
   */
  static analyzeVacancies(vacancies: Array<{
    id: string
    name: string
    employer: { id: string; name: string }
    salary?: { from?: number; to?: number; currency: string }
    published_at: string
    area?: { id: string; name: string }
    requirement?: string
    responsibility?: string
  }>): HiringPattern[] {
    const companyMap = new Map<string, any>()

    // Group vacancies by company
    vacancies.forEach(vacancy => {
      if (!companyMap.has(vacancy.employer.id)) {
        companyMap.set(vacancy.employer.id, {
          id: vacancy.employer.id,
          name: vacancy.employer.name,
          vacancies: [],
          totalSalary: 0,
          salaryCount: 0,
          locations: new Set(),
          roles: new Set(),
          publishedDates: []
        })
      }

      const company = companyMap.get(vacancy.employer.id)
      company.vacancies.push(vacancy)

      // Collect salary info
      if (vacancy.salary?.from && vacancy.salary?.to) {
        const avgSalary = (vacancy.salary.from + vacancy.salary.to) / 2
        company.totalSalary += avgSalary
        company.salaryCount++
      }

      // Extract role categories
      const roleCategory = this.categorizeRole(vacancy.name)
      company.roles.add(roleCategory)

      // Collect location info
      if (vacancy.area) {
        company.locations.add(vacancy.area.id)
      }

      // Track publication dates
      company.publishedDates.push(new Date(vacancy.published_at))
    })

    // Analyze patterns for each company
    const patterns: HiringPattern[] = []

    companyMap.forEach((company, companyId) => {
      const pattern = this.analyzeCompanyPattern(company)
      patterns.push(pattern)
    })

    // Sort by score and return top candidates
    return patterns
      .filter(p => p.totalScore > 1.0) // Lower threshold to include qualified leads
      .sort((a, b) => b.totalScore - a.totalScore)
  }

  /**
   * Categorizes a role into functional area
   */
  private static categorizeRole(roleName: string): string {
    const title = roleName.toLowerCase()

    // Tech roles (checked first as they're most specific)
    if (title.includes('developer') || title.includes('programmer') ||
        title.includes('backend') || title.includes('frontend') ||
        title.includes('fullstack') || title.includes('devops')) {
      return 'tech'
    }

    // Engineering roles (but not management)
    if ((title.includes('engineer') && !title.includes('director') && !title.includes('vp')) ||
        title.includes('tech') || title.includes('architect')) {
      return 'tech'
    }

    // Management roles
    if (title.includes('director') || title.includes('head') ||
        title.includes('vp') || title.includes('principal') ||
        title.includes('lead')) {
      return 'management'
    }

    // Product/Project Manager
    if (title.includes('product manager') || title.includes('project manager')) {
      return 'management'
    }

    // HR roles (checked before general manager)
    if (title.includes('hr') || title.includes('recruiter') ||
        title.includes('hr business partner') || title.includes('hr manager') ||
        title.includes('talent acquisition') || title.includes('chro')) {
      return 'hr'
    }

    // General manager (non-tech, non-HR)
    if (title.includes('manager') && !title.includes('engineer') && !title.includes('developer') && !title.includes('hr')) {
      // Sales Manager should be sales, not management
      if (title.includes('sales manager')) return 'sales'
      // Office Manager should be other, not management
      if (title.includes('office manager')) return 'other'
      return 'management'
    }

    // Sales roles (additional checks for cases already caught above)
    if (title.includes('sales') || title.includes('bizdev') ||
        title.includes('business development') || title.includes('account manager') ||
        title.includes('accounting')) {
      return 'sales'
    }

    // Finance roles
    if (title.includes('finance') || title.includes('accountant') ||
        title.includes('cfo') || title.includes('controller') ||
        title.includes('financial') || title.includes('accountant')) {
      return 'finance'
    }

    return 'other'
  }

  /**
   * Analyzes hiring pattern for a single company
   */
  private static analyzeCompanyPattern(company: any): HiringPattern {
    const signals: HiringSignal[] = []
    let totalScore = 0

    // 1. Burst hiring signal (3+ vacancies in short timeframe)
    if (company.vacancies.length >= 3) {
      const burstStrength = Math.min(company.vacancies.length / 10, 1) // Cap at 10 vacancies
      const burstSignal: HiringSignal = {
        companyId: company.id,
        companyName: company.name,
        signalType: 'burst',
        strength: burstStrength,
        evidence: [`Открыто ${company.vacancies.length} вакансий`],
        detectedAt: new Date()
      }
      signals.push(burstSignal)
      totalScore += burstStrength * 1.5 // 1.5x weight for burst hiring
    }

    // 2. Role diversity signal
    const roleDiversity = company.roles.size
    if (roleDiversity >= 2) {
      const diversityStrength = Math.min(roleDiversity / 5, 1)
      const diversitySignal: HiringSignal = {
        companyId: company.id,
        companyName: company.name,
        signalType: 'diverse',
        strength: diversityStrength,
        evidence: [`Вакансии в ${roleDiversity} разных областях: ${Array.from(company.roles).join(', ')}`],
        detectedAt: new Date()
      }
      signals.push(diversitySignal)
      totalScore += diversityStrength // 1x weight for diversity
    }

    // 3. Premium salary signal
    if (company.salaryCount > 0) {
      const avgSalary = company.totalSalary / company.salaryCount
      if (avgSalary > 200000) { // Above 200k RUB
        const premiumStrength = Math.min((avgSalary - 200000) / 100000, 1)
        const premiumSignal: HiringSignal = {
          companyId: company.id,
          companyName: company.name,
          signalType: 'premium',
          strength: premiumStrength,
          evidence: [`Средняя зарплата ${Math.round(avgSalary).toLocaleString()} ₽`],
          detectedAt: new Date()
        }
        signals.push(premiumSignal)
        totalScore += premiumStrength * 0.8 // 0.8x weight for premium
      }
    }

    // 4. Freshness signal (all vacancies recent)
    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const recentVacancies = company.publishedDates.filter((date: Date) => date > sevenDaysAgo)
    const freshnessRatio = recentVacancies.length / company.vacancies.length

    if (freshnessRatio === 1 && company.vacancies.length > 0) {
      const freshSignal: HiringSignal = {
        companyId: company.id,
        companyName: company.name,
        signalType: 'fresh',
        strength: 1,
        evidence: [`Все вакансии опубликованы за последние 7 дней`],
        detectedAt: new Date()
      }
      signals.push(freshSignal)
      totalScore += 0.5 // 0.5x weight for freshness
    }

    return {
      companyId: company.id,
      companyName: company.name,
      totalScore: Math.min(totalScore, 4), // Cap at 4
      signals,
      vacancyCount: company.vacancies.length,
      roleDiversity: roleDiversity,
      averageSalary: company.salaryCount > 0 ? company.totalSalary / company.salaryCount : undefined,
      isFresh: freshnessRatio > 0.8,
      hasCareerPage: false // To be determined by career pages crawler
    }
  }

  /**
   * Converts HH digest items to lead candidates
   */
  static digestToLeadCandidates(digestItems: HhDigestItem[]): LeadCandidate[] {
    return digestItems
      .filter((item: any) => !item.confidence_gate || item.confidence_gate !== 'C' && item.confidence_gate !== 'D')
      .map((item: any) => ({
        id: `lead-${item.org_id}-${Date.now()}`,
        companyId: item.org_id,
        companyName: item.employer_name,
        score: item.total_score / 100, // Convert to 0-4 scale
        confidence: this.mapConfidenceGate(item.confidence_gate),
        signals: this.extractSignalsFromItem(item),
        nextAction: 'Контакт через карьерную страницу',
        reasons: item.reasons,
        detectedAt: new Date(item.latest_published_at)
      }))
  }

  /**
   * Maps HH confidence gate to our system
   */
  private static mapConfidenceGate(hhGate: string): 'A' | 'B' | 'C' | 'D' {
    switch (hhGate) {
      case 'A': return 'A'
      default: return 'B' // Default to B for non-A items
    }
  }

  /**
   * Extracts signals from HH digest item
   */
  private static extractSignalsFromItem(item: any): HiringSignal[] {
    const signals: HiringSignal[] = []

    // High score signal
    if (item.total_score > 300) {
      signals.push({
        companyId: item.org_id,
        companyName: item.employer_name,
        signalType: 'burst',
        strength: Math.min(item.total_score / 500, 1),
        evidence: [`Высокий скор HH: ${item.total_score}`],
        detectedAt: new Date()
      })
    }

    // Multiple vacancies signal
    if (item.vacancies_count >= 3) {
      signals.push({
        companyId: item.org_id,
        companyName: item.employer_name,
        signalType: 'burst',
        strength: Math.min(item.vacancies_count / 10, 1),
        evidence: [`Множественные вакансии: ${item.vacancies_count}`],
        detectedAt: new Date()
      })
    }

    // Role diversity signal
    if (item.distinct_vacancy_names_count >= 3) {
      signals.push({
        companyId: item.org_id,
        companyName: item.employer_name,
        signalType: 'diverse',
        strength: Math.min(item.distinct_vacancy_names_count / 5, 1),
        evidence: [`Разнообразие ролей: ${item.distinct_vacancy_names_count}`],
        detectedAt: new Date()
      })
    }

    return signals
  }

  /**
   * Filters leads based on ICP criteria
   */
  static filterByICP(leads: LeadCandidate[], icp: {
    minEmployees?: number
    maxEmployees?: number
    industries?: string[]
    locations?: string[]
    minScore?: number
  }): LeadCandidate[] {
    return leads.filter(lead => {
      // Score filter
      if (icp.minScore && lead.score < icp.minScore) {
        return false
      }

      // TODO: Add company size filtering when we have that data
      // if (icp.minEmployees || icp.maxEmployees) {
      //   const companySize = getCompanySize(lead.companyId)
      //   if (icp.minEmployees && companySize < icp.minEmployees) return false
      //   if (icp.maxEmployees && companySize > icp.maxEmployees) return false
      // }

      // TODO: Add industry filtering when we have that data
      // if (icp.industries && icp.industries.length > 0) {
      //   const companyIndustries = getCompanyIndustries(lead.companyId)
      //   if (!icp.industries.some(industry => companyIndustries.includes(industry))) return false
      // }

      // TODO: Add location filtering when we have that data
      // if (icp.locations && icp.locations.length > 0) {
      //   const companyLocations = getCompanyLocations(lead.companyId)
      //   if (!icp.locations.some(loc => companyLocations.includes(loc))) return false
      // }

      return true
    })
  }
}