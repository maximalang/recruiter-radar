#!/usr/bin/env node

import assert from 'node:assert/strict';
import pg from 'pg';

import {
  getRfDiscoveryFamily,
  RF_DISCOVERY_FAMILY_IDS,
} from './adapters/rf-discovery-families.mjs';
import { discoverRfJobBoardSurface } from './adapters/rf-job-board-discovery.mjs';
import {
  buildRfHiringDiscoveryCandidate,
  upsertRfHiringDiscoveryCandidate,
} from './adapters/rf-hiring-discovery-candidates.mjs';
import {
  loadHistoricalTransportPlan,
  recordTransportObservation,
} from './adapters/source-transport-health-store.mjs';

const { Client } = pg;
const familyArg = process.argv.find((arg) => arg.startsWith('--family='));
const jsonOutput = process.argv.includes('--json');
const fetchOnly = process.argv.includes('--fetch-only');
const familyId = familyArg?.slice('--family='.length).trim();

assert.ok(
  familyId && RF_DISCOVERY_FAMILY_IDS.includes(familyId),
  `Usage: discover-rf-job-board.mjs --family=<${RF_DISCOVERY_FAMILY_IDS.join('|')}> [--json] [--fetch-only]`,
);

const family = getRfDiscoveryFamily(familyId);
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!fetchOnly) assert.ok(databaseUrl, 'DATABASE_URL is required unless --fetch-only is used.');

const detectedAt = new Date().toISOString();
const surfaceReports = [];
const candidateByKey = new Map();
const client = !fetchOnly
  ? new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 })
  : null;
if (client) await client.connect();

try {
  for (const surface of family.discoverySurfaces) {
    if (!isHiringDiscoverySurface(surface)) {
      surfaceReports.push({
        kind: surface.kind,
        baseUrl: surface.baseUrl,
        market: surface.market ?? null,
        scope: 'identity-enrichment',
        skipped: true,
        skipReason: 'not-a-hiring-discovery-surface',
      });
      continue;
    }

    const maxPages = normalizePageBudget(surface.maxPages);
    const queue = [surface.baseUrl];
    const queued = new Set(queue.map(canonicalUrl).filter(Boolean));
    const visited = new Set();
    const pageReports = [];
    const aggregate = {
      structuredPostings: 0,
      vacancyLinks: new Set(),
      paginationLinks: new Set(),
      blockedPages: 0,
      successfulPages: 0,
    };
    const healthSourceId = `rf-discovery:${family.id}:${surface.kind}:${surface.market ?? 'default'}`;

    while (queue.length > 0 && visited.size < maxPages) {
      const pageUrl = queue.shift();
      const pageKey = canonicalUrl(pageUrl);
      if (!pageKey || visited.has(pageKey)) continue;
      visited.add(pageKey);

      const startedAt = new Date();
      const plan = client
        ? await loadHistoricalTransportPlan(client, {
          sourceId: healthSourceId,
          configuredStages: family.transportStages,
          now: startedAt,
        })
        : defaultTransportPlan(healthSourceId, family.transportStages);

      if (plan.stoppedByPolicy) {
        aggregate.blockedPages += 1;
        pageReports.push({
          pageUrl,
          blocked: true,
          reason: 'historical-policy-stop-fresh',
          robotsState: 'historical-policy-stop',
          selectedStage: null,
          structuredPostings: 0,
          vacancyLinks: 0,
          paginationLinks: 0,
          discoveredCount: 0,
          transportPlan: summarizePlan(plan),
        });
        break;
      }

      const discovery = await discoverRfJobBoardSurface(
        family,
        {
          ...surface,
          baseUrl: pageUrl,
          paginationBaseUrl: surface.baseUrl,
        },
        { stageOrder: plan.stages },
      );

      if (client) {
        await recordTransportObservation(client, {
          sourceId: healthSourceId,
          executionSourceId: family.id,
          startedAt,
          completedAt: new Date(),
          selectedStage: discovery.selectedStage,
          attempts: discovery.attempts,
          records: discovery.discoveredCount,
          stoppedByPolicy: discovery.blocked,
          reason: discovery.reason,
        });
      }

      pageReports.push({
        pageUrl,
        blocked: discovery.blocked,
        reason: discovery.reason,
        robotsState: discovery.robotsState,
        selectedStage: discovery.selectedStage,
        finalUrl: discovery.finalUrl,
        structuredPostings: discovery.structuredPostings.length,
        vacancyLinks: discovery.vacancyLinks.length,
        paginationLinks: discovery.paginationLinks.length,
        discoveredCount: discovery.discoveredCount,
        transportPlan: summarizePlan(plan),
        attempts: discovery.attempts,
      });

      if (discovery.blocked) {
        aggregate.blockedPages += 1;
        if (isPolicyStop(discovery)) break;
        continue;
      }
      aggregate.successfulPages += 1;
      aggregate.structuredPostings += discovery.structuredPostings.length;

      const structuredUrls = new Set();
      for (const posting of discovery.structuredPostings) {
        const candidate = buildRfHiringDiscoveryCandidate({ family, posting, detectedAt });
        if (!candidate) continue;
        structuredUrls.add(candidate.vacancyUrl);
        aggregate.vacancyLinks.add(candidate.vacancyUrl);
        candidateByKey.set(`${candidate.sourceFamily}|${candidate.vacancyKey}`, candidate);
      }

      for (const vacancyUrl of discovery.vacancyLinks) {
        aggregate.vacancyLinks.add(vacancyUrl);
        if (structuredUrls.has(vacancyUrl)) continue;
        const candidate = buildRfHiringDiscoveryCandidate({ family, vacancyUrl, detectedAt });
        if (!candidate) continue;
        candidateByKey.set(`${candidate.sourceFamily}|${candidate.vacancyKey}`, candidate);
      }

      for (const paginationUrl of discovery.paginationLinks) {
        const paginationKey = canonicalUrl(paginationUrl);
        if (!paginationKey || visited.has(paginationKey) || queued.has(paginationKey)) continue;
        aggregate.paginationLinks.add(paginationKey);
        queued.add(paginationKey);
        queue.push(paginationUrl);
      }
    }

    surfaceReports.push({
      kind: surface.kind,
      baseUrl: surface.baseUrl,
      market: surface.market ?? null,
      scope: 'hiring-discovery',
      skipped: false,
      maxPages,
      pagesAttempted: visited.size,
      pagesSuccessful: aggregate.successfulPages,
      pagesBlocked: aggregate.blockedPages,
      structuredPostings: aggregate.structuredPostings,
      vacancyLinks: aggregate.vacancyLinks.size,
      paginationLinksDiscovered: aggregate.paginationLinks.size,
      discoveredCount: aggregate.vacancyLinks.size,
      pageReports,
    });
  }

  const candidates = [...candidateByKey.values()];
  const persisted = [];
  if (client) {
    for (const candidate of candidates) {
      const result = await upsertRfHiringDiscoveryCandidate(client, candidate);
      persisted.push({
        id: result?.id ?? null,
        identityStatus: result?.identity_status ?? result?.resolution?.status ?? null,
        resolvedOrgId: result?.resolved_org_id ?? result?.resolution?.orgId ?? null,
        resolutionReason: result?.resolution?.reason ?? null,
        vacancyKey: candidate.vacancyKey,
      });
    }
  }

  const identityCounts = persisted.reduce((counts, row) => {
    const key = row.identityStatus ?? 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const hiringSurfaces = surfaceReports.filter((surface) => surface.scope === 'hiring-discovery');
  const report = {
    ok: hiringSurfaces.some((surface) => surface.pagesSuccessful > 0 && surface.discoveredCount > 0),
    family: family.id,
    productionState: family.productionState,
    mode: fetchOnly ? 'public-discovery-fetch-only' : 'public-discovery-stage-candidates',
    detectedAt,
    surfaces: surfaceReports,
    pagesAttempted: hiringSurfaces.reduce((sum, surface) => sum + surface.pagesAttempted, 0),
    candidatesDiscovered: candidates.length,
    candidatesPersisted: persisted.length,
    identityCounts,
    promotionEligible: false,
    promotionReason: 'candidate discovery does not create hiring signals; production evidence→signal→lineage proof is still required',
  };

  if (jsonOutput) console.log(JSON.stringify(report));
  else console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 2;
} finally {
  if (client) await client.end();
}

function isHiringDiscoverySurface(surface) {
  return typeof surface?.kind === 'string' && surface.kind.includes('vacancy');
}

function normalizePageBudget(value) {
  return Number.isInteger(value) && value >= 1 && value <= 20 ? value : 1;
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const name of [...url.searchParams.keys()]) {
      if (/^(?:utm_|yclid$|gclid$|fbclid$)/i.test(name)) url.searchParams.delete(name);
    }
    return url.toString().replace(/\?$/, '');
  } catch {
    return null;
  }
}

function isPolicyStop(discovery) {
  if (discovery?.blocked !== true) return false;
  return (discovery?.attempts ?? []).some((attempt) => (
    attempt?.outcome === 'blocked' || attempt?.outcome === 'deferred'
  ));
}

function defaultTransportPlan(sourceId, stages) {
  return {
    sourceId,
    observations: 0,
    attempts: 0,
    stages,
    stoppedByPolicy: false,
    stoppedStage: null,
    health: { degradedStages: [], policyStoppedStages: [] },
  };
}

function summarizePlan(plan) {
  return {
    observations: plan.observations,
    attempts: plan.attempts,
    stages: [...(plan.stages ?? [])],
    degradedStages: [...(plan.health?.degradedStages ?? [])],
    policyStoppedStages: [...(plan.health?.policyStoppedStages ?? [])],
    stoppedByPolicy: plan.stoppedByPolicy,
    stoppedStage: plan.stoppedStage,
  };
}
