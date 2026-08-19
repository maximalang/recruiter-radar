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
        scope: 'identity-enrichment',
        skipped: true,
        skipReason: 'not-a-hiring-discovery-surface',
      });
      continue;
    }

    const healthSourceId = `rf-discovery:${family.id}:${surface.kind}`;
    const startedAt = new Date();
    const plan = client
      ? await loadHistoricalTransportPlan(client, {
        sourceId: healthSourceId,
        configuredStages: family.transportStages,
        now: startedAt,
      })
      : {
        sourceId: healthSourceId,
        observations: 0,
        attempts: 0,
        stages: family.transportStages,
        stoppedByPolicy: false,
        stoppedStage: null,
        health: { degradedStages: [], policyStoppedStages: [] },
      };

    if (plan.stoppedByPolicy) {
      surfaceReports.push({
        kind: surface.kind,
        baseUrl: surface.baseUrl,
        scope: 'hiring-discovery',
        blocked: true,
        reason: 'historical-policy-stop-fresh',
        robotsState: 'historical-policy-stop',
        selectedStage: null,
        finalUrl: null,
        structuredPostings: 0,
        vacancyLinks: 0,
        discoveredCount: 0,
        transportPlan: summarizePlan(plan),
      });
      continue;
    }

    const discovery = await discoverRfJobBoardSurface(family, surface, {
      stageOrder: plan.stages,
    });
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

    surfaceReports.push({
      kind: surface.kind,
      baseUrl: surface.baseUrl,
      scope: 'hiring-discovery',
      skipped: false,
      blocked: discovery.blocked,
      reason: discovery.reason,
      robotsState: discovery.robotsState,
      selectedStage: discovery.selectedStage,
      finalUrl: discovery.finalUrl,
      structuredPostings: discovery.structuredPostings.length,
      vacancyLinks: discovery.vacancyLinks.length,
      discoveredCount: discovery.discoveredCount,
      transportPlan: summarizePlan(plan),
      attempts: discovery.attempts,
    });

    if (discovery.blocked) continue;

    const structuredUrls = new Set();
    for (const posting of discovery.structuredPostings) {
      const candidate = buildRfHiringDiscoveryCandidate({ family, posting, detectedAt });
      if (!candidate) continue;
      structuredUrls.add(candidate.vacancyUrl);
      candidateByKey.set(`${candidate.sourceFamily}|${candidate.vacancyKey}`, candidate);
    }

    for (const vacancyUrl of discovery.vacancyLinks) {
      if (structuredUrls.has(vacancyUrl)) continue;
      const candidate = buildRfHiringDiscoveryCandidate({ family, vacancyUrl, detectedAt });
      if (!candidate) continue;
      candidateByKey.set(`${candidate.sourceFamily}|${candidate.vacancyKey}`, candidate);
    }
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
    ok: hiringSurfaces.some((surface) => surface.blocked === false && surface.discoveredCount > 0),
    family: family.id,
    productionState: family.productionState,
    mode: fetchOnly ? 'public-discovery-fetch-only' : 'public-discovery-stage-candidates',
    detectedAt,
    surfaces: surfaceReports,
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
