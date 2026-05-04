import { getDigestPreviewItems, runDigestForClientProfile } from "./digest"

export type HhDigestItem = {
  rank: number
  orgId: string
  hh_employer_id: string
  employer_name: string
  vacancies_count: number
  distinct_vacancy_names_count: number
  latest_published_at: string
  total_score: number
  reasons: [string, string]
  opener: string
  sourceFamilies: string[]
  evidenceTitles: string[]
  candidateSourceKeys: string[]
  locationNames: string[]
}

export async function getHhDigestItems(input?: {
  clientProfileId?: string | null
}): Promise<HhDigestItem[]> {
  const items = input?.clientProfileId
    ? (await runDigestForClientProfile({ clientProfileId: input.clientProfileId })).items
    : await getDigestPreviewItems(10)

  return items.map((item) => ({
    rank: item.rank,
    orgId: item.orgId,
    hh_employer_id: item.sourceExternalId,
    employer_name: item.sourceDisplayName,
    vacancies_count: item.vacanciesCount,
    distinct_vacancy_names_count: item.distinctVacancyNamesCount,
    latest_published_at: item.latestPublishedAt,
    total_score: item.totalScore,
    reasons: item.reasons,
    opener: item.opener,
    sourceFamilies: item.sourceFamilies,
    evidenceTitles: item.evidenceTitles,
    candidateSourceKeys: item.candidateSourceKeys,
    locationNames: item.locationNames
  }))
}

export function buildHhDigestText(items: readonly HhDigestItem[]): string {
  const lines = items.flatMap((item) => {
    const reasonLines = item.reasons
      .filter((reason) => reason.trim() !== "")
      .map((reason) => `• ${reason}`)

    return [
      `${item.rank}. ${item.employer_name}`,
      `${item.vacancies_count} вакансий · score ${item.total_score.toFixed(1)}`,
      ...reasonLines,
      `Что делать: ${item.opener}`
    ]
  })

  return ["HH digest", "", ...lines].join("\n")
}
