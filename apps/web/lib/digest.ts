import { Pool, type PoolClient } from "pg";
import { getPool as getSharedPool } from "./db-pool";
import { logError, logWarn } from "./runtime";
import { isDigestEligibleGate } from "./scoring/gate-pipeline";
import { deriveReviewStatus } from "./scoring/gates";
import { getClientProfileById, INDUSTRY_KEYWORDS, resolveHiringMode, type ClientProfile } from "./clientProfiles";
import { ROLE_HABR_KEYWORDS } from "./lead-discovery/habr-keywords";
import { DIGEST_EVIDENCE_QUERY } from "./digest-evidence-query";
import { toSignalStrength } from "./scoring/score-display";
import { detectForeignEmployer, applyForeignEmployerPenalty } from "./scoring/foreign-employer";
import { deriveRoleNames, passesMinimumSignalGate } from "./leads/lead-quality";
import { hasSeniorRole } from "./scoring/role-category";
import type {
  DigestItem,
  DigestRun,
  DigestRunRow,
  DigestEvidenceRow,
  DigestCandidateInsertRow
} from "./db-types";

type DigestDbClient = Pick<Pool, "query"> | Pick<PoolClient, "query">;

// WHY inlined: the digest SQL is imported as a TS constant rather than read from
// disk at runtime. Next.js's standalone tracer cannot follow a dynamic
// readFileSync path, so the .sql was never bundled (ENOENT in prod); and
// fileURLToPath(import.meta.url) is unsafe in the bundled runtime. The constant
// is mirrored from packages/db/scripts/source-digest-evidence.sql and drift-guarded
// by digest-evidence-query.test.ts.
function getDigestEvidenceQuery(): string {
  return DIGEST_EVIDENCE_QUERY;
}

const globalForPg = globalThis as typeof globalThis & {
  recruiterRadarDigestPool?: Pool;
};

function getPool(): Pool | null {
  return getSharedPool();
}

export async function getDigestPreviewItems(limit = 10): Promise<DigestItemInput[]> {
  const pool = getPool();

  if (!pool) {
    logWarn('digest.preview_no_db', { fn: 'getDigestPreviewItems' });
    return [];
  }

  const normalizedLimit = normalizeLimit(limit);
  const result = await pool.query<DigestEvidenceRow>(`${getDigestEvidenceQuery()}\nLIMIT ${normalizedLimit}`);

  return result.rows.map(mapDigestEvidenceRow);
}

export type { DigestItem };
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
    logWarn('digest.items_no_db', { fn: 'getDigestItemsForClientProfile' });
    return [];
  }

  const clientProfile = await getClientProfileById(input.clientProfileId, null, pool);

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
      ${getDigestEvidenceQuery()}
    )
    -- NOTE: this wrapper re-projects columns by name, so any column added to the
    -- inner query (e.g. career_page_url, needed by the foreign-ATS geo gate in
    -- mapDigestEvidenceRow) MUST also be listed here or it silently drops out.
    SELECT
      ranked_candidates.rank,
      ranked_candidates.org_id,
      ranked_candidates.source_external_id,
      ranked_candidates.source_display_name,
      ranked_candidates.career_page_url,
      ranked_candidates.source_families,
      ranked_candidates.evidence_titles,
      ranked_candidates.candidate_source_keys,
      ranked_candidates.location_names,
      ranked_candidates.contact_paths,
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
    .filter(isDigestEligibleGate)
    .filter((item) => matchesClientProfile(item, clientProfile))
    .sort((left, right) => compareDigestItemsForClient(left, right, clientProfile))
    .slice(0, requestedLimit);
}

/**
 * Count how many CURRENT candidates a profile's filters would surface — the live
 * "≈N компаний сейчас подходят" preview on the settings page. Runs the same
 * evidence query + gate + matchesClientProfile path as the real digest (minus the
 * per-client suppression/cooldown state, which is delivery bookkeeping, not a
 * targeting signal), so the number reflects exactly what the filters do.
 *
 * Capped scan: counts within the same candidate window the digest considers, so a
 * very broad profile returns a "+" hint rather than a full table scan. Degrades to
 * 0 when there is no pool. Never throws to the caller (settings page must render).
 */
export async function countMatchingCandidatesForProfile(
  clientProfile: ClientProfile,
  options: { scanLimit?: number } = {},
): Promise<{ count: number; capped: boolean }> {
  const pool = getPool();
  if (!pool) return { count: 0, capped: false };

  const scanLimit = Math.min(Math.max(options.scanLimit ?? 500, 1), 2000);

  try {
    const result = await pool.query<DigestEvidenceRow>(
      `${getDigestEvidenceQuery()}\nLIMIT ${scanLimit}`,
    );
    const matches = result.rows
      .map(mapDigestEvidenceRow)
      .filter(isDigestEligibleGate)
      .filter((item) => matchesClientProfile(item, clientProfile));
    return { count: matches.length, capped: result.rows.length >= scanLimit };
  } catch (error) {
    logError('digest.match_count_failed', error, { clientProfileId: clientProfile.id });
    return { count: 0, capped: false };
  }
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

    const clientProfile = await getClientProfileById(input.clientProfileId, null, client);

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
        ${getDigestEvidenceQuery()}
      )
      -- NOTE: this wrapper re-projects columns by name, so any column added to the
      -- inner query (e.g. career_page_url, needed by the foreign-ATS geo gate in
      -- mapDigestEvidenceRow) MUST also be listed here or it silently drops out.
      SELECT
        ranked_candidates.rank,
        ranked_candidates.org_id,
        ranked_candidates.source_external_id,
        ranked_candidates.source_display_name,
        ranked_candidates.career_page_url,
        ranked_candidates.source_families,
        ranked_candidates.evidence_titles,
        ranked_candidates.candidate_source_keys,
        ranked_candidates.location_names,
        ranked_candidates.contact_paths,
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
        // Analyst-review gate: route gate-C / foreign-employer / single-source
        // candidates to pending_review so they surface in /review and the
        // "На проверке" metric. deriveReviewStatus is a pure rule (see
        // lib/scoring/gates.ts); the result is cast to the review_status enum.
        const reviewStatus = deriveReviewStatus({
          confidenceGate: item.confidence_gate,
          isForeignEmployer: item.is_foreign_employer ?? false,
          sourceFamilies: item.source_families,
        })
        candidateValues.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}::jsonb, $${paramIdx+6}, $${paramIdx+7}, NULLIF($${paramIdx+8}, '')::timestamptz, $${paramIdx+9}, $${paramIdx+10}::jsonb, $${paramIdx+11}, $${paramIdx+12}::jsonb, $${paramIdx+13}::review_status)`)
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
            evidence_titles: item.evidence_titles,
            location_names: item.location_names,
            // Auto-discovered contact surface (career-page HTML extraction).
            // Persisted so /leads + lead detail can render the concrete contact
            // without re-running the evidence query. [] = no surface found.
            contact_paths: item.contact_paths ?? [],
            is_foreign_employer: item.is_foreign_employer ?? false,
            foreign_matched_domain: item.foreign_matched_domain ?? null,
            // Cross-source corroboration metadata (2026-07-06 pass 2). Persisted
            // so analytics + lead card can read it without re-running the SQL.
            corroboration_key: item.corroboration_key ?? null,
            corroboration_key_type: item.corroboration_key_type ?? null,
            corroborated_org_ids: item.corroborated_org_ids ?? [],
            is_cross_source_corroborated: item.is_cross_source_corroborated ?? false,
          }),
          reviewStatus
        )
        paramIdx += 14
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
          payload,
          review_status
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
export type DigestItemInput = Omit<DigestItem, 'id' | 'digest_run_id' | 'created_at'>

function mapDigestEvidenceRow(row: DigestEvidenceRow): DigestItemInput {
  const reasons: [string, string] = [
    row.primary_reason_label || '',
    row.secondary_reason_label || ''
  ];

  const sourceExternalId = row.source_external_id ?? "";
  const sourceDisplayName = row.source_display_name ?? "";
  const evidenceTitles = normalizeTextArray(row.evidence_titles);
  const candidateSourceKeys = normalizeTextArray(row.candidate_source_keys);
  const locationNames = normalizeTextArray(row.location_names);

  // Geo gate (Block 1): a foreign employer (foreign-ATS host, no RU footprint)
  // must never out-rank a domestic lead. The SQL scorer grants any career-page
  // direct_hiring_proof (300) — so a Greenhouse/Lever board beats an HH lead
  // (200) purely for being a career page. Apply a SOFT penalty to the evidence
  // total so the foreign lead sinks below any domestic lead at equal activity,
  // while staying visible + flagged for the UI badge.
  const foreign = detectForeignEmployer({
    sourceDisplayName,
    sourceExternalId,
    // Fold the org career-page URL into the candidate keys the detector scans:
    // a foreign ATS host (boards.greenhouse.io, jobs.lever.co) lives ONLY on
    // career_page_url — the source keys carry a clean domain (domain:discord.com)
    // that never matches FOREIGN_ATS_DOMAINS. Without this the geo penalty never
    // fires and a Greenhouse/Lever board out-ranks a domestic lead.
    candidateSourceKeys: row.career_page_url
      ? [...candidateSourceKeys, row.career_page_url]
      : candidateSourceKeys,
    evidenceTitles,
    locationNames,
  });
  const total_score = applyForeignEmployerPenalty(row.total_score, foreign.isForeign);

  return {
    rank: row.rank,
    org_id: String(row.org_id),
    source_external_id: sourceExternalId,
    source_display_name: sourceDisplayName,
    source_families: Array.isArray(row.source_families) ? row.source_families : [],
    evidence_titles: evidenceTitles,
    candidate_source_keys: candidateSourceKeys,
    location_names: locationNames,
    vacancies_count: row.vacancies_count,
    distinct_vacancy_names_count: row.distinct_vacancy_names_count,
    latest_published_at: formatTimestamp(row.latest_published_at),
    total_score,
    reasons,
    opener: buildOpener(sourceDisplayName, reasons),
    confidence_gate: row.confidence_gate ?? "",
    is_foreign_employer: foreign.isForeign,
    foreign_matched_domain: foreign.matchedDomain,
    // Auto-discovered contact surface (career-page HTML extraction). Normalized
    // to a stable {category,value}[] shape; [] when the page exposed no contact
    // surface. See lib/scoring/contact-paths.ts for the category taxonomy.
    contact_paths: normalizeContactPaths(row.contact_paths),
    // Cross-source corroboration identity (2026-07-06 pass 2). Carried through
    // so the digest candidate payload records the merge, the lead card can show
    // "подтверждено N источниками" truthfully, and the analytics can count
    // cross-source corroborated share. corroboration_key_type 'org_id' = no
    // strong key, single-fragment (today's behavior).
    corroboration_key: row.corroboration_key ?? null,
    corroboration_key_type: row.corroboration_key_type ?? null,
    corroborated_org_ids: Array.isArray(row.corroborated_org_ids) ? row.corroborated_org_ids : [],
    is_cross_source_corroborated: Boolean(row.is_cross_source_corroborated),
  };
}

export function matchesClientProfile(item: DigestItemInput, clientProfile: ClientProfile): boolean {
  const haystack = buildDigestHaystack(item);

  // Industry filter: when the client selected specific industries, the
  // candidate must match at least one. We check industry keywords against
  // the haystack (employer name, evidence titles, location names).
  if (clientProfile.industries.length > 0) {
    const matchesIndustry = clientProfile.industries.some((industryKey) => {
      const keywords = INDUSTRY_KEYWORDS.get(industryKey);
      if (!keywords) return false;
      return keywords.some((kw) => haystack.includes(kw));
    });

    if (!matchesIndustry) {
      return false;
    }
  }

  if (clientProfile.includeKeywords.length > 0) {
    const hasIncludedKeyword = clientProfile.includeKeywords.some((keyword) => haystack.includes(keyword));

    if (!hasIncludedKeyword) {
      return false;
    }
  }

  if (clientProfile.excludeKeywords.some((keyword) => haystack.includes(keyword))) {
    return false;
  }

  // Excluded industries: symmetric to excludeKeywords — when the agency declared
  // an industry it does NOT serve, any candidate matching that industry's
  // keywords is dropped. FIUR computeFit already zeroes the Fit score via
  // findExclusion at generation time, but the per-client digest filter must
  // enforce it too, otherwise a strong Intent/Urgency lead in an excluded
  // industry still surfaces.
  if (clientProfile.excludedIndustries.length > 0) {
    const matchesExcludedIndustry = clientProfile.excludedIndustries.some((industryKey) => {
      const keywords = INDUSTRY_KEYWORDS.get(industryKey);
      if (!keywords) return false;
      return keywords.some((kw) => haystack.includes(kw));
    });

    if (matchesExcludedIndustry) {
      return false;
    }
  }

  // Excluded locations: an explicit negative from the agency. Drop when any of
  // the candidate's location names matches an excluded location — UNLESS the
  // agency is remote-friendly AND the candidate shows a remote-hiring signal,
  // in which case geography should not gate the lead.
  if (clientProfile.excludedLocations.length > 0 && !candidateIsRemoteFriendlyMatch(item, clientProfile)) {
    const normalizedLocations = item.location_names.map((loc) => normalizeSearchText(loc));
    const hitsExcludedLocation = clientProfile.excludedLocations.some((excluded) => {
      const needle = normalizeSearchText(excluded);
      if (!needle) return false;
      return normalizedLocations.some((loc) => loc.includes(needle) || needle.includes(loc));
    });

    if (hitsExcludedLocation) {
      return false;
    }
  }

  // Contact policy (corporate_only): the agency only works leads with a safe,
  // non-personal corporate surface. We drop ONLY when the absence of a corporate
  // surface is EXPLICIT — i.e. no career-pages source AND the confidence gate is
  // C/D (platform-only aggregation / context-only). Gate A/B already implies a
  // direct company surface (see CLAUDE.md confidence gates), so those pass.
  // A NULL/unknown domain is NOT treated as "no corporate surface" — this
  // deliberately avoids the leads=0 trap when registry sources carry no domain.
  if (clientProfile.contactPolicy === "corporate_only" && !candidateHasCorporateSurface(item)) {
    return false;
  }

  // Data-backed targeting thresholds (Block 2). Each applies ONLY when the agency
  // set it; an unset (null) threshold is a no-op, so existing profiles keep
  // surfacing every candidate (no leads=0 regression).

  // Hiring-intent floor: drop candidates whose signal strength is below the
  // agency's minimum. `hiringIntentMin` is on the [0,4] signal-strength scale
  // (validated into that range), but `item.total_score` is the raw evidence
  // score (~200–390). Convert before comparing — comparing the raw score
  // against a [0,4] threshold made this filter silently never fire.
  if (
    clientProfile.hiringIntentMin != null &&
    toSignalStrength(item.total_score) < clientProfile.hiringIntentMin
  ) {
    return false;
  }

  // Minimum open roles: drop candidates with fewer parsed vacancies than required.
  if (clientProfile.minOpenRoles != null && item.vacancies_count < clientProfile.minOpenRoles) {
    return false;
  }

  // Signal freshness: drop candidates whose latest hiring signal is older than the
  // agency's window. A candidate with NO date is KEPT — absence of a date cannot
  // prove staleness, and dropping it would silently lose registry-sourced leads.
  if (clientProfile.signalFreshnessDays != null && item.latest_published_at) {
    const publishedMs = Date.parse(item.latest_published_at);
    if (Number.isFinite(publishedMs)) {
      const ageDays = (Date.now() - publishedMs) / (24 * 60 * 60 * 1000);
      if (ageDays > clientProfile.signalFreshnessDays) {
        return false;
      }
    }
  }

  // Minimum signal-quality gate (Block 3): drop an empty-shell lead — no real
  // roles, no direct corporate surface. (AI hint is not known at generation time,
  // so it's treated as absent here; the gate only fires when roles AND surface
  // are both missing, so a career-pages / A-B lead still passes.) This filters the
  // vacuous leads that erode trust without regressing registry leads that carry
  // actual role titles.
  const roleNames = deriveRoleNames({ evidenceTitles: item.evidence_titles });
  if (
    !passesMinimumSignalGate({
      vacanciesCount: item.vacancies_count,
      roleNames,
      hasAiHint: false,
      sourceFamilies: item.source_families,
      confidenceGate: item.confidence_gate,
    })
  ) {
    return false;
  }

  return true;
}

/**
 * Whether the candidate has an evident safe corporate surface. True when a
 * career-pages source is present (direct company surface) OR the confidence gate
 * is A/B (auto-deliverable, which requires a direct company surface). Only an
 * explicit platform-only + C/D candidate is considered surface-less.
 */
function candidateHasCorporateSurface(item: DigestItemInput): boolean {
  const hasCareerSource = item.source_families.includes("career-pages");
  const gate = item.confidence_gate;
  const strongGate = gate === "A" || gate === "B";
  return hasCareerSource || strongGate;
}

/**
 * Whether a remote-friendly agency should ignore geography for this candidate.
 * Only relevant when the agency is remoteFriendly AND the candidate shows a
 * remote-hiring signal in its text (haystack). Conservative: with no remote
 * signal, excludedLocations still gates.
 */
function candidateIsRemoteFriendlyMatch(item: DigestItemInput, clientProfile: ClientProfile): boolean {
  if (!clientProfile.remoteFriendly) {
    return false;
  }

  const haystack = buildDigestHaystack(item);
  return REMOTE_HIRING_KEYWORDS.some((kw) => haystack.includes(kw));
}

const REMOTE_HIRING_KEYWORDS = ["удал", "remote", "удалённ", "удаленн", "дистанцион"] as const;

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

export function getClientScopeScore(item: DigestItemInput, clientProfile: ClientProfile): number {
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

  // Industry relevance: when the client selected industries, boost candidates
  // whose haystack matches industry keywords.
  if (clientProfile.industries.length > 0) {
    const haystack = buildDigestHaystack(item);
    const matchingIndustries = clientProfile.industries.filter((industryKey) => {
      const keywords = INDUSTRY_KEYWORDS.get(industryKey);
      if (!keywords) return false;
      return keywords.some((kw) => haystack.includes(kw));
    });
    // 3 points per matching industry, capped at 6 to avoid domination
    score += Math.min(matchingIndustries.length * 3, 6);
  }

  // Role relevance: boost (not filter) candidates whose evidence text matches
  // the agency's target roles. Roles are a BOOST and never a hard drop here —
  // ROLE_HABR_KEYWORDS is a narrow search seed (its own docstring warns it is
  // not an exclusion filter), so dropping on a keyword miss would silently zero
  // legitimate leads. FIUR computeFit already weights role share at generation;
  // this nudges within-digest ordering toward the agency's specialisation.
  if (clientProfile.roles.length > 0) {
    const haystack = buildDigestHaystack(item);
    const matchingRoles = clientProfile.roles.filter((roleKey) => {
      const keywords = ROLE_HABR_KEYWORDS[roleKey];
      if (!keywords || keywords.length === 0) return false;
      return keywords.some((kw) => haystack.includes(kw.toLocaleLowerCase("ru-RU")));
    });
    // 2 points per matching role, capped at 4 — below industry weight so industry
    // remains the dominant scoping signal.
    score += Math.min(matchingRoles.length * 2, 4);
  }

  // Mode-aware ranking (2026-07-06): the agency hiring practice mode changes
  // which signal is the dominant ranking cue. The mode only REWEIGHTS within
  // the digest — it never drops a candidate (matchesClientProfile already
  // gated) and never weakens a confidence gate.
  //
  //   executive — seniority is the dominant cue. A candidate whose evidence
  //               titles include a C-level / director / руководитель role
  //               outranks a volume-of-junior-roles candidate even at equal
  //               industry/region match. +6 (above industry cap of 6, but
  //               seniority is the *defining* signal for this agency type).
  //   volume    — open-role volume is the dominant cue. A candidate with many
  //               open positions is a stronger lead for a mass-hiring agency
  //               than one with a single role. Tiered: 10+ roles +5, 5–9 +3.
  //   specialist — no extra weight; the existing industry/role/region/special-
  //               ization scope above is the correct ranking for a niche
  //               practice (current default behavior preserved).
  const mode = resolveHiringMode(clientProfile);
  if (mode === 'executive') {
    const roles = deriveRoleNames({ evidenceTitles: item.evidence_titles });
    if (roles.length > 0 && hasSeniorRole(roles)) {
      score += 6;
    }
  } else if (mode === 'volume') {
    if (item.vacancies_count >= 10) {
      score += 5;
    } else if (item.vacancies_count >= 5) {
      score += 3;
    }
  }

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

/**
 * Normalize the auto-discovered contact surface from the digest evidence query
 * into a stable {category,value}[] shape. The query already dedupes + ranks
 * HR-first; this guards the boundary: tolerate non-array / malformed elements
 * (pg may return objects as Record<string,unknown>), drop blanks, dedupe again
 * defensively. Empty array is the honest "no contact surface found" outcome —
 * callers gate reachability on it rather than treat missing as "unreachable
 * unknown".
 */
function normalizeContactPaths(
  value: DigestEvidenceRow["contact_paths"],
): Array<{ category: string; value: string }> {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Array<{ category: string; value: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const category = typeof item.category === "string" ? item.category.trim() : "";
    const val = typeof item.value === "string" ? item.value.trim() : "";
    if (!category || !val) continue;
    const key = `${category}:${val}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ category, value: val });
  }
  return out;
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
