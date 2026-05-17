import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";

import { getClientProfileById, type ClientProfile } from "./clientProfiles";

type DigestDbClient = Pick<Pool, "query"> | Pick<PoolClient, "query">;

type DigestEvidenceRow = {
  rank: number;
  org_id: string | number;
  source_external_id: string | null;
  source_display_name: string | null;
  source_families: string[] | null;
  evidence_titles: string[] | null;
  candidate_source_keys: string[] | null;
  location_names: string[] | null;
  vacancies_count: number;
  distinct_vacancy_names_count: number;
  latest_published_at: string | Date | null;
  total_score: number;
  is_recent: boolean;
  primary_reason_label: string;
  secondary_reason_label: string;
  confidence_gate: string;
};

type DigestCandidateInsertRow = {
  id: string;
  orgId: string;
  sourceExternalId: string | null;
  sourceDisplayName: string;
  sourceFamilies: string[];
  vacanciesCount: number;
  distinctVacancyNamesCount: number;
  latestPublishedAt: string;
  totalScore: number;
  reasons: [string, string];
  opener: string;
};

type DigestRunRow = {
  id: string;
  clientProfileId: string;
  sourceKey: string;
  status: string;
  requestedLimit: number;
  selectedCount: number;
  cooldownDays: number;
  createdAt: string;
  completedAt: string | null;
};

export type DigestItem = {
  rank: number;
  orgId: string;
  sourceExternalId: string;
  sourceDisplayName: string;
  sourceFamilies: string[];
  evidenceTitles: string[];
  candidateSourceKeys: string[];
  locationNames: string[];
  vacanciesCount: number;
  distinctVacancyNamesCount: number;
  latestPublishedAt: string;
  totalScore: number;
  reasons: [string, string];
  opener: string;
  confidenceGate: string;
};

export type DigestRunResult = {
  run: DigestRunRow;
  clientProfile: ClientProfile;
  items: DigestItem[];
};

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

export async function getDigestPreviewItems(limit = 10): Promise<DigestItem[]> {
  const pool = getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const normalizedLimit = normalizeLimit(limit);
  const result = await pool.query<DigestEvidenceRow>(`${digestEvidenceQuery}\nLIMIT ${normalizedLimit}`);

  return result.rows.map(mapDigestEvidenceRow);
}

export async function getDigestItemsForClientProfile(input: {
  clientProfileId: string | number;
  sourceKey?: string | null;
  limit?: number | null;
}): Promise<DigestItem[]> {
  const pool = getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
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
          AND COALESCE(state.feedback_status, 'none') NOT IN ('contacted', 'replied', 'won', 'badfit', 'dismissed')
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
            AND COALESCE(state.feedback_status, 'none') NOT IN ('contacted', 'replied', 'won', 'badfit', 'dismissed')
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
      .filter((item) => matchesClientProfile(item, clientProfile))
      .sort((left, right) => compareDigestItemsForClient(left, right, clientProfile))
      .slice(0, requestedLimit);

    for (const item of items) {
      const candidateInsert = await client.query<DigestCandidateInsertRow>(`
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
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6::jsonb,
          $7,
          $8,
          NULLIF($9, '')::timestamptz,
          $10,
          $11::jsonb,
          $12,
          $13::jsonb
        )
        ON CONFLICT (digest_run_id, org_id) DO NOTHING
        RETURNING
          id::TEXT AS id,
          org_id::TEXT AS "orgId",
          source_external_id AS "sourceExternalId",
          source_display_name AS "sourceDisplayName",
          source_families,
          vacancies_count AS "vacanciesCount",
          distinct_vacancy_names_count AS "distinctVacancyNamesCount",
          latest_published_at::TEXT AS "latestPublishedAt",
          total_score AS "totalScore",
          reasons,
          opener
      `, [
        run.id,
        clientProfile.id,
        item.orgId,
        item.sourceExternalId || null,
        item.sourceDisplayName,
        JSON.stringify(item.sourceFamilies),
        item.vacanciesCount,
        item.distinctVacancyNamesCount,
        item.latestPublishedAt,
        item.totalScore,
        JSON.stringify(item.reasons),
        item.opener,
        JSON.stringify({
          rank: item.rank,
          sourceFamilies: item.sourceFamilies,
          confidenceGate: item.confidenceGate,
        })
      ]);

      const insertedCandidate = candidateInsert.rows[0];

      if (!insertedCandidate) {
        continue;
      }

      if (!input.skipStateWrite) {
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
          VALUES (
            $1,
            $2,
            $3,
            $4,
            NOW(),
            NOW() + ($5::TEXT || ' days')::interval,
            'none',
            $6,
            $7
          )
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
        `, [
          clientProfile.id,
          item.orgId,
          run.id,
          insertedCandidate.id,
          cooldownDays,
          item.sourceExternalId || null,
          item.sourceDisplayName
        ]);
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

function mapDigestEvidenceRow(row: DigestEvidenceRow): DigestItem {
  const reasons: [string, string] = [
    row.primary_reason_label,
    row.secondary_reason_label
  ];

  return {
    rank: row.rank,
    orgId: String(row.org_id),
    sourceExternalId: row.source_external_id ?? "",
    sourceDisplayName: row.source_display_name ?? "",
    sourceFamilies: Array.isArray(row.source_families) ? row.source_families : [],
    evidenceTitles: normalizeTextArray(row.evidence_titles),
    candidateSourceKeys: normalizeTextArray(row.candidate_source_keys),
    locationNames: normalizeTextArray(row.location_names),
    vacanciesCount: row.vacancies_count,
    distinctVacancyNamesCount: row.distinct_vacancy_names_count,
    latestPublishedAt: formatTimestamp(row.latest_published_at),
    totalScore: row.total_score,
    reasons,
    opener: buildOpener(row.source_display_name ?? "", reasons),
    confidenceGate: row.confidence_gate ?? "",
  };
}

function matchesClientProfile(item: DigestItem, clientProfile: ClientProfile): boolean {
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

function compareDigestItemsForClient(left: DigestItem, right: DigestItem, clientProfile: ClientProfile): number {
  const leftScopeScore = getClientScopeScore(left, clientProfile);
  const rightScopeScore = getClientScopeScore(right, clientProfile);

  if (leftScopeScore !== rightScopeScore) {
    return rightScopeScore - leftScopeScore;
  }

  if (left.totalScore !== right.totalScore) {
    return right.totalScore - left.totalScore;
  }

  return left.rank - right.rank;
}

function getClientScopeScore(item: DigestItem, clientProfile: ClientProfile): number {
  let score = 0;

  score += getScopedFieldScore(clientProfile.targetCity, item.locationNames, {
    exactMatch: 5,
    phraseMatch: 3,
    tokenMatch: 1,
  });

  score += getScopedFieldScore(clientProfile.specialization, item.evidenceTitles, {
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

function buildDigestHaystack(item: DigestItem): string {
  return [
    item.sourceDisplayName,
    ...item.reasons,
    item.opener,
    ...item.evidenceTitles,
    ...item.locationNames
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
      return "найм выглядит актуальным";
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
