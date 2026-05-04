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
  priorityScore: number
  relevanceScore: number
  timingScore: number
  replyLikelihoodScore: number
  confidenceScore: number
  confidenceLabel: string
  sourceCount: number
  sourceKeys: string[]
  structuredSignalCount: number
  growthSignalCount: number
  curationLabels: string[]
}

export const PUBLIC_PLANS: PublicPlan[] = [
  {
    code: "pilot",
    name: "Pilot",
    cadence: "7 дней",
    amountMinor: 0,
    currency: "RUB",
    price: "0 ₽",
    description: "Короткий запуск, чтобы увидеть ежедневный радар на живом профиле.",
    bullets: ["профиль поиска", "первый радар", "подключение Telegram"],
    ctaLabel: "Запустить пилот",
    isPrimary: true
  },
  {
    code: "monthly",
    name: "Monthly",
    cadence: "ежемесячно",
    amountMinor: 0,
    currency: "RUB",
    price: "0 ₽",
    description: "Постоянный доступ к радару после пилота.",
    bullets: ["ежедневные сигналы", "тот же профиль", "без ручного запуска"],
    ctaLabel: "Выбрать monthly",
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
}): string {
  const params = new URLSearchParams()

  if (input.specialization) params.set("specialization", input.specialization)
  if (input.targetCity) params.set("targetCity", input.targetCity)
  if (input.includeKeywords) params.set("includeKeywords", input.includeKeywords)
  if (input.excludeKeywords) params.set("excludeKeywords", input.excludeKeywords)
  if (typeof input.dailyDigestLimit === "number") {
    params.set("dailyDigestLimit", String(input.dailyDigestLimit))
  }

  const query = params.toString()
  return query === "" ? "/checkout" : `/checkout?${query}`
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
    priorityScore: item.total_score,
    relevanceScore: item.total_score,
    timingScore: item.total_score,
    replyLikelihoodScore: item.total_score,
    confidenceScore: item.total_score,
    confidenceLabel: "medium",
    sourceCount: item.sourceFamilies.length,
    sourceKeys: item.candidateSourceKeys,
    structuredSignalCount: item.evidenceTitles.length,
    growthSignalCount: item.locationNames.length,
    curationLabels: item.sourceFamilies
  }
}

function matchesPreviewInput(item: HhDigestItem, input: PublicPreviewInput): boolean {
  const haystack = [
    item.employer_name,
    ...item.reasons,
    item.opener,
    ...item.sourceFamilies,
    ...item.evidenceTitles,
    ...item.locationNames
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
