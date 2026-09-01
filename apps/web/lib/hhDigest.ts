import { getDigestPreviewItems, getDigestItemsForClientProfile } from "./digest"
import type { DigestItem } from "./db-types"
import { isDigestEligibleGate } from "./scoring/gate-pipeline"

export type HhDigestItem = {
  rank: number
  org_id: string
  hh_employer_id: string
  employer_name: string
  vacancies_count: number
  distinct_vacancy_names_count: number
  latest_published_at: string
  total_score: number
  reasons: [string, string]
  opener: string
  source_families: string[]
  evidence_titles: string[]
  candidate_source_keys: string[]
  location_names: string[]
  confidence_gate?: 'A' | 'B' | 'C' | 'D'
  /** Durable identity used by native Telegram feedback callbacks. */
  digest_candidate_id?: string
}

export async function getHhDigestItems(input?: {
  clientProfileId?: string | null
}): Promise<HhDigestItem[]> {
  const clientProfileId = input?.clientProfileId?.trim() || null

  if (clientProfileId) {
    const items = await getDigestItemsForClientProfile({ clientProfileId })
    return items
      .filter(isDigestEligibleGate)
      .map((item) => ({
        rank: item.rank,
        org_id: item.org_id,
        hh_employer_id: item.source_external_id,
        employer_name: item.source_display_name,
        vacancies_count: item.vacancies_count,
        distinct_vacancy_names_count: item.distinct_vacancy_names_count,
        latest_published_at: item.latest_published_at,
        total_score: item.total_score,
        reasons: item.reasons,
        opener: item.opener,
        source_families: item.source_families,
        evidence_titles: item.evidence_titles,
        candidate_source_keys: item.candidate_source_keys,
        location_names: item.location_names,
        confidence_gate: item.confidence_gate
      }))
  }

  const items = await getDigestPreviewItems(10)

  return items
    .filter(isDigestEligibleGate)
    .map((item) => ({
    rank: item.rank,
    org_id: item.org_id,
    hh_employer_id: item.source_external_id,
    employer_name: item.source_display_name,
    vacancies_count: item.vacancies_count,
    distinct_vacancy_names_count: item.distinct_vacancy_names_count,
    latest_published_at: item.latest_published_at,
    total_score: item.total_score,
    reasons: item.reasons,
    opener: item.opener,
    source_families: item.source_families,
    evidence_titles: item.evidence_titles,
    candidate_source_keys: item.candidate_source_keys,
    location_names: item.location_names,
    confidence_gate: item.confidence_gate
  }))
}

const TELEGRAM_MESSAGE_CHAR_LIMIT = 4096

export function buildHhDigestText(items: readonly HhDigestItem[]): string {
  const header = "HH digest"
  const itemTexts = items.map((item) => {
    const reasonLines = item.reasons
      .filter((reason) => reason.trim() !== "")
      .map((reason) => `• ${reason}`)
    return [
      `${item.rank}. ${item.employer_name}`,
      `${item.vacancies_count} вакансий · score ${item.total_score.toFixed(1)}`,
      ...reasonLines,
      `Что делать: ${item.opener}`
    ].join("\n")
  })

  let result = header
  for (const itemText of itemTexts) {
    const candidate = result + "\n\n" + itemText
    if (candidate.length > TELEGRAM_MESSAGE_CHAR_LIMIT) break
    result = candidate
  }

  return result
}
