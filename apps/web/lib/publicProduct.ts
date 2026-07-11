import { getHhDigestItems, type HhDigestItem } from "./hhDigest"
import { deriveLawfulContactPath, deriveNegativeSignals } from "./leads-data"
import { rankPreviewItems, type PreviewRelevanceSignals } from "./preview-relevance"

export type PublicPlanCode = "pilot" | "monthly" | "yearly"

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
   * Recurring plans (monthly, yearly) are billed per period. With the billing
   * provider stubbed there is no real subscription flow, so a checkout for these
   * is captured as a sales request — NOT a self-serve pilot. Drives whether the
   * pilot application + pilot onboarding funnel is triggered. See payments.ts.
   */
  isRecurring: boolean
}

/**
 * Identical capability set for every plan — the tariff differs only by term
 * (pilot = short trial, monthly = per-month, yearly = per-year with a saving).
 * Do NOT diverge capabilities between plans: the product contract is that every
 * paying customer gets the same radar.
 */
const SHARED_PLAN_BULLETS: string[] = [
  "ежедневный радар с подтверждённым наймом по каждой компании",
  "профиль поиска под вашу нишу и географию",
  "подключение Telegram за 2 минуты",
  "объяснимая оценка: почему сейчас и почему вам",
  "доказательства сигнала и безопасный путь контакта",
  "обратная связь по компаниям и меньше нерелевантных",
]

export type PublicPreviewInput = {
  specialization: string
  targetCity: string
  includeKeywords: string
  excludeKeywords: string
  dailyDigestLimit: number
}

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

export const PUBLIC_PLANS: PublicPlan[] = [
  {
    code: "pilot",
    name: "Пилот",
    cadence: "7–14 дней",
    amountMinor: 299000,
    currency: "RUB",
    price: "2 990 ₽",
    description: "Короткий запуск: увидите компании, которым стоит написать, с доказательствами и готовым углом контакта.",
    bullets: SHARED_PLAN_BULLETS,
    ctaLabel: "Запустить пилот",
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
    description: "Полный доступ к радару на месяц. Те же возможности, что и на год — просто короче срок.",
    bullets: SHARED_PLAN_BULLETS,
    ctaLabel: "Подключить на месяц",
    isPrimary: false,
    isRecurring: true
  },
  {
    code: "yearly",
    name: "Год",
    cadence: "365 дней, экономия 89 890 ₽",
    amountMinor: 8999000,
    currency: "RUB",
    price: "89 990 ₽/год",
    description: "Годовой доступ со скидкой — почти 6 месяцев бесплатно (~7 500 ₽/мес). Для команды, которая делает радар постоянным каналом.",
    bullets: SHARED_PLAN_BULLETS,
    ctaLabel: "Подключить на год",
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
 * Map a legacy plan code onto the current one. The pricing model changed from
 * pilot/monthly/premium (different capabilities) to pilot/monthly/yearly
 * (identical capabilities). Existing DB orders and old checkout links may still
 * carry "premium" — fold them onto the yearly plan so historical data does not
 * throw. The pilot and monthly codes are unchanged.
 */
export function normalizeLegacyPlanCode(code: string): PublicPlanCode {
  const normalized = code.trim().toLocaleLowerCase("en-US")
  if (normalized === "premium") return "yearly"
  if (isPublicPlanCode(normalized)) return normalized
  throw new Error(`Unknown product code: ${code}`)
}

export function getPublicPlanByCode(code: PublicPlanCode | string): PublicPlan {
  const normalized = code.trim().toLocaleLowerCase("en-US")
  if (isPublicPlanCode(normalized)) {
    return PUBLIC_PLAN_BY_CODE[normalized]
  }
  // Legacy "premium" → yearly, so historical orders/links don't throw.
  if (normalized === "premium") {
    return PUBLIC_PLAN_BY_CODE.yearly
  }

  throw new Error(`Unknown product code: ${code}`)
}

export function readPublicPreviewInput(searchParams: Record<string, string | string[] | undefined>): PublicPreviewInput {
  return {
    specialization: readSearchParam(searchParams.specialization),
    targetCity: readSearchParam(searchParams.targetCity),
    includeKeywords: readSearchParam(searchParams.includeKeywords),
    excludeKeywords: readSearchParam(searchParams.excludeKeywords),
    dailyDigestLimit: normalizeDailyDigestLimit(readSearchParam(searchParams.dailyDigestLimit))
  }
}

export function hasPublicPreviewInput(input: PublicPreviewInput): boolean {
  return [input.specialization, input.targetCity, input.includeKeywords, input.excludeKeywords]
    .some((value) => value !== "")
}

export async function getPublicSampleDigestState(input: PublicPreviewInput): Promise<{
  isLive: boolean
  isPersonalized: boolean
  /** False when the niche query had no exact ICP match and we fell back to closest companies. */
  hasExactMatches: boolean
  items: PublicPreviewItem[]
}> {
  const items = await getHhDigestItems()
  const isPersonalized = hasPublicPreviewInput(input)

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

  if (input.specialization) params.set("specialization", input.specialization)
  if (input.targetCity) params.set("targetCity", input.targetCity)
  if (input.includeKeywords) params.set("includeKeywords", input.includeKeywords)
  if (input.excludeKeywords) params.set("excludeKeywords", input.excludeKeywords)
  if (typeof input.dailyDigestLimit === "number") {
    params.set("dailyDigestLimit", String(input.dailyDigestLimit))
  }
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
  const raw = readSearchParam(searchParams.plan).toLowerCase()
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
    lawfulContactPath: deriveLawfulContactPath(item.reasons, sourceFamilies),
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

function readSearchParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0].trim() : ""
  }

  return typeof value === "string" ? value.trim() : ""
}

function normalizeDailyDigestLimit(value: string): number {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    return 5
  }

  const normalized = Math.trunc(parsed)
  return normalized > 0 ? Math.min(normalized, 10) : 5
}
