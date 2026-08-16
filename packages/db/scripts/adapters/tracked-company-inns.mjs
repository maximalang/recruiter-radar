import pg from 'pg';
import sourcePolicy from '../../source-policy.json' with { type: 'json' };

import { normalizeLegalInn, parseCommaSeparated } from './rf-source-runtime.mjs';
import { classifyStrongIdentityKey } from './organization-resolution.mjs';

const { Client } = pg;
const DEFAULT_LIMIT = 50;
const HIRING_EVIDENCE_SOURCE_IDS = Object.freeze(Object.entries(sourcePolicy)
  .filter(([, policy]) => ['digest-lead-originating', 'confidence-gated-evidence'].includes(policy.leadEligibility))
  .map(([sourceId]) => sourceId));

export async function resolveTrackedCompanyInns({
  explicitInns = process.env.GOVERNMENT_ENRICHMENT_INNS,
  databaseUrl = process.env.DATABASE_URL,
  limit = DEFAULT_LIMIT,
  clientFactory = (connectionString) => new Client({ connectionString }),
} = {}) {
  const explicitValues = parseCommaSeparated(explicitInns);
  if (explicitValues.length > 0) {
    const normalized = uniqueLegalEntityInns(explicitValues);
    if (normalized.length === 0) {
      throw new Error('GOVERNMENT_ENRICHMENT_INNS contained no valid 10-digit legal-entity INNs.');
    }
    return normalized.slice(0, validateLimit(limit));
  }

  const connectionString = databaseUrl?.trim();
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to derive tracked company INNs when no explicit override is supplied.');
  }

  const boundedLimit = validateLimit(limit);
  const client = clientFactory(connectionString);
  await client.connect();
  try {
    const result = await client.query(
      `SELECT orgs.inn
       FROM orgs
       JOIN signals ON signals.org_id = orgs.id
       WHERE CASE WHEN orgs.inn ~ '^\\d{10}$' THEN
         MOD(MOD(
             2 * SUBSTRING(orgs.inn, 1, 1)::int
             + 4 * SUBSTRING(orgs.inn, 2, 1)::int
             + 10 * SUBSTRING(orgs.inn, 3, 1)::int
             + 3 * SUBSTRING(orgs.inn, 4, 1)::int
             + 5 * SUBSTRING(orgs.inn, 5, 1)::int
             + 9 * SUBSTRING(orgs.inn, 6, 1)::int
             + 4 * SUBSTRING(orgs.inn, 7, 1)::int
             + 6 * SUBSTRING(orgs.inn, 8, 1)::int
             + 8 * SUBSTRING(orgs.inn, 9, 1)::int,
             11
           ), 10) = SUBSTRING(orgs.inn, 10, 1)::int
         ELSE FALSE
       END
         AND signals.signal_type = 'job_posting'
         AND signals.source = ANY($2::text[])
       GROUP BY orgs.inn
       ORDER BY MAX(signals.occurred_at) DESC, orgs.inn
       LIMIT $1`,
      [boundedLimit, HIRING_EVIDENCE_SOURCE_IDS],
    );
    const trackedInns = uniqueLegalEntityInns(result.rows.map((row) => row.inn));
    return trackedInns;
  } finally {
    await client.end();
  }
}

export function buildNoEligibleLegalEntitiesSummary(source) {
  return {
    ok: true,
    source,
    outcome: 'expected-zero',
    reason: 'deferred:no-eligible-legal-entities',
    eligibleLegalEntities: 0,
    activated: false,
  };
}

function uniqueLegalEntityInns(values) {
  return [...new Set(values.map((value) => {
    const normalized = normalizeLegalInn(value);
    if (!normalized) return null;
    return classifyStrongIdentityKey(`inn:${normalized}`)?.type === 'inn' ? normalized : null;
  }).filter(Boolean))];
}

function validateLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > DEFAULT_LIMIT) {
    throw new Error(`Tracked company INN limit must be an integer between 1 and ${DEFAULT_LIMIT}.`);
  }
  return parsed;
}
