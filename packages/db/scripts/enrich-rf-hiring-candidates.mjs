#!/usr/bin/env node

import assert from 'node:assert/strict';
import pg from 'pg';

import {
  getRfDiscoveryFamily,
  RF_DISCOVERY_FAMILY_IDS,
} from './adapters/rf-discovery-families.mjs';
import { discoverRfJobBoardSurface } from './adapters/rf-job-board-discovery.mjs';
import { fetchRfEmployerProfile } from './adapters/rf-employer-profile-enrichment.mjs';
import {
  buildRfHiringDiscoveryCandidate,
  resolveCandidateIdentity,
} from './adapters/rf-hiring-discovery-candidates.mjs';
import {
  loadHistoricalTransportPlan,
  recordTransportObservation,
} from './adapters/source-transport-health-store.mjs';

const { Client } = pg;
const familyArg = process.argv.find((arg) => arg.startsWith('--family='));
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const jsonOutput = process.argv.includes('--json');
const familyId = familyArg?.slice('--family='.length).trim();
const limit = normalizeLimit(limitArg?.slice('--limit='.length));

assert.ok(
  familyId && RF_DISCOVERY_FAMILY_IDS.includes(familyId),
  `Usage: enrich-rf-hiring-candidates.mjs --family=<${RF_DISCOVERY_FAMILY_IDS.join('|')}> [--limit=100] [--json]`,
);
const databaseUrl = process.env.DATABASE_URL?.trim();
assert.ok(databaseUrl, 'DATABASE_URL is required.');

const family = getRfDiscoveryFamily(familyId);
const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
await client.connect();
const stats = {
  scanned: 0,
  detailFetched: 0,
  detailBlocked: 0,
  profileFetched: 0,
  profileBlocked: 0,
  strongKeysAdded: 0,
  resolved: 0,
  ambiguous: 0,
  pending: 0,
};

try {
  const rows = await client.query(
    `SELECT id::TEXT AS id, source_family, vacancy_key, external_vacancy_id,
            vacancy_url, job_title, employer_name, employer_profile_url,
            employer_website_url, location, published_at, first_detected_at,
            last_detected_at, acquisition_method, identity_status,
            resolved_org_id::TEXT AS resolved_org_id, resolution_reason,
            strong_identity_keys, payload, content_fingerprint, promoted_at
     FROM rf_hiring_discovery_candidates_v2
     WHERE source_family = $1::TEXT
       AND identity_status IN ('pending', 'ambiguous')
       AND promoted_at IS NULL
     ORDER BY last_detected_at DESC, id DESC
     LIMIT $2::INTEGER`,
    [family.id, limit],
  );

  for (const candidate of rows.rows) {
    stats.scanned += 1;
    let detailCandidate = null;
    let profile = null;

    const detailHealthId = `rf-enrichment:${family.id}:vacancy-detail`;
    const detailPlan = await loadHistoricalTransportPlan(client, {
      sourceId: detailHealthId,
      configuredStages: family.transportStages,
      now: new Date(),
    });
    if (!detailPlan.stoppedByPolicy) {
      const startedAt = new Date();
      const detail = await discoverRfJobBoardSurface(
        family,
        { kind: 'vacancy-detail', baseUrl: candidate.vacancy_url },
        { stageOrder: detailPlan.stages },
      );
      await recordTransportObservation(client, {
        sourceId: detailHealthId,
        executionSourceId: family.id,
        startedAt,
        completedAt: new Date(),
        selectedStage: detail.selectedStage,
        attempts: detail.attempts,
        records: detail.discoveredCount,
        stoppedByPolicy: detail.blocked,
        reason: detail.reason,
      });
      if (detail.blocked) stats.detailBlocked += 1;
      else stats.detailFetched += 1;

      const posting = chooseDetailPosting(detail.structuredPostings, candidate.vacancy_url);
      if (posting) {
        detailCandidate = buildRfHiringDiscoveryCandidate({
          family,
          posting,
          vacancyUrl: candidate.vacancy_url,
          detectedAt: candidate.last_detected_at,
        });
      }
    } else {
      stats.detailBlocked += 1;
    }

    const employerProfileUrl = detailCandidate?.employerProfileUrl ?? candidate.employer_profile_url;
    if (employerProfileUrl) {
      const profileHealthId = `rf-enrichment:${family.id}:employer-profile`;
      const profilePlan = await loadHistoricalTransportPlan(client, {
        sourceId: profileHealthId,
        configuredStages: family.transportStages,
        now: new Date(),
      });
      if (!profilePlan.stoppedByPolicy) {
        const startedAt = new Date();
        const profileResult = await fetchRfEmployerProfile(family, employerProfileUrl, {
          stageOrder: profilePlan.stages,
        });
        await recordTransportObservation(client, {
          sourceId: profileHealthId,
          executionSourceId: family.id,
          startedAt,
          completedAt: new Date(),
          selectedStage: profileResult.selectedStage,
          attempts: profileResult.attempts,
          records: profileResult.profile ? 1 : 0,
          stoppedByPolicy: profileResult.blocked,
          reason: profileResult.reason,
        });
        if (profileResult.blocked) stats.profileBlocked += 1;
        else stats.profileFetched += 1;
        profile = profileResult.profile;
      } else {
        stats.profileBlocked += 1;
      }
    }

    const beforeKeys = new Set(candidate.strong_identity_keys ?? []);
    const mergedKeys = [...new Set([
      ...beforeKeys,
      ...(detailCandidate?.strongIdentityKeys ?? []),
      ...(profile?.strongIdentityKeys ?? []),
    ])].sort();
    stats.strongKeysAdded += mergedKeys.filter((key) => !beforeKeys.has(key)).length;

    const enriched = {
      ...candidate,
      external_vacancy_id: detailCandidate?.externalVacancyId ?? candidate.external_vacancy_id,
      job_title: detailCandidate?.jobTitle ?? candidate.job_title,
      employer_name: profile?.employerName ?? detailCandidate?.employerName ?? candidate.employer_name,
      employer_profile_url: employerProfileUrl ?? null,
      employer_website_url: profile?.employerWebsiteUrl ?? detailCandidate?.employerWebsiteUrl ?? candidate.employer_website_url,
      location: detailCandidate?.location ?? candidate.location,
      published_at: detailCandidate?.publishedAt ?? candidate.published_at,
      strong_identity_keys: mergedKeys,
      payload: {
        ...(candidate.payload ?? {}),
        ...(detailCandidate?.payload ?? {}),
        identity_enrichment: {
          detail_attempted: !detailPlan.stoppedByPolicy,
          profile_attempted: Boolean(employerProfileUrl),
          profile_url: employerProfileUrl ?? null,
          employer_website_url: profile?.employerWebsiteUrl ?? detailCandidate?.employerWebsiteUrl ?? candidate.employer_website_url ?? null,
          strong_identity_keys: mergedKeys,
          profile_extraction_method: profile?.extractionMethod ?? null,
          enriched_at: new Date().toISOString(),
        },
      },
      content_fingerprint: detailCandidate?.contentFingerprint ?? candidate.content_fingerprint,
    };

    await client.query('BEGIN');
    try {
      const resolution = await resolveCandidateIdentity(client, enriched);
      const updated = await client.query(
        `UPDATE rf_hiring_discovery_candidates_v2
         SET external_vacancy_id = COALESCE($2::TEXT, external_vacancy_id),
             job_title = COALESCE($3::TEXT, job_title),
             employer_name = COALESCE($4::TEXT, employer_name),
             employer_profile_url = COALESCE($5::TEXT, employer_profile_url),
             employer_website_url = COALESCE($6::TEXT, employer_website_url),
             location = COALESCE($7::TEXT, location),
             published_at = COALESCE($8::TIMESTAMPTZ, published_at),
             strong_identity_keys = $9::TEXT[],
             identity_status = $10::TEXT,
             resolved_org_id = $11::BIGINT,
             resolution_reason = $12::TEXT,
             payload = $13::JSONB,
             content_fingerprint = $14::CHAR(64),
             updated_at = NOW()
         WHERE id = $1::BIGINT
         RETURNING identity_status`,
        [
          candidate.id,
          enriched.external_vacancy_id,
          enriched.job_title,
          enriched.employer_name,
          enriched.employer_profile_url,
          enriched.employer_website_url,
          enriched.location,
          enriched.published_at,
          resolution.strongKeys,
          resolution.status,
          resolution.orgId,
          resolution.reason,
          JSON.stringify(enriched.payload),
          enriched.content_fingerprint,
        ],
      );
      await client.query('COMMIT');
      const status = updated.rows[0]?.identity_status ?? resolution.status;
      if (status === 'resolved') stats.resolved += 1;
      else if (status === 'ambiguous') stats.ambiguous += 1;
      else stats.pending += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`candidate ${candidate.id} enrichment failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} finally {
  await client.end();
}

const report = {
  ok: true,
  family: family.id,
  mode: 'vacancy-detail-employer-profile-identity-enrichment',
  generatedAt: new Date().toISOString(),
  promotionEligible: false,
  stats,
};
console.log(jsonOutput ? JSON.stringify(report) : JSON.stringify(report, null, 2));

function chooseDetailPosting(postings, vacancyUrl) {
  if (!Array.isArray(postings) || postings.length === 0) return null;
  const normalizedTarget = canonical(vacancyUrl);
  return postings.find((posting) => canonical(posting.vacancyUrl) === normalizedTarget) ?? postings[0];
}

function canonical(value) {
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

function normalizeLimit(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 1000 ? parsed : 100;
}
