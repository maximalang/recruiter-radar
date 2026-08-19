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

for (const surface of family.discoverySurfaces) {
  const discovery = await discoverRfJobBoardSurface(family, surface);
  surfaceReports.push({
    kind: surface.kind,
    baseUrl: surface.baseUrl,
    blocked: discovery.blocked,
    reason: discovery.reason,
    robotsState: discovery.robotsState,
    selectedStage: discovery.selectedStage,
    finalUrl: discovery.finalUrl,
    structuredPostings: discovery.structuredPostings.length,
    vacancyLinks: discovery.vacancyLinks.length,
    discoveredCount: discovery.discoveredCount,
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

if (!fetchOnly && candidates.length > 0) {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
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
  } finally {
    await client.end();
  }
}

const identityCounts = persisted.reduce((counts, row) => {
  const key = row.identityStatus ?? 'unknown';
  counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}, {});

const report = {
  ok: surfaceReports.some((surface) => !surface.blocked),
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
