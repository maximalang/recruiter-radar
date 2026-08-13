import pg from 'pg';
import sourcePolicy from '../../source-policy.json' with { type: 'json' };

import { normalizeLegalInn, parseCommaSeparated } from './rf-source-runtime.mjs';

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
       WHERE orgs.inn ~ '^\\d{10}$'
         AND signals.signal_type = 'job_posting'
         AND signals.source = ANY($2::text[])
       GROUP BY orgs.inn
       ORDER BY MAX(signals.occurred_at) DESC, orgs.inn
       LIMIT $1`,
      [boundedLimit, HIRING_EVIDENCE_SOURCE_IDS],
    );
    const trackedInns = uniqueLegalEntityInns(result.rows.map((row) => row.inn));
    if (trackedInns.length === 0) {
      throw new Error('Canonical database contains no tracked legal-entity INNs with hiring evidence.');
    }
    return trackedInns;
  } finally {
    await client.end();
  }
}

function uniqueLegalEntityInns(values) {
  return [...new Set(values.map(normalizeLegalInn).filter(Boolean))];
}

function validateLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > DEFAULT_LIMIT) {
    throw new Error(`Tracked company INN limit must be an integer between 1 and ${DEFAULT_LIMIT}.`);
  }
  return parsed;
}
