import { getHhDigestItems, type HhDigestItem } from "./hhDigest"
import { deriveBestAngle, deriveLawfulContactPath, deriveNegativeSignals } from "./leads-data"
import { rankPreviewItems, type PreviewRelevanceSignals } from "./preview-relevance"

export type PublicPlanCode = "pilot" | "monthly" | "premium"

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
   * Recurring plans (monthly, premium) are billed per month. With the billing
   * provider stubbed there is no real subscription flow, so a checkout for these
   * is captured as a sales request — NOT a self-serve pilot. Drives whether the
   * pilot application + pilot onboarding funnel is triggered. See payments.ts.
   */
  isRecurring: boolean
}

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
  /** Strongest angle for first contact (derived from source families). */
  bestAngle: string
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
    amountMinor: 4900000,
    currency: "RUB",
    price: "49 000 ₽",
    description: "Короткий запуск: увидите компании, которым стоит написать, с доказательствами и готовым углом контакта.",
    bullets: [
      "профиль поиска под вашу нишу",
      "ежедневный радар с hiring-proof",
      "подключение Telegram за 2 минуты",
      "объяснимый scoring: почему сейчас и почему вам",
    ],
    ctaLabel: "Запустить пилот",
    isPrimary: true,
    isRecurring: false
  },
  {
    code: "monthly",
    name: "Ассистированный радар",
    cadence: "ежемесячно",
    amountMinor: 14900000,
    currency: "RUB",
    price: "149 000 ₽/мес",
    description: "Постоянный радар с weekly-калибровкой, reviewed hot leads и приоритетной доставкой.",
    bullets: [
      "ежедневный радар с релевантными компаниями",
      "weekly calibration по вашей обратной связи",
      "hot lead review — аналитик проверяет верхний слой",
      "приоритетная доставка и custom exclusions",
    ],
    ctaLabel: "Обсудить ассистированный",
    isPrimary: false,
    isRecurring: true
  },
  {
    code: "premium",
    name: "Premium Desk",
    cadence: "ежемесячно",
    amountMinor: 29000000,
    currency: "RUB",
    price: "290 000 ₽/мес",
    description: "Выделенный аналитик и приоритетный канал: радар собирается и проверяется под вашу воронку вручную.",
    bullets: [
      "выделенный аналитик ведёт ваш радар",
      "ручная проверка hot leads и evidence bundles",
      "приоритетный SLA на доставку и калибровку",
      "индивидуальные источники и corporate contact paths",
    ],
    ctaLabel: "Обсудить Premium Desk",
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

export function getPublicPlanByCode(code: PublicPlanCode | string): PublicPlan {
  if (isPublicPlanCode(code)) {
    return PUBLIC_PLAN_BY_CODE[code]
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
    bestAngle: deriveBestAngle(item.reasons, item.opener ?? "", sourceFamilies),
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
