import type { HiringEpisodeCandidate } from './hiring-episode-detection'
import type { OpportunityScoreResult } from './opportunity-scoring'

export const OPPORTUNITY_STRATEGIST_V1_VERSION =
  'opportunity-strategist-v1' as const

export type OpportunityStrategistConclusion = {
  text: string
  basis: 'evidence' | 'heuristic'
  supportingEvidenceIds: string[]
}

export type OpportunityStrategistBrief = {
  version: typeof OPPORTUNITY_STRATEGIST_V1_VERSION
  whatChanged: OpportunityStrategistConclusion
  whyNow: OpportunityStrategistConclusion
  problemHypothesis: OpportunityStrategistConclusion
  agencyFitExplanation: OpportunityStrategistConclusion
  externalSupportNeedExplanation: OpportunityStrategistConclusion
  recommendedPersona: OpportunityStrategistConclusion
  recommendedAngle: OpportunityStrategistConclusion
  recommendedCaseStudy: OpportunityStrategistConclusion
  recommendedNextAction: OpportunityStrategistConclusion
  riskSignals: OpportunityStrategistConclusion[]
  limitations: OpportunityStrategistConclusion[]
}

export type OpportunityStrategistCaseStudyInput = {
  roleFamilies: readonly string[]
  industries: readonly string[]
  companySizeBucket: string | null
  region: string | null
  hiringModes: readonly string[]
  publicSafeDescription: string | null
}

export type OpportunityStrategistInput = {
  organizationName: string
  episode: HiringEpisodeCandidate
  score: OpportunityScoreResult
  agency: {
    specialization: string | null
    matchedRoleFamilies: readonly string[]
    matchedIndustries: readonly string[]
    matchedRegions: readonly string[]
    hiringMode: string
    organizationCompanySizeBucket: string | null
    caseStudies: readonly OpportunityStrategistCaseStudyInput[]
  }
}

export class OpportunityStrategistV1 {
  build(input: OpportunityStrategistInput): OpportunityStrategistBrief {
    const evidenceIds = episodeEvidenceIds(input.episode)
    const roleFamilies = uniqueText(input.agency.matchedRoleFamilies)
    const industries = uniqueText(input.agency.matchedIndustries)
    const regions = uniqueText(input.agency.matchedRegions)
    const matchedCaseStudy = selectStructurallyMatchingCaseStudy(input)
    const limitations = buildLimitations(input)

    return {
      version: OPPORTUNITY_STRATEGIST_V1_VERSION,
      whatChanged: evidenceConclusion(
        input.episode.summary.trim() || input.episode.title.trim(),
        evidenceIds,
      ),
      whyNow: evidenceConclusion(buildWhyNow(input.episode), evidenceIds),
      problemHypothesis: heuristicConclusion(
        buildProblemHypothesis(input.episode),
      ),
      agencyFitExplanation: heuristicConclusion(
        buildAgencyFitExplanation({
          specialization: input.agency.specialization,
          roleFamilies,
          industries,
          regions,
        }),
      ),
      externalSupportNeedExplanation: buildExternalSupportNeedExplanation(
        input,
        evidenceIds,
      ),
      recommendedPersona: heuristicConclusion(
        buildRecommendedPersona(roleFamilies),
      ),
      recommendedAngle: heuristicConclusion(
        buildRecommendedAngle(input.episode, roleFamilies),
      ),
      recommendedCaseStudy: heuristicConclusion(
        matchedCaseStudy
          ? `Структурно совпадающий кейс: ${matchedCaseStudy}`
          : 'Подтверждённый структурно совпадающий кейс не найден; требуется ручная проверка.',
      ),
      recommendedNextAction: heuristicConclusion(
        'Проверить доступный корпоративный канал, вручную сверить факты и подготовить персональное обращение без обещаний результата.',
      ),
      riskSignals: buildRiskSignals(input),
      limitations,
    }
  }
}

function buildWhyNow(episode: HiringEpisodeCandidate): string {
  const currentCount = positiveNumber(episode.metadata.currentCount) ||
    episode.vacancyCount
  const windowDays = positiveNumber(episode.metadata.activeWindowDays)
  const growthMultiplier = positiveNumber(episode.metadata.growthMultiplier)
  const fragments = [
    windowDays > 0
      ? `За последние ${windowDays} дней зафиксировано ${currentCount} вакансий.`
      : `В актуальном окне зафиксировано ${currentCount} вакансий.`,
  ]
  if (growthMultiplier > 0) {
    fragments.push(
      `Наблюдаемый темп в ${formatDecimal(growthMultiplier)} раза выше сопоставимого baseline.`,
    )
  }
  return fragments.join(' ')
}

function buildProblemHypothesis(episode: HiringEpisodeCandidate): string {
  if (
    episode.episodeType === 'vacancy_spike' ||
    episode.episodeType === 'sustained_hiring'
  ) {
    return 'Есть признаки, что объём и темп найма могут указывать на вероятную задачу точечной внешней поддержки; требуется ручная проверка.'
  }
  if (episode.episodeType === 'repeated_vacancies') {
    return 'Повторная публикация может указывать на вероятную сложность закрытия отдельных ролей; требуется ручная проверка причин.'
  }
  return 'Наблюдаемое изменение найма может указывать на вероятную задачу для точечной поддержки; требуется ручная проверка.'
}

function buildAgencyFitExplanation(input: {
  specialization: string | null
  roleFamilies: string[]
  industries: string[]
  regions: string[]
}): string {
  const matches: string[] = []
  if (input.roleFamilies.length > 0) {
    matches.push(`семейства ролей: ${input.roleFamilies.join(', ')}`)
  }
  if (input.industries.length > 0) {
    matches.push(`отрасли: ${input.industries.join(', ')}`)
  }
  if (input.regions.length > 0) {
    matches.push(`регионы: ${input.regions.join(', ')}`)
  }
  if (input.specialization?.trim()) {
    matches.push(`специализация агентства: ${input.specialization.trim()}`)
  }
  return matches.length > 0
    ? `Есть профильные совпадения (${matches.join('; ')}), которые могут указывать на релевантность агентства; требуется ручная проверка.`
    : 'Профильных совпадений недостаточно для вывода о соответствии агентству; требуется ручная проверка.'
}

function buildExternalSupportNeedExplanation(
  input: OpportunityStrategistInput,
  episodeEvidenceIds: string[],
): OpportunityStrategistConclusion {
  const allowedIds = new Set(episodeEvidenceIds)
  const reasons = input.score.components.externalSupportNeed.reasons
    .filter((reason) => reason.basis === 'evidence')
  const evidenceIds = uniqueText(
    reasons.flatMap((reason) => reason.evidenceIds)
      .filter((id) => allowedIds.has(id)),
  )
  if (reasons.length > 0 && evidenceIds.length > 0) {
    return evidenceConclusion(
      `Есть признаки возможной потребности во внешней поддержке: ${reasons.map((reason) => reason.message.trim()).filter(Boolean).join(' ')}`,
      evidenceIds,
    )
  }
  return heuristicConclusion(
    'Вероятная потребность во внешней поддержке не подтверждена отдельными evidence; требуется ручная проверка.',
  )
}

function buildRecommendedPersona(roleFamilies: string[]): string {
  if (roleFamilies.some((family) =>
    ['backend', 'frontend', 'engineering', 'data', 'devops'].includes(
      normalizeComparable(family),
    ),
  )) {
    return 'Сначала проверить функцию: Head of Recruitment, HRD или CTO. Конкретный человек не определён.'
  }
  if (roleFamilies.some((family) => normalizeComparable(family) === 'sales')) {
    return 'Сначала проверить функцию: Head of Recruitment, HRD или руководитель коммерческого направления. Конкретный человек не определён.'
  }
  return 'Сначала проверить функцию: Head of Recruitment или HRD. Конкретный человек не определён.'
}

function buildRecommendedAngle(
  episode: HiringEpisodeCandidate,
  roleFamilies: string[],
): string {
  if (roleFamilies.length > 0) {
    return `Предложить как гипотезу точечную помощь со сложными ролями направления «${roleFamilies.join(', ')}», сославшись только на подтверждённые сигналы найма.`
  }
  if (episode.episodeType === 'new_region') {
    return 'Предложить как гипотезу точечную поддержку запуска найма в новом регионе, сославшись только на подтверждённые сигналы.'
  }
  return 'Предложить как гипотезу точечную помощь с наиболее сложными ролями, не утверждая наличие бюджета или готовность работать с агентством.'
}

function buildRiskSignals(
  input: OpportunityStrategistInput,
): OpportunityStrategistConclusion[] {
  const risks: OpportunityStrategistConclusion[] = []
  if (input.score.confidenceGate === 'C' || input.score.confidenceGate === 'D') {
    risks.push(heuristicConclusion(
      'Уровень confidence требует усиленной ручной проверки доказательств до обращения.',
    ))
  }
  risks.push(heuristicConclusion(
    'Коммерческий интерес и доступность подходящей функции для контакта не подтверждены.',
  ))
  return risks
}

function buildLimitations(
  input: OpportunityStrategistInput,
): OpportunityStrategistConclusion[] {
  const limitations = [heuristicConclusion(
    'Публичные сигналы найма не подтверждают бюджет, готовность работать с агентством, конкретного ЛПР или гарантированный результат.',
  )]
  if (!input.agency.organizationCompanySizeBucket?.trim()) {
    limitations.push(heuristicConclusion(
      'Размер компании не подтверждён, поэтому кейс нельзя рекомендовать как структурно совпадающий.',
    ))
  }
  return limitations
}

function selectStructurallyMatchingCaseStudy(
  input: OpportunityStrategistInput,
): string | null {
  const roleFamilies = normalizedSet(input.agency.matchedRoleFamilies)
  const industries = normalizedSet(input.agency.matchedIndustries)
  const regions = normalizedSet(input.agency.matchedRegions)
  const companySize = normalizeComparable(
    input.agency.organizationCompanySizeBucket ?? '',
  )
  const hiringMode = normalizeComparable(input.agency.hiringMode)
  if (
    roleFamilies.size === 0 ||
    industries.size === 0 ||
    regions.size === 0 ||
    !companySize ||
    !hiringMode
  ) {
    return null
  }

  const candidates = input.agency.caseStudies.flatMap((caseStudy) => {
    const description = caseStudy.publicSafeDescription?.trim() ?? ''
    if (!description || containsPersonalContact(description)) return []
    const caseRoles = normalizedSet(caseStudy.roleFamilies)
    const caseIndustries = normalizedSet(caseStudy.industries)
    const caseRegion = normalizeComparable(caseStudy.region ?? '')
    const caseCompanySize = normalizeComparable(
      caseStudy.companySizeBucket ?? '',
    )
    const caseHiringModes = normalizedSet(caseStudy.hiringModes)
    const matches = intersects(roleFamilies, caseRoles) &&
      intersects(industries, caseIndustries) &&
      regions.has(caseRegion) &&
      caseCompanySize === companySize &&
      caseHiringModes.has(hiringMode)
    return matches ? [description.slice(0, 1000)] : []
  })
  return candidates.sort((left, right) =>
    left.localeCompare(right, 'ru-RU'),
  )[0] ?? null
}

function evidenceConclusion(
  text: string,
  supportingEvidenceIds: readonly string[],
): OpportunityStrategistConclusion {
  const evidenceIds = uniqueText(supportingEvidenceIds)
  if (evidenceIds.length === 0) return heuristicConclusion(text)
  return {
    text: text.trim(),
    basis: 'evidence',
    supportingEvidenceIds: evidenceIds,
  }
}

function heuristicConclusion(text: string): OpportunityStrategistConclusion {
  return {
    text: text.trim(),
    basis: 'heuristic',
    supportingEvidenceIds: [],
  }
}

function episodeEvidenceIds(episode: HiringEpisodeCandidate): string[] {
  return uniqueText([...episode.signalIds, ...episode.evidenceIds])
}

function positiveNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0
}

function formatDecimal(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  }).format(value)
}

function uniqueText(values: readonly string[]): string[] {
  return Array.from(new Set(
    values.map((value) => value.trim()).filter(Boolean),
  )).sort((left, right) => left.localeCompare(right, 'en'))
}

function normalizedSet(values: readonly string[]): Set<string> {
  return new Set(values.map(normalizeComparable).filter(Boolean))
}

function normalizeComparable(value: string): string {
  return value.trim().toLocaleLowerCase('ru-RU')
}

function intersects(left: Set<string>, right: Set<string>): boolean {
  return Array.from(left).some((value) => right.has(value))
}

function containsPersonalContact(value: string): boolean {
  const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
  const phonePattern = /(?:^|\D)(?:\+?7|8)[\s().-]*\d{3}[\s().-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}(?:\D|$)/
  return emailPattern.test(value) || phonePattern.test(value)
}
