export function buildHhRadarProbabilitySummary(input: {
  totalScore: number
  priorityScore?: number
  relevanceScore?: number
  timingScore?: number
  replyLikelihoodScore?: number
  confidenceScore?: number
  confidenceLabel?: string
  sourceCount?: number
  sourceKeys?: string[]
  structuredSignalCount?: number
  growthSignalCount?: number
  vacanciesCount?: number
  latestPublishedAt?: string | null
}): {
  workNowText: string
} {
  const score = Number.isFinite(input.totalScore) ? input.totalScore : 0

  if (score >= 80) {
    return { workNowText: "сильный сигнал" }
  }

  if (score >= 50) {
    return { workNowText: "стоит посмотреть" }
  }

  return { workNowText: "ранний сигнал" }
}
