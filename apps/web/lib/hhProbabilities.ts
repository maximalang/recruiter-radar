export function buildHhRadarProbabilitySummary(input: {
  totalScore: number
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
