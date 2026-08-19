export const RF_SOURCE_INTELLIGENCE_V2_TARGETS = Object.freeze({
  weeklyRecallMin: 0.95,
  discoveryLatencyP95MaxHours: 12,
  wrongCompanyAttributionMax: 0.01,
  duplicateHiringDemandMax: 0.02,
  priorityCorroborationMin: 0.90,
});

/**
 * Evaluate a representative RF hiring benchmark without coupling metric logic
 * to one acquisition source. Inputs are deliberately source-agnostic so the
 * benchmark measures unique-company discovery, not source-id inventory.
 *
 * benchmarkCompanies: [{ id, hiringActive, evidenceAppearedAt, detectedAt? }]
 * attributionAudits: [{ wrongCompany: boolean }]
 * demandAudits: [{ groundTruthDemandId, observedCanonicalDemandIds: string[] }]
 *   A duplicate means ONE audited real hiring demand was split across two or
 *   more canonical vacancy ids. Multiple source publications already collapsed
 *   into one canonical id are correctly NOT duplicates.
 * priorityOpportunities: [{ directEvidence, independentCorroboration }]
 */
export function evaluateRfCoverageBenchmark({
  benchmarkCompanies = [],
  attributionAudits = [],
  demandAudits = [],
  priorityOpportunities = [],
  targets = RF_SOURCE_INTELLIGENCE_V2_TARGETS,
} = {}) {
  const activeCompanies = benchmarkCompanies.filter((row) => row?.hiringActive === true);
  const detectedCompanies = activeCompanies.filter((row) => isFiniteDate(row?.detectedAt));
  const latenciesHours = detectedCompanies
    .map((row) => hoursBetween(row.evidenceAppearedAt, row.detectedAt))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);

  const recall = ratio(detectedCompanies.length, activeCompanies.length);
  const p95LatencyHours = percentile(latenciesHours, 0.95);

  const auditedAttributions = attributionAudits.filter((row) => typeof row?.wrongCompany === 'boolean');
  const wrongAttributions = auditedAttributions.filter((row) => row.wrongCompany).length;
  const wrongCompanyAttributionRate = ratio(wrongAttributions, auditedAttributions.length);

  const auditedDemands = demandAudits.filter((row) => (
    nonEmptyText(row?.groundTruthDemandId)
    && Array.isArray(row?.observedCanonicalDemandIds)
  ));
  const splitDemands = auditedDemands.filter((row) => uniqueNonEmpty(row.observedCanonicalDemandIds).length > 1);
  const duplicateHiringDemandRate = ratio(splitDemands.length, auditedDemands.length);

  const corroboratedPriority = priorityOpportunities.filter((row) => (
    row?.directEvidence === true || row?.independentCorroboration === true
  )).length;
  const priorityCorroborationRate = ratio(corroboratedPriority, priorityOpportunities.length);

  const checks = Object.freeze({
    weeklyRecall: metricCheck(recall, targets.weeklyRecallMin, 'min'),
    discoveryLatencyP95Hours: metricCheck(p95LatencyHours, targets.discoveryLatencyP95MaxHours, 'max'),
    wrongCompanyAttributionRate: metricCheck(wrongCompanyAttributionRate, targets.wrongCompanyAttributionMax, 'max'),
    duplicateHiringDemandRate: metricCheck(duplicateHiringDemandRate, targets.duplicateHiringDemandMax, 'max'),
    priorityCorroborationRate: metricCheck(priorityCorroborationRate, targets.priorityCorroborationMin, 'min'),
  });

  return Object.freeze({
    population: Object.freeze({
      activeCompanies: activeCompanies.length,
      detectedCompanies: detectedCompanies.length,
      attributionAudits: auditedAttributions.length,
      wrongAttributions,
      demandAudits: auditedDemands.length,
      splitDemands: splitDemands.length,
      priorityOpportunities: priorityOpportunities.length,
    }),
    metrics: Object.freeze({
      weeklyRecall: recall,
      discoveryLatencyP95Hours: p95LatencyHours,
      wrongCompanyAttributionRate,
      duplicateHiringDemandRate,
      priorityCorroborationRate,
    }),
    checks,
    pass: Object.values(checks).every((check) => check.pass === true),
  });
}

export function percentile(sortedValues, p) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return null;
  if (!(p >= 0 && p <= 1)) throw new RangeError('percentile p must be between 0 and 1');
  const index = Math.max(0, Math.ceil(sortedValues.length * p) - 1);
  return sortedValues[index];
}

function metricCheck(value, target, direction) {
  const measurable = Number.isFinite(value);
  return Object.freeze({
    value,
    target,
    direction,
    measurable,
    pass: measurable && (direction === 'min' ? value >= target : value <= target),
  });
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function hoursBetween(from, to) {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  return (toMs - fromMs) / 3_600_000;
}

function isFiniteDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function uniqueNonEmpty(values) {
  return [...new Set(values.map(nonEmptyText).filter(Boolean))];
}

function nonEmptyText(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}
