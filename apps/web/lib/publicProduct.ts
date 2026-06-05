import { getHhDigestItems, type HhDigestItem } from "./hhDigest"

export type PublicPlan = {
  code: "pilot" | "monthly"
  name: string
  cadence: string
  amountMinor: number
  currency: string
  price: string
  description: string
  bullets: string[]
  ctaLabel: string
  isPrimary: boolean
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
    isPrimary: true
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
      "20–40 validated leads в месяц",
      "weekly calibration по вашей обратной связи",
      "hot lead review — аналитик проверяет верхний слой",
      "приоритетная доставка и custom exclusions",
    ],
    ctaLabel: "Выбрать ассистированный",
    isPrimary: false
  }
]

const PUBLIC_PLAN_BY_CODE = Object.fromEntries(
  PUBLIC_PLANS.map((plan) => [plan.code, plan])
) as Record<PublicPlan["code"], PublicPlan>

export function getPublicPlanByCode(code: PublicPlan["code"] | string): PublicPlan {
  if (code === "pilot" || code === "monthly") {
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
  items: PublicPreviewItem[]
}> {
  const items = await getHhDigestItems()
  const filteredItems = hasPublicPreviewInput(input)
    ? items.filter((item) => matchesPreviewInput(item, input)).slice(0, input.dailyDigestLimit)
    : items

  return {
    isLive: true,
    isPersonalized: hasPublicPreviewInput(input),
    items: filteredItems.map(toPublicPreviewItem)
  }
}

export function buildCheckoutHref(input: {
  specialization?: string | null
  targetCity?: string | null
  includeKeywords?: string | null
  excludeKeywords?: string | null
  dailyDigestLimit?: number | null
  ownerId?: string | number | null
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

  const query = params.toString()
  return query === "" ? "/checkout" : `/checkout?${query}`
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

function toPublicPreviewItem(item: HhDigestItem): PublicPreviewItem {
  return {
    ...item,
    confidenceLabel: deriveConfidenceLabel(item.total_score),
    sourceCount: item.source_families.length,
    sourceKeys: item.candidate_source_keys,
    structuredSignalCount: item.evidence_titles.length,
    curationLabels: item.source_families
  }
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

function matchesPreviewInput(item: HhDigestItem, input: PublicPreviewInput): boolean {
  const haystack = [
    item.employer_name,
    ...item.reasons,
    item.opener,
    ...item.source_families,
    ...item.evidence_titles,
    ...item.location_names
  ].join(" ").toLocaleLowerCase("ru-RU")

  const includeTerms = [input.specialization, input.targetCity, input.includeKeywords]
    .flatMap((value) => splitTerms(value))
  const excludeTerms = splitTerms(input.excludeKeywords)

  if (includeTerms.length > 0 && !includeTerms.some((term) => haystack.includes(term))) {
    return false
  }

  return !excludeTerms.some((term) => haystack.includes(term))
}

function splitTerms(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim().toLocaleLowerCase("ru-RU"))
    .filter((item) => item !== "")
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
