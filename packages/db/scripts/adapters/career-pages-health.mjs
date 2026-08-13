const ADAPTER_FAMILIES = Object.freeze({
  'greenhouse-board': 'greenhouse',
  'lever-postings': 'lever',
  'ashby-job-board': 'ashby',
  'recruitee-careers': 'recruitee',
  'workable-public-jobs': 'workable',
  'smartrecruiters-postings': 'smartrecruiters',
  'smartrecruiters-public-careers': 'smartrecruiters',
  'teamtailor-rss': 'teamtailor',
  'personio-xml': 'personio',
  'same-domain-jsonld': 'company-career',
  'hosted-career-page': 'hosted-career',
  'json-feed': 'json-feed',
  'static-records': 'static-records',
});

const REQUEST_STAGES = new Set([
  'official-feed',
  'static-http',
  'rendered-dom',
  'extraction',
]);

export function buildCareerPagesHealth({
  targetResults = [],
  recordsReceived = null,
  recordsAfterDedupe = null,
  duplicateRecords = 0,
  skippedRecords = 0,
  ingestionStats = null,
  familyIngestionStats = null,
  familyDuplicateCounts = null,
} = {}) {
  const groups = new Map();
  for (const result of Array.isArray(targetResults) ? targetResults : []) {
    const family = resolveFamily(result);
    const group = groups.get(family) ?? createAccumulator(family);
    accumulateTarget(group, result);
    groups.set(family, group);
  }

  const families = [...groups.values()]
    .map(finalizeAccumulator)
    .sort((left, right) => left.family.localeCompare(right.family, 'en'));
  for (const family of families) {
    const stats = familyIngestionStats?.[family.family];
    family.dbUpserts = boundedCount(stats?.signalUpsertCount);
    family.evidenceCreated = boundedCount(stats?.evidenceCreatedCount);
    family.duplicates = boundedCount(familyDuplicateCounts?.[family.family]);
  }
  const totalsAccumulator = createAccumulator('all');
  for (const result of Array.isArray(targetResults) ? targetResults : []) {
    accumulateTarget(totalsAccumulator, result);
  }
  const totals = finalizeAccumulator(totalsAccumulator);
  totals.duplicates = boundedCount(duplicateRecords);
  totals.skippedRecords = boundedCount(skippedRecords);
  totals.dbUpserts = boundedCount(ingestionStats?.signalUpsertCount);
  totals.evidenceCreated = boundedCount(ingestionStats?.evidenceCreatedCount);

  const received = boundedCount(recordsReceived);
  const afterDedupe = boundedCount(recordsAfterDedupe);
  if (received > 0 && afterDedupe === 0 && totals.duplicates > 0) {
    totals.zeroReasons.duplicatesOnly += 1;
  }
  if (received > 0 && afterDedupe === 0 && totals.skippedRecords > 0) {
    totals.zeroReasons.filteredAll += 1;
  }

  return {
    schemaVersion: 1,
    families,
    totals,
  };
}

export function detectCareerPagesHealthAnomalies(current, previous, {
  comparableBoardRatio = 0.8,
  severeJobRatio = 0.2,
  minimumPreviousJobs = 10,
} = {}) {
  const previousByFamily = new Map(
    (Array.isArray(previous?.families) ? previous.families : [])
      .map((entry) => [entry?.family, entry]),
  );
  const anomalies = [];

  for (const currentFamily of Array.isArray(current?.families) ? current.families : []) {
    const prior = previousByFamily.get(currentFamily?.family);
    const previousBoards = boundedCount(prior?.discoveredBoards);
    const currentBoards = boundedCount(currentFamily?.discoveredBoards);
    const previousJobs = boundedCount(prior?.jobsExtracted);
    const currentJobs = boundedCount(currentFamily?.jobsExtracted);
    if (
      previousBoards === 0
      || previousJobs < minimumPreviousJobs
      || currentBoards < Math.ceil(previousBoards * comparableBoardRatio)
    ) continue;

    if (currentJobs === 0) {
      anomalies.push({
        family: currentFamily.family,
        code: 'GLOBAL_ZERO_WITH_HTTP_COVERAGE',
        severity: 'critical',
        previousBoards,
        currentBoards,
        previousJobs,
        currentJobs,
      });
    } else if (currentJobs / previousJobs < severeJobRatio) {
      anomalies.push({
        family: currentFamily.family,
        code: 'SEVERE_JOB_COUNT_DROP',
        severity: 'warning',
        previousBoards,
        currentBoards,
        previousJobs,
        currentJobs,
      });
    }
  }

  return anomalies;
}

function createAccumulator(family) {
  return {
    family,
    companies: new Set(),
    discoveredBoards: 0,
    requests: 0,
    requestAccountingIncomplete: false,
    staticSuccesses: 0,
    browserFallbacks: 0,
    feedApiSuccesses: 0,
    blocked: 0,
    throttled: 0,
    parseFailures: 0,
    zeroJobResults: 0,
    notModified: 0,
    jobsExtracted: 0,
    durations: [],
    zeroReasons: createZeroReasons(),
  };
}

function createZeroReasons() {
  return {
    noVacanciesPresent: 0,
    careersPageEmpty: 0,
    parserOrLayoutDrift: 0,
    browserNotRendered: 0,
    accessBlocked: 0,
    throttled: 0,
    pageUnreachable: 0,
    duplicatesOnly: 0,
    filteredAll: 0,
  };
}

function accumulateTarget(group, result) {
  group.discoveredBoards += 1;
  const company = boundedText(result?.companyName);
  if (company) group.companies.add(company);
  group.jobsExtracted += boundedCount(result?.recordsFetched);
  const durationMs = Number(result?.durationMs);
  if (Number.isFinite(durationMs) && durationMs >= 0) group.durations.push(durationMs);

  const attempts = Array.isArray(result?.escalationAttempts) ? result.escalationAttempts : [];
  const observedRequests = boundedCount(result?.requestCount);
  if (observedRequests > 0) {
    group.requests += observedRequests;
  } else {
    const inferredRequests = attempts.filter((attempt) => REQUEST_STAGES.has(attempt?.stage)).length;
    if (inferredRequests > 0) {
      group.requests += inferredRequests;
      group.requestAccountingIncomplete = true;
    } else if (result?.adapter !== 'static-records') {
      group.requests += 1;
      group.requestAccountingIncomplete = true;
    }
  }

  const outcome = boundedText(result?.outcome);
  const method = boundedText(result?.extractionMethod) ?? '';
  const errorCategory = boundedText(result?.errorCategory) ?? '';
  const renderedAttempt = attempts.some((attempt) => attempt?.stage === 'rendered-dom');
  const browserUsed = renderedAttempt || /(?:playwright|rendered)/i.test(method);
  if (browserUsed) group.browserFallbacks += 1;
  if (outcome === 'parsed' && isStaticMethod(method) && !browserUsed) group.staticSuccesses += 1;
  if (outcome === 'parsed' && isFeedOrApiMethod(method)) group.feedApiSuccesses += 1;

  const isThrottled = /(?:^|-)429(?:$|-)|throttl/i.test(errorCategory)
    || attempts.some((attempt) => attempt?.outcome === 'deferred' || Number(attempt?.httpStatus) === 429);
  const isBlocked = Boolean(result?.stoppedByPolicy)
    || /(?:blocked|robots-disallowed|access-policy|http-(?:401|403|407|451))/i.test(errorCategory)
    || attempts.some((attempt) => attempt?.outcome === 'blocked');
  if (isThrottled) group.throttled += 1;
  if (isBlocked) group.blocked += 1;

  if (outcome === 'not-modified' || result?.notModified === true) {
    group.notModified += 1;
    return;
  }
  if (boundedCount(result?.recordsFetched) > 0) return;
  group.zeroJobResults += 1;
  if (isThrottled) group.zeroReasons.throttled += 1;
  else if (isBlocked) group.zeroReasons.accessBlocked += 1;
  else if (outcome === 'no-vacancies-present') group.zeroReasons.noVacanciesPresent += 1;
  else if (browserUsed && attempts.some((attempt) => (
    attempt?.stage === 'rendered-dom' && ['empty', 'error', 'validation-rejected'].includes(attempt?.outcome)
  ))) {
    group.zeroReasons.browserNotRendered += 1;
  } else if (outcome === 'extraction-zero-unexpected' || outcome === 'extractor-unsupported') {
    group.zeroReasons.parserOrLayoutDrift += 1;
    group.parseFailures += 1;
  } else if (outcome === 'page-unreachable') group.zeroReasons.pageUnreachable += 1;
  else group.zeroReasons.careersPageEmpty += 1;
}

function finalizeAccumulator(group) {
  return {
    family: group.family,
    discoveredCompanies: group.companies.size,
    discoveredBoards: group.discoveredBoards,
    requests: group.requests,
    requestAccounting: group.requestAccountingIncomplete ? 'lower-bound' : 'exact',
    staticSuccesses: group.staticSuccesses,
    browserFallbacks: group.browserFallbacks,
    feedApiSuccesses: group.feedApiSuccesses,
    blocked: group.blocked,
    throttled: group.throttled,
    parseFailures: group.parseFailures,
    zeroJobResults: group.zeroJobResults,
    notModified: group.notModified,
    jobsExtracted: group.jobsExtracted,
    duplicates: 0,
    skippedRecords: 0,
    dbUpserts: 0,
    evidenceCreated: 0,
    latencyMs: {
      p50: percentile(group.durations, 0.5),
      p95: percentile(group.durations, 0.95),
    },
    zeroReasons: { ...group.zeroReasons },
  };
}

function resolveFamily(result) {
  return resolveCareerPagesHealthFamily(result);
}

export function resolveCareerPagesHealthFamily({ hostedAtsFamily, adapter, sourceId } = {}) {
  return boundedText(hostedAtsFamily)
    ?? ADAPTER_FAMILIES[boundedText(adapter)]
    ?? (sourceId === 'career-pages' ? 'company-career' : boundedText(sourceId))
    ?? 'unknown';
}

function isStaticMethod(method) {
  return /(?:jsonld|html-card|static|taleo-public-joblist|public-detail)/i.test(method);
}

function isFeedOrApiMethod(method) {
  return /(?:api|rss|xml|feed|public-list|sitemap)/i.test(method);
}

function percentile(values, ratio) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return Math.round(ordered[Math.max(0, Math.ceil(ordered.length * ratio) - 1)]);
}

function boundedCount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

function boundedText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLocaleLowerCase('en-US');
  return text ? text.slice(0, 80) : null;
}
