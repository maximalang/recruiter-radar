import { getHhDigestItems, type HhDigestItem } from "./hhDigest"
import { deriveLawfulContactPath, deriveNegativeSignals } from "./leads-data"
import { rankPreviewItems, type PreviewRelevanceSignals } from "./preview-relevance"

export type PublicPlanCode = "pilot" | "monthly" | "quarterly"

export type PublicPlan = {
  code: PublicPlanCode
  name: string
  cadence: string
  amountMinor: number
  currency: string
  price: string
  description: string
  bullets: string[]
  ctaLabel: string
  isPrimary: boolean
  /**
   * Recurring plans (monthly, quarterly) are billed per period. With the billing
   * provider stubbed there is no real subscription flow, so a checkout for these
   * is captured as a sales request — NOT a self-serve pilot. Drives whether the
   * pilot application + pilot onboarding funnel is triggered. See payments.ts.
   */
  isRecurring: boolean
}

/**
 * Identical capability set for every plan — the tariff differs only by term
 * (pilot = 1 week, monthly = 1 month, quarterly = 3 months with a saving).
 * Do NOT diverge capabilities between plans: the product contract is that every
 * paying customer gets the same radar.
 */
const SHARED_PLAN_BULLETS: string[] = [
  "ежедневный радар с подтверждённым наймом по каждой компании",
  "профиль поиска под вашу нишу и географию",
  "Telegram-first доставка; при необходимости — email, web push, VK или webhook",
  "оценка уверенности и понятное «почему сейчас» по каждому лиду",
  "доказательства найма и безопасный путь контакта",
  "обратная связь по компаниям — и всё меньше нерелевантных в радаре",
]

export type PublicPreviewInput = {
  specialization: string
  targetCity: string
  includeKeywords: string
  excludeKeywords: string
  dailyDigestLimit: number
}

export const PUBLIC_PREVIEW_FIELD_LIMITS = {
  specialization: 160,
  targetCity: 120,
  keywords: 300,
} as const

export type PublicPreviewItem = HhDigestItem & {
  confidenceLabel: string
  sourceCount: number
  sourceKeys: string[]
  structuredSignalCount: number
  curationLabels: string[]
  /** Lawful contact-path key (career-page / registry-data / …) or null. */
  lawfulContactPath: string | null
  /** Risk factors / why-not — empty when none apply. */
  negativeSignals: string[]
  /**
   * ICP-relevance breakdown mapped onto the FIUR axes. NOT the output of the
   * real FIUR engine — derived from aggregated digest fields for an honest,
   * explainable "relevance to your ICP" signal. See preview-relevance.ts.
   */
  relevanceSignals: PreviewRelevanceSignals
}

function buildPublicDemoDigestItems(referenceDate = new Date()): HhDigestItem[] {
  const previousDay = new Date(referenceDate.getTime() - 24 * 60 * 60 * 1000)
  const twoDaysAgo = new Date(referenceDate.getTime() - 2 * 24 * 60 * 60 * 1000)
  const threeDaysAgo = new Date(referenceDate.getTime() - 3 * 24 * 60 * 60 * 1000)
  const fourDaysAgo = new Date(referenceDate.getTime() - 4 * 24 * 60 * 60 * 1000)

  return [
    {
      rank: 1,
      org_id: "demo-industrial",
      hh_employer_id: "demo-industrial",
      employer_name: "Производственная компания",
      vacancies_count: 14,
      distinct_vacancy_names_count: 6,
      latest_published_at: referenceDate.toISOString(),
      total_score: 348,
      reasons: [
        "Инженерный подбор: 14 новых вакансий за 6 дней",
        "Появилась редкая инженерная роль",
      ],
      opener: "Предложить точечный подбор по инженерным ролям",
      source_families: ["hh", "career-pages", "egrul-fns"],
      evidence_titles: ["Инженер-конструктор", "Руководитель производства"],
      candidate_source_keys: ["demo:hh:industrial", "demo:career:industrial", "demo:egrul:industrial"],
      location_names: ["Москва и область"],
      confidence_gate: "A",
    },
    {
      rank: 2,
      org_id: "demo-b2b-service",
      hh_employer_id: "demo-b2b-service",
      employer_name: "Сервисная B2B-компания",
      vacancies_count: 9,
      distinct_vacancy_names_count: 5,
      latest_published_at: previousDay.toISOString(),
      total_score: 312,
      reasons: [
        "Команда найма расширяет коммерческий блок",
        "Повторно открыты две сложные роли",
      ],
      opener: "Уточнить приоритетные роли и предложить короткий пилот",
      source_families: ["career-pages", "egrul-fns"],
      evidence_titles: ["Руководитель отдела продаж", "Менеджер по развитию"],
      candidate_source_keys: ["demo:career:b2b", "demo:egrul:b2b"],
      location_names: ["Санкт-Петербург"],
      confidence_gate: "B",
    },
    {
      rank: 3,
      org_id: "demo-tech-product",
      hh_employer_id: "demo-tech-product",
      employer_name: "Продуктовая IT-компания",
      vacancies_count: 11,
      distinct_vacancy_names_count: 7,
      latest_published_at: twoDaysAgo.toISOString(),
      total_score: 328,
      reasons: [
        "IT-подбор: за неделю открыты роли в backend и инфраструктуре",
        "Команда выходит на удалённый найм по России",
      ],
      opener: "Предложить точечный поиск backend- и DevOps-специалистов",
      source_families: ["career-pages", "hh", "company-site"],
      evidence_titles: ["Backend-разработчик", "DevOps-инженер", "Product analyst"],
      candidate_source_keys: ["demo:career:tech", "demo:hh:tech", "demo:site:tech"],
      location_names: ["Удалённо · Россия"],
      confidence_gate: "A",
    },
    {
      rank: 4,
      org_id: "demo-retail-regional",
      hh_employer_id: "demo-retail-regional",
      employer_name: "Региональная розничная сеть",
      vacancies_count: 18,
      distinct_vacancy_names_count: 8,
      latest_published_at: threeDaysAgo.toISOString(),
      total_score: 296,
      reasons: [
        "Массовый подбор: сеть открывает новые точки",
        "Повторно опубликованы операционные роли",
      ],
      opener: "Уточнить график открытий и предложить региональную проектную команду",
      source_families: ["rabota-rossii", "career-pages", "egrul-fns"],
      evidence_titles: ["Директор магазина", "Специалист по подбору персонала"],
      candidate_source_keys: ["demo:rr:retail", "demo:career:retail", "demo:egrul:retail"],
      location_names: ["Казань и Татарстан"],
      confidence_gate: "B",
    },
    {
      rank: 5,
      org_id: "demo-pharma",
      hh_employer_id: "demo-pharma",
      employer_name: "Фармацевтическая компания",
      vacancies_count: 7,
      distinct_vacancy_names_count: 5,
      latest_published_at: fourDaysAgo.toISOString(),
      total_score: 284,
      reasons: [
        "Фармацевтический подбор: усиливается контроль качества",
        "Открыта редкая регуляторная роль",
      ],
      opener: "Предложить карту кандидатов по качеству и регуляторным функциям",
      source_families: ["hh", "career-pages", "egrul-fns"],
      evidence_titles: ["Менеджер по качеству", "Специалист по регистрации"],
      candidate_source_keys: ["demo:hh:pharma", "demo:career:pharma", "demo:egrul:pharma"],
      location_names: ["Новосибирск"],
      confidence_gate: "B",
    },
  ]
}

export const PUBLIC_PLANS: PublicPlan[] = [
  {
    code: "pilot",
    name: "Неделя",
    cadence: "7 дней",
    amountMinor: 299000,
    currency: "RUB",
    price: "2 990 ₽",
    description: "Короткий запуск: за неделю увидите компании, которым стоит написать сегодня, — с доказательствами найма, оценкой уверенности и безопасным поводом для первого касания.",
    bullets: SHARED_PLAN_BULLETS,
    ctaLabel: "Попробовать неделю",
    isPrimary: true,
    isRecurring: false
  },
  {
    code: "monthly",
    name: "Месяц",
    cadence: "30 дней",
    amountMinor: 1499000,
    currency: "RUB",
    price: "14 990 ₽/мес",
    description: "Полный доступ к радару на месяц — всё то же, что в пилоте, на срок, удобный для проверки канала.",
    bullets: SHARED_PLAN_BULLETS,
    ctaLabel: "Оставить заявку на месяц",
    isPrimary: false,
    isRecurring: true
  },
  {
    code: "quarterly",
    name: "Три месяца",
    cadence: "90 дней",
    amountMinor: 2999000,
    currency: "RUB",
    price: "29 990 ₽/3 мес",
    description: "Доступ на квартал со скидкой — выгоднее помесячной оплаты (~9 997 ₽/мес). Для команды, которая делает радар рабочим каналом на три месяца, а не на пробу.",
    bullets: SHARED_PLAN_BULLETS,
    ctaLabel: "Оставить заявку на 3 месяца",
    isPrimary: false,
    isRecurring: true
  }
]

const PUBLIC_PLAN_BY_CODE = Object.fromEntries(
  PUBLIC_PLANS.map((plan) => [plan.code, plan])
) as Record<PublicPlanCode, PublicPlan>

/** True when `code` is a known plan code. Single source of truth for plan validation. */
export function isPublicPlanCode(code: unknown): code is PublicPlanCode {
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(PUBLIC_PLAN_BY_CODE, code)
}

/**
 * Map a legacy plan code onto the current one. The pricing model changed twice:
 *   v1  pilot/monthly/premium (different capabilities)
 *   v2  pilot/monthly/yearly  (identical capabilities, yearly term)
 *   v3  pilot/monthly/quarterly (current — week / month / 3 months)
 * Existing DB orders and old checkout links may still carry "premium" or
 * "yearly" — fold both onto the quarterly plan so historical data does not
 * throw. The pilot and monthly codes are unchanged.
 */
export function normalizeLegacyPlanCode(code: string): PublicPlanCode {
  const normalized = code.trim().toLocaleLowerCase("en-US")
  if (normalized === "premium") return "quarterly"
  if (normalized === "yearly") return "quarterly"
  if (isPublicPlanCode(normalized)) return normalized
  throw new Error(`Unknown product code: ${code}`)
}

export function getPublicPlanByCode(code: PublicPlanCode | string): PublicPlan {
  const normalized = code.trim().toLocaleLowerCase("en-US")
  if (isPublicPlanCode(normalized)) {
    return PUBLIC_PLAN_BY_CODE[normalized]
  }
  // Legacy "premium"/"yearly" → quarterly, so historical orders/links don't throw.
  if (normalized === "premium" || normalized === "yearly") {
    return PUBLIC_PLAN_BY_CODE.quarterly
  }

  throw new Error(`Unknown product code: ${code}`)
}

type PublicPreviewHrefInput = {
  specialization?: string | null
  targetCity?: string | null
  includeKeywords?: string | null
  excludeKeywords?: string | null
  dailyDigestLimit?: number | null
}

function appendPublicPreviewParams(params: URLSearchParams, input: PublicPreviewHrefInput): void {
  if (input.specialization) params.set("specialization", input.specialization)
  if (input.targetCity) params.set("targetCity", input.targetCity)
  if (input.includeKeywords) params.set("includeKeywords", input.includeKeywords)
  if (input.excludeKeywords) params.set("excludeKeywords", input.excludeKeywords)
  if (typeof input.dailyDigestLimit === "number") {
    params.set("dailyDigestLimit", String(input.dailyDigestLimit))
  }
}

export function buildPublicPreviewHref(input: PublicPreviewHrefInput): string {
  const params = new URLSearchParams()
  appendPublicPreviewParams(params, input)
  const query = params.toString()

  return query === "" ? "/#preview" : `/?${query}#preview`
}

export function readPublicPreviewInput(searchParams: Record<string, string | string[] | undefined>): PublicPreviewInput {
  return {
    specialization: readSearchParam(searchParams.specialization, PUBLIC_PREVIEW_FIELD_LIMITS.specialization),
    targetCity: readSearchParam(searchParams.targetCity, PUBLIC_PREVIEW_FIELD_LIMITS.targetCity),
    includeKeywords: readSearchParam(searchParams.includeKeywords, PUBLIC_PREVIEW_FIELD_LIMITS.keywords),
    excludeKeywords: readSearchParam(searchParams.excludeKeywords, PUBLIC_PREVIEW_FIELD_LIMITS.keywords),
    dailyDigestLimit: normalizeDailyDigestLimit(readSearchParam(searchParams.dailyDigestLimit, 2))
  }
}

export function hasPublicPreviewInput(input: PublicPreviewInput): boolean {
  return [input.specialization, input.targetCity, input.includeKeywords, input.excludeKeywords]
    .some((value) => value !== "")
}

type PublicSampleDigestState = {
  isLive: boolean
  isPersonalized: boolean
  /** False when the niche query had no exact ICP match and we fell back to closest companies. */
  hasExactMatches: boolean
  items: PublicPreviewItem[]
}

function buildPublicDemoDigestState(input: PublicPreviewInput): PublicSampleDigestState {
  const items = buildPublicDemoDigestItems()
  const isPersonalized = hasPublicPreviewInput(input)

  if (!isPersonalized) {
    return {
      isLive: false,
      isPersonalized: false,
      hasExactMatches: true,
      items: items.map((item) => toPublicPreviewItem(item, defaultRelevanceSignals())),
    }
  }

  const { ranked, hasExactMatches } = rankPreviewItems(items, input, {
    limit: input.dailyDigestLimit,
  })

  return {
    isLive: false,
    isPersonalized: true,
    hasExactMatches,
    items: ranked.map((entry) => toPublicPreviewItem(entry.item, entry.relevance.signals)),
  }
}

export async function getPublicSampleDigestState(input: PublicPreviewInput): Promise<PublicSampleDigestState> {
  const isPersonalized = hasPublicPreviewInput(input)
  let items: HhDigestItem[]

  try {
    items = await getHhDigestItems()
  } catch {
    console.info("Public preview data unavailable; serving interactive sample fallback")
    return buildPublicDemoDigestState(input)
  }

  if (items.length === 0) {
    console.info("Public preview has no eligible items; serving interactive sample fallback")
    return buildPublicDemoDigestState(input)
  }

  if (!isPersonalized) {
    return {
      isLive: true,
      isPersonalized: false,
      hasExactMatches: true,
      items: items.map((item) => toPublicPreviewItem(item, defaultRelevanceSignals())),
    }
  }

  const { ranked, hasExactMatches } = rankPreviewItems(items, input, {
    limit: input.dailyDigestLimit,
  })

  return {
    isLive: true,
    isPersonalized: true,
    hasExactMatches,
    items: ranked.map((entry) => toPublicPreviewItem(entry.item, entry.relevance.signals)),
  }
}

export function buildCheckoutHref(input: {
  specialization?: string | null
  targetCity?: string | null
  includeKeywords?: string | null
  excludeKeywords?: string | null
  dailyDigestLimit?: number | null
  ownerId?: string | number | null
  planCode?: PublicPlanCode | null
}): string {
  const params = new URLSearchParams()
  appendPublicPreviewParams(params, input)
  if (input.ownerId != null && String(input.ownerId).trim() !== "") {
    params.set("ownerId", String(input.ownerId).trim())
  }
  // Default plan is pilot; only emit the param for non-default plans to keep
  // existing pilot links unchanged.
  if (input.planCode && input.planCode !== "pilot") {
    params.set("plan", input.planCode)
  }

  const query = params.toString()
  return query === "" ? "/checkout" : `/checkout?${query}`
}

/** Read & validate the `plan` checkout param, defaulting to pilot. */
export function readCheckoutPlanCode(
  searchParams: Record<string, string | string[] | undefined>
): PublicPlanCode {
  const raw = readSearchParam(searchParams.plan, 20).toLowerCase()
  return isPublicPlanCode(raw) ? raw : "pilot"
}

export function resolveCheckoutOwnerId(): string | null {
  const ownerId = process.env.CHECKOUT_DEFAULT_OWNER_ID?.trim()
  return ownerId ? ownerId : null
}

export function buildPilotApplicationComment(input: {
  baseComment?: string | null
  includeKeywords?: string | null
  excludeKeywords?: string | null
  dailyDigestLimit?: number | null
}): string {
  const parts = [input.baseComment?.trim() ?? ""]

  if (input.includeKeywords) parts.push(`Include: ${input.includeKeywords}`)
  if (input.excludeKeywords) parts.push(`Exclude: ${input.excludeKeywords}`)
  if (typeof input.dailyDigestLimit === "number") {
    parts.push(`Daily digest limit: ${input.dailyDigestLimit}`)
  }

  return parts.filter((part) => part !== "").join("\n")
}

function toPublicPreviewItem(
  item: HhDigestItem,
  relevanceSignals: PreviewRelevanceSignals
): PublicPreviewItem {
  const sourceFamilies = item.source_families
  const lawfulContactPath = sourceFamilies.includes("career-pages")
    ? "career-page"
    : deriveLawfulContactPath(item.reasons, sourceFamilies)
  return {
    ...item,
    confidenceLabel: deriveConfidenceLabel(item.total_score),
    sourceCount: sourceFamilies.length,
    sourceKeys: item.candidate_source_keys,
    structuredSignalCount: item.evidence_titles.length,
    curationLabels: sourceFamilies,
    // On the public preview `reasons` are raw Russian strings, not structured
    // ScoringReason keys — so these derivations lean on source families, the
    // confidence gate, and vacancy counts (gate/count-driven, key-agnostic),
    // never on reason keys that don't exist in preview data.
    // A direct career surface is a more actionable corporate path than registry
    // context. Prefer it in the public card when both source families exist.
    lawfulContactPath,
    negativeSignals: deriveNegativeSignals({
      reasons: item.reasons,
      vacanciesCount: item.vacancies_count,
      distinctVacancyNamesCount: item.distinct_vacancy_names_count,
      sourceFamilies,
      confidenceGate: item.confidence_gate ?? ""
    }),
    relevanceSignals
  }
}

/** Neutral relevance for the un-personalised preview (no ICP input to score against). */
function defaultRelevanceSignals(): PreviewRelevanceSignals {
  return { fit: 0, intent: 0, urgency: 0, reachability: 0 }
}

function deriveConfidenceLabel(totalScore: number): string {
  // NOTE: preview-only score band for the public landing page — NOT the
  // confidence gate from lib/scoring/gates. Gates classify evidence
  // quality (A/B/C/D); this helper buckets a numeric score into
  // high/medium/low for marketing copy. Do not conflate the two.
  if (totalScore >= 80) return "high"
  if (totalScore >= 50) return "medium"
  return "low"
}

function readSearchParam(value: string | string[] | undefined, maxLength: number): string {
  let normalized = ""

  if (Array.isArray(value)) {
    normalized = typeof value[0] === "string" ? value[0].trim() : ""
  } else if (typeof value === "string") {
    normalized = value.trim()
  }

  return normalized.slice(0, maxLength)
}

function normalizeDailyDigestLimit(value: string): number {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    return 5
  }

  const normalized = Math.trunc(parsed)
  return normalized > 0 ? Math.min(normalized, 10) : 5
}
