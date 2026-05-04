import { getDigestPreviewItems } from "./digest"

export type HhDigestItem = {
  rank: number
  hh_employer_id: string
  employer_name: string
  vacancies_count: number
  distinct_vacancy_names_count: number
  latest_published_at: string
  total_score: number
  reasons: [string, string]
  opener: string
}

export async function getHhDigestItems(): Promise<HhDigestItem[]> {
  const items = await getDigestPreviewItems(10)

  return items.map((item) => ({
    rank: item.rank,
    hh_employer_id: item.sourceExternalId,
    employer_name: item.sourceDisplayName,
    vacancies_count: item.vacanciesCount,
    distinct_vacancy_names_count: item.distinctVacancyNamesCount,
    latest_published_at: item.latestPublishedAt,
    total_score: item.totalScore,
    reasons: item.reasons,
    opener: item.opener
  }))
}
