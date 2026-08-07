import pg from 'pg';

const { Client } = pg;
const LABELS = new Set(['strong', 'acceptable', 'weak', 'not_a_lead']);
const REASONS = new Set([
  'ordinary_hiring',
  'wrong_role',
  'wrong_region',
  'wrong_company_size',
  'weak_external_need',
  'internal_only',
  'bad_timing',
  'bad_economics',
  'duplicate',
  'stale',
  'wrong_persona',
  'no_safe_contact',
  'other',
]);
const REVIEW_SETS = new Set(['training', 'holdout', 'production_shadow', 'canary']);

function parseArgs(argv) {
  const result = {
    lineageId: null,
    reviewerUserId: null,
    label: null,
    reasonCode: null,
    reviewSet: null,
    note: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--lineage-id') result.lineageId = argv[++index] ?? null;
    else if (arg === '--reviewer-user-id') result.reviewerUserId = argv[++index] ?? null;
    else if (arg === '--label') result.label = argv[++index] ?? null;
    else if (arg === '--reason') result.reasonCode = argv[++index] ?? null;
    else if (arg === '--review-set') result.reviewSet = argv[++index] ?? null;
    else if (arg === '--note') result.note = argv[++index] ?? null;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  result.lineageId = positiveId(result.lineageId, 'lineage');
  result.reviewerUserId = positiveId(result.reviewerUserId, 'reviewer user');
  result.label = enumValue(result.label, LABELS, 'label');
  result.reasonCode = enumValue(result.reasonCode, REASONS, 'reason');
  result.reviewSet = enumValue(result.reviewSet, REVIEW_SETS, 'review set');
  result.note = textOrNull(result.note);
  if (result.reasonCode === 'other' && !result.note) {
    throw new Error('--note is required when --reason=other');
  }
  return result;
}

export async function annotateCommercialSignalOpportunity({
  connectionString,
  lineageId,
  reviewerUserId,
  label,
  reasonCode,
  reviewSet,
  note = null,
}) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`commercial-signal:annotation:${lineageId}:${reviewerUserId}`],
    );
    const context = await client.query(
      `SELECT
         lineage.id::TEXT AS "lineageId",
         lineage.workspace_id::TEXT AS "workspaceId",
         lineage.client_profile_id::TEXT AS "clientProfileId",
         lineage.organization_id::TEXT AS "organizationId",
         lineage.opportunity_id::TEXT AS "opportunityId",
         lineage.candidate_id::TEXT AS "candidateId",
         org.name AS "organizationName",
         candidate.status AS "candidateStatus",
         candidate.ranking_score AS "rankingScore",
         lineage.commercial_signal_card AS "commercialSignalCard"
       FROM commercial_signal_opportunity_lineage lineage
       JOIN opportunity_candidates candidate ON candidate.id = lineage.candidate_id
       JOIN orgs org ON org.id = lineage.organization_id
       WHERE lineage.id = $1
       FOR SHARE OF lineage`,
      [positiveId(lineageId, 'lineage')],
    );
    const row = context.rows[0];
    if (!row) throw new Error('Commercial Signal lineage not found.');

    const generation = await client.query(
      `SELECT COALESCE(MAX(annotation_generation), 0)::INTEGER + 1 AS generation
       FROM commercial_signal_annotations
       WHERE lineage_id = $1 AND reviewer_user_id = $2`,
      [lineageId, reviewerUserId],
    );
    const annotationGeneration = Number(generation.rows[0]?.generation ?? 1);
    const inserted = await client.query(
      `INSERT INTO commercial_signal_annotations (
         lineage_id, workspace_id, client_profile_id, reviewer_user_id,
         annotation_generation, label, reason_code, review_set, note
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id::TEXT AS id, created_at::TEXT AS "createdAt"`,
      [
        lineageId,
        row.workspaceId,
        row.clientProfileId,
        reviewerUserId,
        annotationGeneration,
        label,
        reasonCode,
        reviewSet,
        note,
      ],
    );
    await client.query('COMMIT');
    return {
      annotationId: inserted.rows[0].id,
      annotationGeneration,
      createdAt: inserted.rows[0].createdAt,
      lineageId: row.lineageId,
      workspaceId: row.workspaceId,
      clientProfileId: row.clientProfileId,
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      opportunityId: row.opportunityId,
      candidateId: row.candidateId,
      candidateStatus: row.candidateStatus,
      rankingScore: Number(row.rankingScore),
      label,
      reasonCode,
      reviewSet,
      note,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

function positiveId(value, label) {
  const normalized = String(value ?? '').trim();
  if (!/^[1-9]\d{0,18}$/.test(normalized)
      || BigInt(normalized) > 9223372036854775807n) {
    throw new Error(`Invalid ${label} identifier.`);
  }
  return BigInt(normalized).toString();
}

function enumValue(value, allowed, label) {
  const normalized = String(value ?? '').trim();
  if (!allowed.has(normalized)) {
    throw new Error(`Invalid ${label}: ${normalized || '(empty)'}`);
  }
  return normalized;
}

function textOrNull(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const args = parseArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }
  try {
    const result = await annotateCommercialSignalOpportunity({
      connectionString,
      ...args,
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
