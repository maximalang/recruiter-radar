import type { HiringEpisodeCandidate } from './hiring-episode-detection'
import type { OpportunityScoreResult } from './opportunity-scoring'
import { temporalContextFromMetadata } from './temporal-context'

export interface OpportunityBrief {
  title: string
  whyNow: string
  problemHypothesis: string
  recommendedAngle: string
  recommendedPersona: string
  recommendedAction: string
  agencyFitExplanation: string
  limitations: string
}

export interface AgencyBriefContext {
  agencyName: string
  specialization: string | null
  hiringMode: string
  matchedRoles: string[]
  matchedIndustries: string[]
  matchedRegions: string[]
  includeKeywords: string[]
  relevantFitReasons: string[]
}

interface OpportunityBriefInput {
  organizationName: string
  episode: HiringEpisodeCandidate
  score: OpportunityScoreResult
  agency: AgencyBriefContext
}

export class OpportunityBriefBuilder {
  build(input: OpportunityBriefInput): OpportunityBrief {
    const organizationName = input.organizationName.trim() || 'Компания'
    const family = stringFact(input.episode.metadata, 'roleFamily')

    return {
      title: buildTitle(organizationName, input.episode, family),
      whyNow: appendTemporalWhyNow(buildWhyNow(input.episode), input.episode),
      problemHypothesis: buildProblemHypothesis(input.episode),
      recommendedAngle: buildRecommendedAngle(input.episode, family),
      recommendedPersona: buildRecommendedPersona(family),
      recommendedAction:
        'Проверить доступный корпоративный канал связи и подготовить персональное обращение со ссылкой на подтверждённый контекст найма.',
      agencyFitExplanation: buildAgencyFitExplanation(input.agency),
      limitations:
        'Оценка основана на публичных сигналах найма и не подтверждает коммерческие условия, готовность работать с агентством или конкретного ЛПР.',
    }
  }
}

function appendTemporalWhyNow(
  base: string,
  episode: HiringEpisodeCandidate,
): string {
  const acceleration = temporalContextFromMetadata(
    episode.metadata,
  ).strongestAcceleration
  if (!acceleration || acceleration.change <= 0) return base
  return `${base} Активные вакансии выросли с ${acceleration.previous} до ${acceleration.current} за ${acceleration.windowDays} дней (+${acceleration.change}).`
}

function buildAgencyFitExplanation(context: AgencyBriefContext): string {
  const details: string[] = []
  const roles = uniqueText(context.matchedRoles)
  const industries = uniqueText(context.matchedIndustries)
  const regions = uniqueText(context.matchedRegions)
  if (roles.length > 0) {
    details.push(`Релевантные роли: ${roles.join(', ')}`)
  }
  if (context.specialization?.trim()) {
    details.push(`специализация агентства: ${context.specialization.trim()}`)
  }
  if (industries.length > 0) {
    details.push(`целевые отрасли: ${industries.join(', ')}`)
  }
  if (regions.length > 0) {
    details.push(`целевые регионы: ${regions.join(', ')}`)
  }
  if (details.length === 0 && context.relevantFitReasons.length > 0) {
    details.push(uniqueText(context.relevantFitReasons).slice(0, 2).join('; '))
  }
  return details.length > 0
    ? `${details.join('; ')}.`
    : 'Соответствие ограничено доступными настройками профиля агентства; перед обращением требуется ручная проверка.'
}

function buildTitle(
  organizationName: string,
  episode: HiringEpisodeCandidate,
  family: string,
): string {
  if (episode.episodeType === 'vacancy_spike') {
    return family
      ? `${organizationName} ускорила найм ${family}-разработчиков`
      : `${organizationName} ускорила найм`
  }
  const titles: Record<HiringEpisodeCandidate['episodeType'], string> = {
    vacancy_spike: `${organizationName} ускорила найм`,
    repeated_vacancies: `${organizationName} повторно открыла сложные позиции`,
    role_cluster: `${organizationName} формирует кластер ролей`,
    new_region: `${organizationName} начала найм в новом регионе`,
    hiring_restart: `${organizationName} возобновила найм`,
    sustained_hiring: `${organizationName} поддерживает повышенный темп найма`,
  }
  return titles[episode.episodeType]
}

function buildWhyNow(episode: HiringEpisodeCandidate): string {
  const activeWindowDays = numberFact(episode.metadata, 'activeWindowDays')
  const currentCount = numberFact(episode.metadata, 'currentCount') || episode.vacancyCount
  const growthMultiplier = numberFact(episode.metadata, 'growthMultiplier')
  const repeatedCount = numberFact(episode.metadata, 'repeatedVacancyCount')

  if (episode.episodeType === 'vacancy_spike') {
    const window = activeWindowDays > 0 ? activeWindowDays : 14
    const growth = growthMultiplier > 0
      ? ` Это в ${formatDecimal(growthMultiplier)} раза выше сопоставимого исторического темпа.`
      : ''
    const repeated = repeatedCount > 0
      ? ` Повторно опубликовано позиций: ${repeatedCount}.`
      : ''
    return `За последние ${window} дней компания открыла ${currentCount} вакансий.${growth}${repeated}`
  }
  if (episode.episodeType === 'hiring_restart') {
    return `Компания возобновила найм: в актуальном окне появилось ${currentCount} вакансии.`
  }
  if (episode.episodeType === 'repeated_vacancies') {
    return `Повторно опубликовано ранее наблюдавшихся позиций: ${Math.max(repeatedCount, 1)}.`
  }
  return episode.summary
}

function buildProblemHypothesis(episode: HiringEpisodeCandidate): string {
  if (
    episode.episodeType === 'vacancy_spike' ||
    episode.episodeType === 'sustained_hiring'
  ) {
    return 'Есть признаки того, что текущий объём и темп найма могут повышать потребность в точечной внешней поддержке.'
  }
  if (episode.episodeType === 'repeated_vacancies') {
    return 'Повторная публикация может указывать на сложность закрытия отдельных позиций.'
  }
  return 'Наблюдаемое изменение найма может указывать на задачу, для которой релевантна точечная поддержка агентства.'
}

function buildRecommendedAngle(
  episode: HiringEpisodeCandidate,
  family: string,
): string {
  if (family) {
    return `Предложить помощь с одной или двумя наиболее сложными ролями направления «${family}» и подтвердить релевантность отраслевым кейсом.`
  }
  if (episode.episodeType === 'new_region') {
    return 'Предложить точечную помощь с запуском найма в новом регионе и показать релевантный региональный кейс.'
  }
  return 'Предложить точечную помощь с наиболее сложными позициями и показать релевантный кейс без обещаний результата.'
}

function buildRecommendedPersona(family: string): string {
  if (family === 'backend' || family === 'frontend' || family === 'engineering') {
    return 'Руководитель подбора, HRD или руководитель инженерного направления.'
  }
  if (family === 'sales') {
    return 'Руководитель подбора, HRD или руководитель коммерческого направления.'
  }
  return 'Руководитель подбора или HRD; функциональный руководитель — только если это подтверждается публичным контекстом.'
}

function numberFact(metadata: Record<string, unknown>, key: string): number {
  const value = metadata[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function stringFact(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key]
  return typeof value === 'string' ? value.trim() : ''
}

function formatDecimal(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
}

function uniqueText(values: string[]): string[] {
  return [...new Set(
    values.map((value) => value.trim()).filter(Boolean),
  )].sort((left, right) => left.localeCompare(right, 'ru'))
}
