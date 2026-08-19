#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

import {
  getRfDiscoveryFamily,
  RF_DISCOVERY_FAMILY_IDS,
} from './adapters/rf-discovery-families.mjs';
import { resolveCandidateIdentity } from './adapters/rf-hiring-discovery-candidates.mjs';
import {
  loadCandidateCorroboration,
  persistCandidateCorroboration,
  promoteRfHiringCandidate,
} from './adapters/rf-hiring-candidate-reconciliation.mjs';

const { Client } = pg;
const familyArg = process.argv.find((arg) => arg.startsWith('--family='));
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const proofArg = process.argv.find((arg) => arg.startsWith('--proof='));
const jsonOutput = process.argv.includes('--json');
const promoteResolved = process.argv.includes('--promote-resolved');
const familyId = familyArg?.slice('--family='.length).trim() || null;
const limit = normalizeLimit(limitArg?.slice('--limit='.length));

if (familyId && !RF_DISCOVERY_FAMILY_IDS.includes(familyId)) {
  throw new Error(`Unknown RF discovery family: ${familyId}`);
}
if (promoteResolved) {
  assert.equal(process.env.RF_DISCOVERY_PROMOTE, '1', '--promote-resolved requires RF_DISCOVERY_PROMOTE=1');
  assert.ok(familyId, '--promote-resolved requires one explicit --family');
  assert.ok(proofArg, '--promote-resolved requires --proof=<fresh-production-proof.json>');
}

const databaseUrl = process.env.DATABASE_URL?.trim();
assert.ok(databaseUrl, 'DATABASE_URL is required.');
const productionProof = proofArg
  ? JSON.parse(readFileSync(resolve(proofArg.slice('--proof='.length)), 'utf8').replace(/^\uFEFF/, ''))
  : null;

const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
await client.connect();

const stats = {
  scanned: 0,
  resolved: 0,
  pending: 0,
  ambiguous: 0,
  rejected: 0,
  corroborated: 0,
  directEmployer: 0,
  ats: 0,
  legalIdentity: 0,
  promoted: 0,
  promotionBlocked: 0,
  promotionIssues: {},
};

try {
  const candidates = await loadCandidates(client, { familyId, limit });
  for (const candidate of candidates) {
    stats.scanned += 1;
    await client.query('BEGIN');
    try {
      let refreshed = candidate;
      if (!candidate.promoted_at) {
        const resolution = await resolveCandidateIdentity(client, candidate);
        refreshed = await persistResolutionMonotonic(client, candidate, resolution);
      }

      const status = refreshed.identity_status;
      if (status === 'resolved') stats.resolved += 1;
      else if (status === 'pending') stats.pending += 1;
      else if (status === 'ambiguous') stats.ambiguous += 1;
      else stats.rejected += 1;

      let corroboration = null;
      if (status === 'resolved') {
        corroboration = await loadCandidateCorroboration(client, refreshed);
        await persistCandidateCorroboration(client, refreshed.id, corroboration);
        if (corroboration.families.length > 0) stats.corroborated += 1;
        if (corroboration.directEmployerEvidence) stats.directEmployer += 1;
        if (corroboration.atsEvidence) stats.ats += 1;
        if (corroboration.legalIdentityCorroboration) stats.legalIdentity += 1;
      }

      if (promoteResolved && status === 'resolved' && !refreshed.promoted_at) {
        const family = getRfDiscoveryFamily(refreshed.source_family);
        const promotion = await promoteRfHiringCandidate(client, {
          candidate: refreshed,
          family,
          productionProof,
          corroboration: corroboration ?? {},
        });
        if (promotion.promoted) {
          stats.promoted += 1;
        } else {
          stats.promotionBlocked += 1;
          for (const issue of promotion.eligibility.issues) {
            stats.promotionIssues[issue] = (stats.promotionIssues[issue] ?? 0) + 1;
          }
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`candidate ${candidate.id} reconciliation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} finally {
  await client.end();
}

const report = {
  ok: true,
  mode: promoteResolved ? 'reconcile-and-promote-gated' : 'reconcile-only',
  family: familyId,
  limit,
  generatedAt: new Date().toISOString(),
  promotionRequested: promoteResolved,
  stats,
};

console.log(jsonOutput ? JSON.stringify(report) : JSON.stringify(report, null, 2));

async function loadCandidates(db, { familyId: selectedFamily, limit: rowLimit }) {
  const result = await db.query(
    `SELECT id::TEXT AS id, source_family, vacancy_key, external_vacancy_id,
            vacancy_url, job_title, employer_name, employer_profile_url,
            employer_website_url, location, published_at, first_detected_at,
            last_detected_at, acquisition_method, identity_status,
            resolved_org_id::TEXT AS resolved_org_id, resolution_reason,
            strong_identity_keys, corroboration_families, payload,
            promoted_at, promoted_signal_external_id
     FROM rf_hiring_discovery_candidates_v2
     WHERE identity_status <> 'rejected'
       AND ($1::TEXT IS NULL OR source_family = $1::TEXT)
     ORDER BY
       CASE identity_status WHEN 'pending' THEN 0 WHEN 'ambiguous' THEN 1 ELSE 2 END,
       last_detected_at DESC,
       id DESC
     LIMIT $2::INTEGER`,
    [selectedFamily, rowLimit],
  );
  return result.rows;
}

async function persistResolutionMonotonic(db, candidate, resolution) {
  const result = await db.query(
    `UPDATE rf_hiring_discovery_candidates_v2
     SET identity_status = CASE
           WHEN promoted_at IS NOT NULL THEN identity_status
           WHEN identity_status = 'resolved' AND $2::TEXT = 'pending' THEN identity_status
           ELSE $2::TEXT
         END,
         resolved_org_id = CASE
           WHEN promoted_at IS NOT NULL THEN resolved_org_id
           WHEN identity_status = 'resolved' AND $2::TEXT = 'pending' THEN resolved_org_id
           ELSE $3::BIGINT
         END,
         resolution_reason = CASE
           WHEN promoted_at IS NOT NULL THEN resolution_reason
           WHEN identity_status = 'resolved' AND $2::TEXT = 'pending' THEN resolution_reason
           ELSE $4::TEXT
         END,
         strong_identity_keys = CASE
           WHEN CARDINALITY($5::TEXT[]) > 0 THEN $5::TEXT[]
           ELSE strong_identity_keys
         END,
         updated_at = NOW()
     WHERE id = $1::BIGINT
     RETURNING id::TEXT AS id, source_family, vacancy_key, external_vacancy_id,
               vacancy_url, job_title, employer_name, employer_profile_url,
               employer_website_url, location, published_at, first_detected_at,
               last_detected_at, acquisition_method, identity_status,
               resolved_org_id::TEXT AS resolved_org_id, resolution_reason,
               strong_identity_keys, corroboration_families, payload,
               promoted_at, promoted_signal_external_id`,
    [candidate.id, resolution.status, resolution.orgId, resolution.reason, resolution.strongKeys],
  );
  return result.rows[0];
}

function normalizeLimit(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 5000 ? parsed : 500;
}
