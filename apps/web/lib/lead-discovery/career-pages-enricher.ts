/**
 * Career Pages Enricher
 *
 * Pulls hiring evidence from a company's career page using the
 * shared CrawlerRouter and a caller-supplied parser. The parser
 * is injected so this module stays free of HTML-parsing concerns
 * and is easy to test.
 */

import { createDefaultRouter } from '@/lib/sources/crawlers'
import type {
  CrawlerRouter,
  CrawlerFetchInput,
  CrawlerResult,
} from '@/lib/sources/crawlers'
import type { HiringSignal } from './hiring-pattern-detector'
import type { Logger } from './multi-source-lead-generator'

export interface CareerPageVacancy {
  title: string
  department?: string
  location?: string
  salary?: { min: number; max: number; currency: string }
  requirements?: string[]
  postedAt?: Date
  isRemote?: boolean
}

export interface CareerPageData {
  url: string
  companyName: string
  extractedAt: Date
  vacancies: CareerPageVacancy[]
  hiringIndicators: HiringIndicators
  technicalInfo: TechnicalInfo
}

interface HiringIndicators {
  hasMultipleDepartments: boolean
  hasManagementRoles: boolean
  hasTechRoles: boolean
  hasSalesRoles: boolean
  hasHRRoles: boolean
  salaryRange: { min: number; max: number; avg: number } | null
  freshnessScore: number
}

interface TechnicalInfo {
  pageType: 'modern' | 'legacy' | 'ATS'
  hasApplyButton: boolean
  hasJobDescriptions: boolean
  hasFiltering: boolean
  loadTimeMs: number
}

export interface CareerPageEvidence {
  sourceId: 'career-pages'
  companyName: string
  pageData: CareerPageData
  signals: HiringSignal[]
  confidence: number
}

export type CareerPageVacancyParser = (
  input: { html: string; url: string; companyName: string },
) => CareerPageVacancy[]

export interface CareerPagesEnricherDeps {
  crawler?: CrawlerRouter
  parser: CareerPageVacancyParser
  logger?: Logger
  domainHint?: (companyName: string) => string[]
}

const noopLogger: Logger = { warn: () => undefined }

const SLUG_INVALID = /[^a-z0-9-]+/g
const FRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Career page crawler with parser-based vacancy extraction.
 */
export class CareerPagesEnricher {
  private crawler: CrawlerRouter
  private parser: CareerPageVacancyParser
  private logger: Logger
  private domainHint: (companyName: string) => string[]

  constructor(deps: CareerPagesEnricherDeps) {
    if (!deps.parser) {
      throw new Error('CareerPagesEnricher requires a vacancy parser')
    }
    this.crawler = deps.crawler ?? createDefaultRouter()
    this.parser = deps.parser
    this.logger = deps.logger ?? noopLogger
    this.domainHint = deps.domainHint ?? defaultDomainHint
  }

  async enrichCompany(
    companyId: string,
    companyName: string,
    urls?: string[],
  ): Promise<CareerPageEvidence | null> {
    const targetUrls = urls?.length ? urls : this.guessCareerPageUrls(companyName)
    if (targetUrls.length === 0) return null

    let bestResult: CareerPageData | null = null
    let highestScore = 0

    for (const url of targetUrls) {
      try {
        const data = await this.extractCareerPageData(url, companyName)
        if (!data) continue
        const score = this.scoreCareerPage(data)
        if (score > highestScore) {
          highestScore = score
          bestResult = data
        }
      } catch (error) {
        this.logger.warn('career-page extraction failed', {
          companyId,
          url,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (!bestResult) return null

    const signals = this.detectHiringSignals(bestResult)
    const confidence = this.calculateConfidence(bestResult, highestScore)

    return {
      sourceId: 'career-pages',
      companyName,
      pageData: bestResult,
      signals,
      confidence,
    }
  }

  guessCareerPageUrls(companyName: string): string[] {
    const slugs = this.domainHint(companyName).filter(Boolean)
    if (slugs.length === 0) return []
    const primary = slugs[0]
    return [
      `https://${primary}.com/careers`,
      `https://${primary}.com/vacancies`,
      `https://${primary}.com/jobs`,
      `https://www.${primary}.com/careers`,
      `https://www.${primary}.com/vacancies`,
      `https://jobs.${primary}.com`,
      `https://careers.${primary}.com`,
    ]
  }

  private async extractCareerPageData(
    url: string,
    companyName: string,
  ): Promise<CareerPageData | null> {
    const start = Date.now()
    const crawlInput: CrawlerFetchInput = {
      url,
      options: { timeoutMs: 15000 },
    }
    const result: CrawlerResult = await this.crawler.fetch(crawlInput)
    if (result.status !== 200 || !result.html) {
      return null
    }

    const vacancies = this.parser({ html: result.html, url: result.url, companyName })
    const hiringIndicators = this.analyzeHiringIndicators(vacancies)
    const technicalInfo = this.analyzeTechnicalInfo(result.html, Date.now() - start)

    return {
      url: result.url,
      companyName,
      extractedAt: new Date(result.fetchedAt),
      vacancies,
      hiringIndicators,
      technicalInfo,
    }
  }

  private analyzeHiringIndicators(vacancies: CareerPageVacancy[]): HiringIndicators {
    const departments = new Set(
      vacancies.map(v => v.department?.toLowerCase()).filter(Boolean) as string[],
    )
    const titles = vacancies.map(v => v.title.toLowerCase())

    const hasManagementRoles = titles.some(t =>
      t.includes('manager') || t.includes('director') || t.includes('lead') || t.includes('head of'),
    )
    const hasTechRoles = titles.some(t =>
      t.includes('developer') || t.includes('engineer') || t.includes('devops') || t.includes('sre'),
    )
    const hasSalesRoles = titles.some(t =>
      t.includes('sales') || t.includes('bizdev') || t.includes('business development'),
    )
    const hasHRRoles = titles.some(t =>
      t.includes('hr') || t.includes('recruiter') || t.includes('talent'),
    )

    const salaries = vacancies
      .map(v => v.salary)
      .filter((s): s is NonNullable<CareerPageVacancy['salary']> => Boolean(s))

    const salaryRange = salaries.length > 0
      ? {
          min: Math.min(...salaries.map(s => s.min)),
          max: Math.max(...salaries.map(s => s.max)),
          avg: salaries.reduce((sum, s) => sum + (s.min + s.max) / 2, 0) / salaries.length,
        }
      : null

    const now = Date.now()
    const dated = vacancies.filter(v => v.postedAt instanceof Date)
    const recent = dated.filter(v => now - v.postedAt!.getTime() < FRESH_WINDOW_MS)
    const freshnessScore = dated.length > 0 ? recent.length / dated.length : 0

    return {
      hasMultipleDepartments: departments.size >= 2,
      hasManagementRoles,
      hasTechRoles,
      hasSalesRoles,
      hasHRRoles,
      salaryRange,
      freshnessScore,
    }
  }

  private analyzeTechnicalInfo(html: string, loadTimeMs: number): TechnicalInfo {
    const lower = html.toLowerCase()
    const hasApplyButton = lower.includes('apply') || lower.includes('откликнуться')
    const hasJobDescriptions = lower.includes('требования') || lower.includes('responsibilities')
    const hasFiltering = lower.includes('filter') || lower.includes('фильтр')

    let pageType: TechnicalInfo['pageType'] = 'legacy'
    if (lower.includes('lever.co') || lower.includes('greenhouse.io')) {
      pageType = 'ATS'
    } else if (hasJobDescriptions && hasApplyButton && hasFiltering) {
      pageType = 'modern'
    }

    return { pageType, hasApplyButton, hasJobDescriptions, hasFiltering, loadTimeMs }
  }

  private scoreCareerPage(data: CareerPageData): number {
    let score = 0
    if (data.vacancies.length > 0) score += Math.min(data.vacancies.length * 0.2, 1)
    if (data.hiringIndicators.hasMultipleDepartments) score += 0.3
    if (data.hiringIndicators.hasTechRoles) score += 0.2
    if (data.hiringIndicators.hasManagementRoles) score += 0.2
    if (data.hiringIndicators.hasSalesRoles) score += 0.1
    if (data.hiringIndicators.hasHRRoles) score += 0.1
    if (data.hiringIndicators.freshnessScore > 0.5) score += 0.3
    if (data.technicalInfo.pageType === 'modern') score += 0.2
    if (data.technicalInfo.hasJobDescriptions) score += 0.1
    return Math.min(score, 1.0)
  }

  private detectHiringSignals(data: CareerPageData): HiringSignal[] {
    const signals: HiringSignal[] = []
    const baseId = data.companyName.toLowerCase().normalize('NFKD').replace(/\s+/g, '-')

    if (data.vacancies.length >= 3) {
      signals.push({
        companyId: baseId,
        companyName: data.companyName,
        signalType: 'burst',
        strength: Math.min(data.vacancies.length / 10, 1),
        evidence: [`Открыто ${data.vacancies.length} вакансий на карьерной странице`],
        detectedAt: new Date(),
      })
    }

    const roleTypes = [
      data.hiringIndicators.hasTechRoles ? 'tech' : null,
      data.hiringIndicators.hasManagementRoles ? 'management' : null,
      data.hiringIndicators.hasSalesRoles ? 'sales' : null,
      data.hiringIndicators.hasHRRoles ? 'hr' : null,
    ].filter(Boolean) as string[]

    if (roleTypes.length >= 2) {
      signals.push({
        companyId: baseId,
        companyName: data.companyName,
        signalType: 'diverse',
        strength: Math.min(roleTypes.length / 4, 1),
        evidence: [`Вакансии в ${roleTypes.length} разных областях`],
        detectedAt: new Date(),
      })
    }

    if (data.hiringIndicators.salaryRange && data.hiringIndicators.salaryRange.avg > 200000) {
      const avg = data.hiringIndicators.salaryRange.avg
      signals.push({
        companyId: baseId,
        companyName: data.companyName,
        signalType: 'premium',
        strength: Math.min((avg - 200000) / 100000, 1),
        evidence: [`Высокие зарплаты: ${Math.round(avg).toLocaleString('ru-RU')} ₽`],
        detectedAt: new Date(),
      })
    }

    if (data.hiringIndicators.freshnessScore === 1 && data.vacancies.length > 0) {
      signals.push({
        companyId: baseId,
        companyName: data.companyName,
        signalType: 'fresh',
        strength: 1,
        evidence: ['Все вакансии свежие'],
        detectedAt: new Date(),
      })
    }

    return signals
  }

  private calculateConfidence(data: CareerPageData, pageScore: number): number {
    let confidence = pageScore * 0.92
    if (data.technicalInfo.pageType === 'modern') confidence *= 1.1
    if (data.hiringIndicators.hasMultipleDepartments) confidence *= 1.05
    return Math.min(confidence, 1.0)
  }
}

function defaultDomainHint(companyName: string): string[] {
  const normalized = companyName
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .trim()
  if (!normalized) return []
  const hyphenated = normalized.replace(/\s+/g, '-').replace(SLUG_INVALID, '')
  const compact = normalized.replace(/\s+/g, '').replace(SLUG_INVALID, '')
  const slugs = [hyphenated, compact].filter(s => s.length > 0)
  return Array.from(new Set(slugs))
}
