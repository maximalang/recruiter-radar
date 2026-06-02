import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { isDigestEligibleGate } from "./scoring/gate-pipeline";
import { getClientProfileById, type ClientProfile } from "./clientProfiles";
import type {
  DigestItem,
  DigestRun,
  DigestRunRow,
  DigestEvidenceRow,
  DigestCandidateInsertRow
} from "./db-types";

type DigestDbClient = Pick<Pool, "query"> | Pick<PoolClient, "query">;


const digestEvidenceQuery = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/db/scripts/source-digest-evidence.sql"),
  "utf8"
);

const globalForPg = globalThis as typeof globalThis & {
  recruiterRadarDigestPool?: Pool;
};

function getPool(): Pool | null {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    return null;
  }

  if (!globalForPg.recruiterRadarDigestPool) {
    globalForPg.recruiterRadarDigestPool = new Pool({
      connectionString
    });
  }

  return globalForPg.recruiterRadarDigestPool;
}

export async function getDigestPreviewItems(limit = 10): Promise<DigestItemInput[]> {
  const pool = getPool();

  if (!pool) {
    console.warn('getDigestPreviewItems: DATABASE_URL not set, returning empty digest');
    return [];
  }

  const normalizedLimit = normalizeLimit(limit);
  const result = await pool.query<DigestEvidenceRow>(`${digestEvidenceQuery}\nLIMIT ${normalizedLimit}`);

  return result.rows.map(mapDigestEvidenceRow);
}

export type { DigestItem };
export type { DigestItemInput };
export type DigestRunResult = {
  run: DigestRun;
  clientProfile: ClientProfile;
  items: DigestItemInput[];
};

export async function getDigestItemsForClientProfile(input: {
  clientProfileId: string | number;
  sourceKey?: string | null;
  limit?: number | null;
}): Promise<DigestItemInput[]> {
  const pool = getPool();

  if (!pool) {
    console.warn('getDigestItemsForClientProfile: DATABASE_URL not set, returning empty digest');
    return [];
  }

  const clientProfile = await getClientProfileById(input.clientProfileId, pool);

  if (!clientProfile) {
    throw new Error("Client profile not found.");
  }

  if (!clientProfile.isActive) {
    throw new Error("Client profile is inactive.");
  }

  const sourceKey = normalizeSourceKey(input.sourceKey);
  const requestedLimit = normalizeLimit(input.limit ?? clientProfile.dailyDigestLimit);

  const evidenceResult = await pool.query<DigestEvidenceRow>(`
    WITH ranked_candidates AS (
      ${digestEvidenceQuery}
    )
    SELECT
      ranked_candidates.rank,
      ranked_candidates.org_id,
      ranked_candidates.source_external_id,
      ranked_candidates.source_display_name,
      ranked_candidates.source_families,
      ranked_candidates.evidence_titles,
      ranked_candidates.candidate_source_keys,
      ranked_candidates.location_names,
      ranked_candidates.vacancies_count,
      ranked_candidates.distinct_vacancy_names_count,
      ranked_candidates.latest_published_at,
      ranked_candidates.total_score,
      ranked_candidates.is_recent,
      ranked_candidates.primary_reason_label,
      ranked_candidates.secondary_reason_label,
      ranked_candidates.confidence_gate
    FROM ranked_candidates
    LEFT JOIN client_digest_org_state AS state
      ON state.client_profile_id = $1
     AND state.org_id = ranked_candidates.org_id
    WHERE (
        state.client_profile_id IS NULL
        OR (
          COALESCE(state.suppressed_until, '-infinity'::timestamptz) <= NOW()
          AND COALESCE(state.cooldown_until, '-infinity'::timestamptz) <= NOW()
          AND COALESCE(state.feedback_status, 'none') NOT IN ('contacted', 'replied', 'won')
        )
      )
      AND (
        $2 = 'default'
        OR $2 = ANY(ranked_candidates.source_families)
        OR $2 = ANY(COALESCE(ranked_candidates.candidate_source_keys, ARRAY[]::text[]))
      )
    ORDER BY ranked_candidates.rank ASC
    LIMIT $3
  `, [clientProfile.id, sourceKey, requestedLimit * 5]);

  return evidenceResult.rows
    .map(mapDigestEvidenceRow)
    .filter((item) => matchesClientProfile(item, clientProfile))
    .sort((left, right) => compareDigestItemsForClient(left, right, clientProfile))
    .slice(0, requestedLimit);
}

export async function runDigestForClientProfile(input: {
  clientProfileId: string | number;
  sourceKey?: string | null;
  cooldownDays?: number | null;
  limit?: number | null;
  skipStateWrite?: boolean;
  userId?: string | number;
}): Promise<DigestRunResult> {
  const pool = getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const clientProfile = await getClientProfileById(input.clientProfileId, client);

    if (!clientProfile) {
      throw new Error("Client profile not found.");
    }

    if (!clientProfile.isActive) {
      throw new Error("Client profile is inactive.");
    }

    if (input.userId !== undefined && input.userId !== null) {
      const ownership = await client.query<{ ok: boolean }>(
        `SELECT 1 AS ok FROM client_profiles WHERE id = $1 AND owner_id = $2 LIMIT 1`,
        [input.clientProfileId, input.userId],
      );
      if (ownership.rowCount !== 1) {
        throw new Error("Access denied: ownership check failed for this client profile.");
      }
    }

    const sourceKey = normalizeSourceKey(input.sourceKey);
    const cooldownDays = normalizeCooldownDays(input.cooldownDays);
    const requestedLimit = normalizeLimit(input.limit ?? clientProfile.dailyDigestLimit);

    const runInsert = await client.query<DigestRunRow>(`
      INSERT INTO digest_runs (
        client_profile_id,
        source_key,
        status,
        requested_limit,
        selected_count,
        cooldown_days
      )
      VALUES ($1, $2, 'running', $3, 0, $4)
      RETURNING
        id::TEXT AS id,
        client_profile_id::TEXT AS "clientProfileId",
        source_key AS "sourceKey",
        status::TEXT AS status,
        requested_limit AS "requestedLimit",
        selected_count AS "selectedCount",
        cooldown_days AS "cooldownDays",
        created_at::TEXT AS "createdAt",
        completed_at::TEXT AS "completedAt"
    `, [clientProfile.id, sourceKey, requestedLimit, cooldownDays]);

    const run = runInsert.rows[0];

    const evidenceResult = await client.query<DigestEvidenceRow>(`
      WITH ranked_candidates AS (
        ${digestEvidenceQuery}
      )
      SELECT
        ranked_candidates.rank,
        ranked_candidates.org_id,
        ranked_candidates.source_external_id,
        ranked_candidates.source_display_name,
        ranked_candidates.source_families,
        ranked_candidates.evidence_titles,
        ranked_candidates.candidate_source_keys,
        ranked_candidates.location_names,
        ranked_candidates.vacancies_count,
        ranked_candidates.distinct_vacancy_names_count,
        ranked_candidates.latest_published_at,
        ranked_candidates.total_score,
        ranked_candidates.is_recent,
        ranked_candidates.primary_reason_label,
        ranked_candidates.secondary_reason_label,
        ranked_candidates.confidence_gate
      FROM ranked_candidates
      LEFT JOIN client_digest_org_state AS state
        ON state.client_profile_id = $1
       AND state.org_id = ranked_candidates.org_id
      WHERE (
          state.client_profile_id IS NULL
          OR (
            COALESCE(state.suppressed_until, '-infinity'::timestamptz) <= NOW()
            AND COALESCE(state.cooldown_until, '-infinity'::timestamptz) <= NOW()
            AND COALESCE(state.feedback_status, 'none') NOT IN ('contacted', 'replied', 'won')
          )
        )
        AND (
          $2 = 'default'
          OR $2 = ANY(ranked_candidates.source_families)
          OR $2 = ANY(COALESCE(ranked_candidates.candidate_source_keys, ARRAY[]::text[]))
        )
      ORDER BY ranked_candidates.rank ASC
      LIMIT $3
    `, [clientProfile.id, sourceKey, requestedLimit * 5]);

    const items = evidenceResult.rows
      .map(mapDigestEvidenceRow)
      .filter(isDigestEligibleGate)
      .filter((item) => matchesClientProfile(item, clientProfile))
      .sort((left, right) => compareDigestItemsForClient(left, right, clientProfile))
      .slice(0, requestedLimit);

    // Batch INSERT candidates — single query with multi-row VALUES list
    if (items.length > 0) {
      const candidateValues: string[] = []
      const candidateParams: unknown[] = []
      let paramIdx = 1

      for (const item of items) {
        candidateValues.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}::jsonb, $${paramIdx+6}, $${paramIdx+7}, NULLIF($${paramIdx+8}, '')::timestamptz, $${paramIdx+9}, $${paramIdx+10}::jsonb, $${paramIdx+11}, $${paramIdx+12}::jsonb)`)
        candidateParams.push(
          run.id,
          clientProfile.id,
          item.org_id,
          item.source_external_id || null,
          item.source_display_name,
          JSON.stringify(item.source_families),
          item.vacancies_count,
          item.distinct_vacancy_names_count,
          item.latest_published_at,
          item.total_score,
          JSON.stringify(item.reasons),
          item.opener,
          JSON.stringify({
            rank: item.rank,
            source_families: item.source_families,
            confidence_gate: item.confidence_gate,
          })
        )
        paramIdx += 13
      }

      const insertedCandidates = await client.query<{
        id: string
        org_id: string
        source_external_id: string | null
        source_display_name: string
      }>(`
        INSERT INTO digest_candidates (
          digest_run_id,
          client_profile_id,
          org_id,
          source_external_id,
          source_display_name,
          source_families,
          vacancies_count,
          distinct_vacancy_names_count,
          latest_published_at,
          total_score,
          reasons,
          opener,
          payload
        )
        VALUES ${candidateValues.join(',\n')}
        ON CONFLICT (digest_run_id, org_id) DO NOTHING
        RETURNING
          id::TEXT AS id,
          org_id::TEXT AS org_id,
          source_external_id,
          source_display_name
      `, candidateParams)

      // Batch INSERT org state for all successfully inserted candidates
      if (!input.skipStateWrite && insertedCandidates.rows.length > 0) {
        // Build O(1) lookup map by org_id — avoids O(n²) items.find() in the loop
        // and prevents misassociation on duplicate org_id entries
        const itemsByOrgId = new Map<string, DigestItemInput>()
        for (const item of items) {
          itemsByOrgId.set(item.org_id, item)
        }

        const stateValues: string[] = []
        const stateParams: unknown[] = []
        let stateParamIdx = 1

        for (const candidate of insertedCandidates.rows) {
          const item = itemsByOrgId.get(candidate.org_id)
          if (!item) continue

          stateValues.push(`($${stateParamIdx}, $${stateParamIdx+1}, $${stateParamIdx+2}, $${stateParamIdx+3}, NOW(), NOW() + ($${stateParamIdx+4}::TEXT || ' days')::interval, 'none', $${stateParamIdx+5}, $${stateParamIdx+6})`)
          stateParams.push(
            clientProfile.id,
            candidate.org_id,
            run.id,
            candidate.id,
            cooldownDays,
            candidate.source_external_id,
            candidate.source_display_name
          )
          stateParamIdx += 7
        }

        if (stateValues.length > 0) {
          await client.query(`
            INSERT INTO client_digest_org_state (
              client_profile_id,
              org_id,
              last_digest_run_id,
              last_digest_candidate_id,
              last_digest_at,
              cooldown_until,
              feedback_status,
              last_source_external_id,
              last_source_display_name
            )
            VALUES ${stateValues.join(',\n')}
            ON CONFLICT (client_profile_id, org_id) DO UPDATE
            SET
              last_digest_run_id = EXCLUDED.last_digest_run_id,
              last_digest_candidate_id = EXCLUDED.last_digest_candidate_id,
              last_digest_at = EXCLUDED.last_digest_at,
              cooldown_until = GREATEST(
                COALESCE(client_digest_org_state.cooldown_until, '-infinity'::timestamptz),
                EXCLUDED.cooldown_until
              ),
              last_source_external_id = COALESCE(EXCLUDED.last_source_external_id, client_digest_org_state.last_source_external_id),
              last_source_display_name = COALESCE(EXCLUDED.last_source_display_name, client_digest_org_state.last_source_display_name),
              updated_at = NOW()
          `, stateParams)
        }
      }
    }

    const completedRunResult = await client.query<DigestRunRow>(`
      UPDATE digest_runs
      SET
        status = 'completed',
        selected_count = (
          SELECT COUNT(*)::INT
          FROM digest_candidates
          WHERE digest_run_id = $1
        ),
        completed_at = NOW()
      WHERE id = $1
      RETURNING
        id::TEXT AS id,
        client_profile_id::TEXT AS "clientProfileId",
        source_key AS "sourceKey",
        status::TEXT AS status,
        requested_limit AS "requestedLimit",
        selected_count AS "selectedCount",
        cooldown_days AS "cooldownDays",
        created_at::TEXT AS "createdAt",
        completed_at::TEXT AS "completedAt"
    `, [run.id]);

    await client.query("COMMIT");

    return {
      run: completedRunResult.rows[0],
      clientProfile,
      items
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * DigestItem minus DB-generated fields (id, digest_run_id, created_at) that
 * are only present after INSERT. Used as the return type of mapDigestEvidenceRow
 * and as the input type for internal helpers that don't need those fields.
 */
type DigestItemInput = Omit<DigestItem, 'id' | 'digest_run_id' | 'created_at'>

function mapDigestEvidenceRow(row: DigestEvidenceRow): DigestItemInput {
  const reasons: [string, string] = [
    row.primary_reason_label || '',
    row.secondary_reason_label || ''
  ];

  return {
    rank: row.rank,
    org_id: String(row.org_id),
    source_external_id: row.source_external_id ?? "",
    source_display_name: row.source_display_name ?? "",
    source_families: Array.isArray(row.source_families) ? row.source_families : [],
    evidence_titles: normalizeTextArray(row.evidence_titles),
    candidate_source_keys: normalizeTextArray(row.candidate_source_keys),
    location_names: normalizeTextArray(row.location_names),
    vacancies_count: row.vacancies_count,
    distinct_vacancy_names_count: row.distinct_vacancy_names_count,
    latest_published_at: formatTimestamp(row.latest_published_at),
    total_score: row.total_score,
    reasons,
    opener: buildOpener(row.source_display_name ?? "", reasons),
    confidence_gate: row.confidence_gate ?? "",
  };
}

function matchesClientProfile(item: DigestItemInput, clientProfile: ClientProfile): boolean {
  const haystack = buildDigestHaystack(item);

  if (clientProfile.includeKeywords.length > 0) {
    const hasIncludedKeyword = clientProfile.includeKeywords.some((keyword) => haystack.includes(keyword));

    if (!hasIncludedKeyword) {
      return false;
    }
  }

  if (clientProfile.excludeKeywords.some((keyword) => haystack.includes(keyword))) {
    return false;
  }

  return true;
}

function compareDigestItemsForClient(left: DigestItemInput, right: DigestItemInput, clientProfile: ClientProfile): number {
  const leftScopeScore = getClientScopeScore(left, clientProfile);
  const rightScopeScore = getClientScopeScore(right, clientProfile);

  if (leftScopeScore !== rightScopeScore) {
    return rightScopeScore - leftScopeScore;
  }

  if (left.total_score !== right.total_score) {
    return right.total_score - left.total_score;
  }

  return left.rank - right.rank;
}

function getClientScopeScore(item: DigestItemInput, clientProfile: ClientProfile): number {
  let score = 0;

  score += getScopedFieldScore(clientProfile.targetCity, item.location_names, {
    exactMatch: 5,
    phraseMatch: 3,
    tokenMatch: 1,
  });

  score += getScopedFieldScore(clientProfile.specialization, item.evidence_titles, {
    exactMatch: 5,
    phraseMatch: 3,
    tokenMatch: 1,
  });

  return score;
}

function getScopedFieldScore(
  value: string | null,
  fields: readonly string[],
  weights: { exactMatch: number; phraseMatch: number; tokenMatch: number }
): number {
  const normalizedValue = normalizeSearchText(value ?? "");

  if (!normalizedValue) {
    return 0;
  }

  const normalizedFields = fields
    .map((field) => normalizeSearchText(field))
    .filter((field) => field.length > 0);

  if (normalizedFields.length === 0) {
    return 0;
  }

  if (normalizedFields.some((field) => field === normalizedValue)) {
    return weights.exactMatch;
  }

  if (normalizedFields.some((field) => field.includes(normalizedValue) || normalizedValue.includes(field))) {
    return weights.phraseMatch;
  }

  const scopedTokens = getMeaningfulSearchTokens(normalizedValue);

  if (scopedTokens.length === 0) {
    return 0;
  }

  const matchingTokenCount = scopedTokens.filter((token) =>
    normalizedFields.some((field) => field.includes(token))
  ).length;

  return matchingTokenCount * weights.tokenMatch;
}

function buildDigestHaystack(item: DigestItemInput): string {
  return [
    item.source_display_name,
    ...item.reasons,
    item.opener,
    ...item.evidence_titles,
    ...item.location_names
  ]
    .join(" ")
    .toLocaleLowerCase("ru-RU");
}

function buildOpener(employerName: string, reasons: readonly [string, string]): string {
  const safeEmployerName = shortenEmployerName(employerName);
  const [firstReason, secondReason] = reasons.map(toReasonFragment);

  const opener =
    `Здравствуйте! По ${safeEmployerName} видно, что ${firstReason}, а также ${secondReason}. ` +
    "Предлагаю короткий созвон на 10-15 минут, чтобы сверить задачи по найму и понять, можем ли быть полезны. " +
    "Если сейчас неактуально, просто дайте знать.";

  if (opener.length <= 450) {
    return opener;
  }

  return (
    `Здравствуйте! По ${safeEmployerName} видно: ${firstReason}; ${secondReason}. ` +
    "Предлагаю короткий созвон на 10-15 минут, чтобы понять, можем ли помочь с наймом. " +
    "Если неактуально, просто дайте знать."
  );
}

function shortenEmployerName(value: string): string {
  const name = value.trim();

  if (name.length <= 80) {
    return name || "компании";
  }

  return `${name.slice(0, 77)}...`;
}

function toReasonFragment(reason: string): string {
  switch (reason) {
    case "У компании несколько активных вакансий одновременно":
      return "идет несколько активных вакансий одновременно";
    case "У компании есть активная вакансия по рекрутингу":
      return "есть активная вакансия по рекрутингу";
    case "Есть несколько разных ролей, значит найм не точечный":
      return "найм выглядит не точечным";
    case "Роль опубликована недавно, это хороший момент для контакта":
      return "роль опубликована недавно";
    case "Вакансия опубликована совсем недавно":
      return "вакансия опубликована совсем недавно";
    default:
      return reason.length > 0 && reason.length <= 120 ? reason.toLowerCase() : "активно нанимает";
  }
}

function normalizeTextArray(value: string[] | null | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const uniqueValues = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const normalizedItem = item.trim();

    if (normalizedItem === "") {
      continue;
    }

    uniqueValues.add(normalizedItem);
  }

  return Array.from(uniqueValues.values());
}

function normalizeSearchText(value: string): string {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getMeaningfulSearchTokens(value: string): string[] {
  return Array.from(
    new Set(
      normalizeSearchText(value)
        .split(" ")
        .filter((token) => token.length >= 3)
    )
  );
}

function formatTimestamp(value: string | Date | null): string {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function normalizeLimit(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 10;
  }

  const normalizedValue = Math.trunc(value);

  if (normalizedValue <= 0) {
    return 10;
  }

  return Math.min(normalizedValue, 50);
}

function normalizeCooldownDays(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 3;
  }

  const normalizedValue = Math.trunc(value);
  return normalizedValue > 0 ? Math.min(normalizedValue, 90) : 3;
}

function normalizeSourceKey(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "default";
  }

  const normalizedValue = value.trim();
  return normalizedValue === "" ? "default" : normalizedValue;
}
