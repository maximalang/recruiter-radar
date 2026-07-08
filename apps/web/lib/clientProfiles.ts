import { Pool, type PoolClient } from "pg";
import { getPool as getSharedPool } from "./db-pool";
import type { AgencyProfile } from "./scoring/scoring-pipeline";

type ClientProfilesDbClient = Pick<Pool, "query"> | Pick<PoolClient, "query">;

type ClientProfileRow = {
  id: string;
  agencyName: string;
  telegramChatId: string | null;
  targetCity: string | null;
  specialization: string | null;
  includeKeywords: unknown;
  excludeKeywords: unknown;
  industries: unknown;
  companySizes: unknown;
  dailyDigestLimit: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  contactPolicy: string;
  roles: unknown;
  excludedIndustries: unknown;
  excludedLocations: unknown;
  remoteFriendly: boolean;
  hiringIntentMin: number | null;
  signalFreshnessDays: number | null;
  minOpenRoles: number | null;
  hiringMode: string | null;
};

/**
 * Agency hiring practice mode — the universal agency-model dimension.
 *
 * Controls how matching/ranking/urgency/explanation weight signals for this
 * agency. The mode only REWEIGHTS within the existing gate pipeline; it never
 * bypasses a confidence gate, never weakens an evidence-first bar, and never
 * inflates lead counts.
 *
 *   'auto'       — infer from `roles` via resolveHiringMode(). Default for
 *                  legacy/empty profiles → falls back to 'specialist'.
 *   'specialist' — niche IT / digital / finance practice; current default
 *                  behavior. Seniority matters but volume is not noise.
 *   'executive'  — C-level / director search; seniority is the dominant fit
 *                  signal, raw open-role volume is treated as noise.
 *   'volume'     — mass / industrial / logistics / sales-floor hiring;
 *                  open-role volume and burst are the dominant signals.
 */
export type HiringMode = 'auto' | 'specialist' | 'executive' | 'volume';

export const VALID_HIRING_MODES: ReadonlySet<HiringMode> = new Set([
  'auto', 'specialist', 'executive', 'volume',
]);

export const DEFAULT_HIRING_MODE: HiringMode = 'auto';

export type ClientProfile = {
  id: string;
  agencyName: string;
  telegramChatId: string | null;
  targetCity: string | null;
  specialization: string | null;
  includeKeywords: string[];
  excludeKeywords: string[];
  industries: string[];
  companySizes: string[];
  dailyDigestLimit: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  contactPolicy: 'corporate_only' | 'no_personal' | 'unrestricted';
  /** Canonical role keys the agency specialises in (e.g. 'it-engineering', 'data'). */
  roles: string[];
  /** Industry keys the agency explicitly does not serve. */
  excludedIndustries: string[];
  /** Location/region names the agency explicitly does not cover. */
  excludedLocations: string[];
  /** Whether the agency can serve remote-first companies regardless of location. */
  remoteFriendly: boolean;
  /** Minimum FIUR total score (0..4) a candidate must reach. null = no threshold. */
  hiringIntentMin: number | null;
  /** Max age in days of the latest hiring signal. null = no threshold. */
  signalFreshnessDays: number | null;
  /** Minimum parsed open-role count (vacancies). null = no minimum. */
  minOpenRoles: number | null;
  /** Agency hiring practice mode. See {@link HiringMode}. */
  hiringMode: HiringMode;
};

type PilotApplicationRow = {
  id: string;
  name: string;
  telegram: string;
  specialization: string | null;
  city: string | null;
  comment: string | null;
  createdAt: string;
};

export type PilotApplication = {
  id: string;
  name: string;
  telegram: string;
  specialization: string | null;
  city: string | null;
  comment: string | null;
  createdAt: string;
};

const globalForPg = globalThis as typeof globalThis & {
  recruiterRadarClientProfilesPool?: Pool;
};

function getPool(): Pool | null {
  return getSharedPool();
}

/**
 * List client profiles owned by the given ownerId.
 * Pilot mode: also returns profiles with owner_id IS NULL (anonymous/pilot profiles).
 *
 * @param ownerId - Session owner ID from getOwnerIdFromSession()
 * @returns Array of client profiles accessible by this owner
 */
export async function listClientProfiles(ownerId: string | number): Promise<ClientProfile[]> {
  const pool = getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const result = await pool.query<ClientProfileRow>(`
    SELECT
      id::TEXT AS id,
      agency_name AS "agencyName",
      telegram_chat_id::TEXT AS "telegramChatId",
      target_city AS "targetCity",
      specialization,
      include_keywords AS "includeKeywords",
      exclude_keywords AS "excludeKeywords",
      industries AS "industries",
      company_sizes AS "companySizes",
      daily_digest_limit AS "dailyDigestLimit",
      is_active AS "isActive",
      created_at::TEXT AS "createdAt",
      updated_at::TEXT AS "updatedAt",
      contact_policy AS "contactPolicy",
      roles AS "roles",
      excluded_industries AS "excludedIndustries",
      excluded_locations AS "excludedLocations",
      remote_friendly AS "remoteFriendly",
      hiring_intent_min AS "hiringIntentMin",
      signal_freshness_days AS "signalFreshnessDays",
      min_open_roles AS "minOpenRoles",
      hiring_mode AS "hiringMode"
    FROM client_profiles
    WHERE owner_id = $1 OR owner_id IS NULL
    ORDER BY is_active DESC, updated_at DESC, id DESC
  `, [ownerId]);

  return result.rows.map(mapClientProfileRow);
}

/**
 * Get a client profile by ID, optionally scoped to a session owner.
 *
 * @param clientProfileId - Profile ID
 * @param ownerId - Session owner ID from getOwnerIdFromSession() for user-facing
 *   reads (anti-IDOR): the profile is returned only if owner_id matches OR the
 *   profile is pilot/anonymous (owner_id IS NULL). Pass `null` ONLY from trusted
 *   server contexts that have already authorized access (digest pipeline,
 *   payments) — this skips the owner predicate. Never pass `null` from a path
 *   that takes a profileId straight off an HTTP request.
 * @param db - Optional DB client for transactions
 * @returns Profile if found (and owned by this user, when ownerId given), else null
 */
export async function getClientProfileById(
  clientProfileId: string | number,
  ownerId: string | number | null,
  db?: ClientProfilesDbClient
): Promise<ClientProfile | null> {
  const normalizedClientProfileId = normalizeClientProfileId(clientProfileId);
  const pool = db ?? getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  // Owner predicate only when a session owner is supplied. Trusted server
  // contexts pass ownerId=null to read by id alone (they authorize elsewhere).
  const ownerScoped = ownerId !== null && ownerId !== undefined;
  const ownerClause = ownerScoped ? "AND (owner_id = $2 OR owner_id IS NULL)" : "";
  const params: (string | number)[] = ownerScoped
    ? [normalizedClientProfileId, ownerId]
    : [normalizedClientProfileId];

  const result = await pool.query<ClientProfileRow>(`
    SELECT
      id::TEXT AS id,
      agency_name AS "agencyName",
      telegram_chat_id::TEXT AS "telegramChatId",
      target_city AS "targetCity",
      specialization,
      include_keywords AS "includeKeywords",
      exclude_keywords AS "excludeKeywords",
      industries AS "industries",
      company_sizes AS "companySizes",
      daily_digest_limit AS "dailyDigestLimit",
      is_active AS "isActive",
      created_at::TEXT AS "createdAt",
      updated_at::TEXT AS "updatedAt",
      contact_policy AS "contactPolicy",
      roles AS "roles",
      excluded_industries AS "excludedIndustries",
      excluded_locations AS "excludedLocations",
      remote_friendly AS "remoteFriendly",
      hiring_intent_min AS "hiringIntentMin",
      signal_freshness_days AS "signalFreshnessDays",
      min_open_roles AS "minOpenRoles",
      hiring_mode AS "hiringMode"
    FROM client_profiles
    WHERE id = $1 ${ownerClause}
  `, params);

  return result.rowCount === 1 ? mapClientProfileRow(result.rows[0]) : null;
}

/**
 * Owner-scoped profile loader for the self-serve settings page.
 *
 * `client_profiles.owner_id` is unique (partial uidx) and NOT NULL, so an owner
 * has at most one profile. Scoping the read to `owner_id` is the anti-IDOR
 * boundary: the settings page never trusts a profileId from the client, it
 * resolves the profile straight from the authenticated session owner.
 */
export async function getClientProfileByOwnerId(
  ownerId: string | number,
  db?: ClientProfilesDbClient
): Promise<ClientProfile | null> {
  const normalizedOwnerId = normalizeClientProfileId(ownerId);
  const pool = db ?? getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const result = await pool.query<ClientProfileRow>(`
    SELECT
      id::TEXT AS id,
      agency_name AS "agencyName",
      telegram_chat_id::TEXT AS "telegramChatId",
      target_city AS "targetCity",
      specialization,
      include_keywords AS "includeKeywords",
      exclude_keywords AS "excludeKeywords",
      industries AS "industries",
      company_sizes AS "companySizes",
      daily_digest_limit AS "dailyDigestLimit",
      is_active AS "isActive",
      created_at::TEXT AS "createdAt",
      updated_at::TEXT AS "updatedAt",
      contact_policy AS "contactPolicy",
      roles AS "roles",
      excluded_industries AS "excludedIndustries",
      excluded_locations AS "excludedLocations",
      remote_friendly AS "remoteFriendly",
      hiring_intent_min AS "hiringIntentMin",
      signal_freshness_days AS "signalFreshnessDays",
      min_open_roles AS "minOpenRoles",
      hiring_mode AS "hiringMode"
    FROM client_profiles
    WHERE owner_id = $1
    LIMIT 1
  `, [normalizedOwnerId]);

  return result.rowCount === 1 ? mapClientProfileRow(result.rows[0]) : null;
}

export async function findMatchingClientProfileForCheckoutOrder(input: {
  checkoutOrderId?: string | number | null;
  agencyName: string;
  telegramChatId?: string | null;
  targetCity?: string | null;
  specialization?: string | null;
  includeKeywords?: readonly string[] | null;
  excludeKeywords?: readonly string[] | null;
  dailyDigestLimit?: number | null;
}, db?: ClientProfilesDbClient): Promise<ClientProfile | null> {
  const pool = db ?? getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const agencyName = normalizeRequiredText(input.agencyName, "Agency name is required.");
  const checkoutOrderId =
    input.checkoutOrderId == null ? null : normalizeCheckoutOrderId(input.checkoutOrderId);
  const telegramChatId = normalizeTelegramChatId(input.telegramChatId);
  const targetCity = normalizeOptionalText(input.targetCity);
  const specialization = normalizeOptionalText(input.specialization);
  const includeKeywords = normalizeKeywordList(input.includeKeywords);
  const excludeKeywords = normalizeKeywordList(input.excludeKeywords);
  const dailyDigestLimit = normalizeDailyDigestLimit(input.dailyDigestLimit);

  // Restrict to profiles already linked to this specific order, or to profiles
  // owned by the same user via any of their orders. The primary guard is the
  // direct link (payload->>'clientProfileId'); the user-scoped fallback allows
  // find-or-create to reuse an existing profile on the first order that created
  // it, but only when that order belongs to the same user.
  const ownershipClause = checkoutOrderId
    ? `
      AND (
        EXISTS (
          SELECT 1 FROM checkout_orders co
          WHERE co.id = $2
            AND co.payload ->> 'clientProfileId' = client_profiles.id::TEXT
        )
        OR EXISTS (
          SELECT 1 FROM checkout_orders co
          JOIN checkout_orders current_order ON current_order.id = $2
          WHERE co.user_id = current_order.user_id
            AND co.payload ->> 'clientProfileId' = client_profiles.id::TEXT
        )
      )
    `
    : "";

  if (telegramChatId) {
    const directMatchResult = await pool.query<ClientProfileRow>(`
      SELECT
        id::TEXT AS id,
        agency_name AS "agencyName",
        telegram_chat_id::TEXT AS "telegramChatId",
        target_city AS "targetCity",
        specialization,
        include_keywords AS "includeKeywords",
        exclude_keywords AS "excludeKeywords",
        industries AS "industries",
        company_sizes AS "companySizes",
        daily_digest_limit AS "dailyDigestLimit",
        is_active AS "isActive",
        created_at::TEXT AS "createdAt",
        updated_at::TEXT AS "updatedAt",
        contact_policy AS "contactPolicy",
        roles AS "roles",
        excluded_industries AS "excludedIndustries",
        excluded_locations AS "excludedLocations",
        remote_friendly AS "remoteFriendly",
        hiring_intent_min AS "hiringIntentMin",
        signal_freshness_days AS "signalFreshnessDays",
        min_open_roles AS "minOpenRoles",
        hiring_mode AS "hiringMode"
      FROM client_profiles
      WHERE telegram_chat_id::TEXT = $1
      ${ownershipClause}
      ORDER BY updated_at DESC, id DESC
      LIMIT 2
    `, checkoutOrderId ? [telegramChatId, checkoutOrderId] : [telegramChatId]);

    if (directMatchResult.rowCount === 1) {
      return mapClientProfileRow(directMatchResult.rows[0]);
    }
  }

  const candidateResult = await pool.query<ClientProfileRow>(`
    SELECT
      id::TEXT AS id,
      agency_name AS "agencyName",
      telegram_chat_id::TEXT AS "telegramChatId",
      target_city AS "targetCity",
      specialization,
      include_keywords AS "includeKeywords",
      exclude_keywords AS "excludeKeywords",
      industries AS "industries",
      company_sizes AS "companySizes",
      daily_digest_limit AS "dailyDigestLimit",
      is_active AS "isActive",
      created_at::TEXT AS "createdAt",
      updated_at::TEXT AS "updatedAt",
      contact_policy AS "contactPolicy",
      roles AS "roles",
      excluded_industries AS "excludedIndustries",
      excluded_locations AS "excludedLocations",
      remote_friendly AS "remoteFriendly",
      hiring_intent_min AS "hiringIntentMin",
      signal_freshness_days AS "signalFreshnessDays",
      min_open_roles AS "minOpenRoles",
      hiring_mode AS "hiringMode"
    FROM client_profiles
    WHERE LOWER(BTRIM(agency_name)) = LOWER(BTRIM($1))
    ${ownershipClause}
    ORDER BY updated_at DESC, id DESC
    LIMIT 20
  `, checkoutOrderId ? [agencyName, checkoutOrderId] : [agencyName]);

  const candidates = candidateResult.rows.map(mapClientProfileRow);
  const exactMatches = candidates.filter((candidate) =>
    matchesExactClientProfile(candidate, {
      targetCity,
      specialization,
      includeKeywords,
      excludeKeywords,
      dailyDigestLimit
    })
  );

  if (exactMatches.length === 1) {
    return exactMatches[0];
  }

  const scopeMatches = candidates.filter((candidate) =>
    matchesScopedClientProfile(candidate, {
      targetCity,
      specialization
    })
  );

  if (scopeMatches.length === 1) {
    return scopeMatches[0];
  }

  const placeholderMatches = candidates.filter(isPlaceholderClientProfile);
  return placeholderMatches.length === 1 ? placeholderMatches[0] : null;
}

export async function saveClientProfile(input: {
  id?: string | number | null;
  agencyName: string;
  telegramChatId?: string | null;
  targetCity?: string | null;
  specialization?: string | null;
  includeKeywords?: readonly string[] | null;
  excludeKeywords?: readonly string[] | null;
  industries?: readonly string[] | null;
  companySizes?: readonly string[] | null;
  dailyDigestLimit?: number | null;
  isActive?: boolean;
  contactPolicy?: 'corporate_only' | 'no_personal' | 'unrestricted' | null;
  roles?: readonly string[] | null;
  excludedIndustries?: readonly string[] | null;
  excludedLocations?: readonly string[] | null;
  remoteFriendly?: boolean | null;
  hiringIntentMin?: number | null;
  signalFreshnessDays?: number | null;
  minOpenRoles?: number | null;
  hiringMode?: HiringMode | null;
}, db?: ClientProfilesDbClient): Promise<ClientProfile> {
  const pool = db ?? getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const normalizedId = input.id == null ? null : normalizeClientProfileId(input.id);
  const agencyName = normalizeRequiredText(input.agencyName, "Agency name is required.");
  const telegramChatId = normalizeTelegramChatId(input.telegramChatId);
  const targetCity = normalizeOptionalText(input.targetCity);
  const specialization = normalizeOptionalText(input.specialization);
  const includeKeywords = normalizeKeywordList(input.includeKeywords);
  const excludeKeywords = normalizeKeywordList(input.excludeKeywords);
  const industries = normalizeIndustryList(input.industries);
  const companySizes = normalizeCompanySizeList(input.companySizes);
  const dailyDigestLimit = normalizeDailyDigestLimit(input.dailyDigestLimit);
  const isActive = input.isActive ?? true;
  const roles = normalizeRoleList(input.roles);
  const excludedIndustries = normalizeIndustryList(input.excludedIndustries);
  const excludedLocations = normalizeKeywordList(input.excludedLocations);
  const remoteFriendly = input.remoteFriendly ?? false;
  const contactPolicy = normalizeContactPolicy(input.contactPolicy);
  const hiringIntentMin = normalizeHiringIntentMin(input.hiringIntentMin);
  const signalFreshnessDays = normalizePositiveInt(input.signalFreshnessDays);
  const minOpenRoles = normalizeNonNegativeInt(input.minOpenRoles);
  const hiringMode = normalizeHiringMode(input.hiringMode);

  const returningClause = `
    id::TEXT AS id,
    agency_name AS "agencyName",
    telegram_chat_id::TEXT AS "telegramChatId",
    target_city AS "targetCity",
    specialization,
    include_keywords AS "includeKeywords",
    exclude_keywords AS "excludeKeywords",
    industries AS "industries",
    company_sizes AS "companySizes",
    daily_digest_limit AS "dailyDigestLimit",
    is_active AS "isActive",
    created_at::TEXT AS "createdAt",
    updated_at::TEXT AS "updatedAt",
    contact_policy AS "contactPolicy",
    roles AS "roles",
    excluded_industries AS "excludedIndustries",
    excluded_locations AS "excludedLocations",
    remote_friendly AS "remoteFriendly",
    hiring_intent_min AS "hiringIntentMin",
    signal_freshness_days AS "signalFreshnessDays",
    min_open_roles AS "minOpenRoles",
    hiring_mode AS "hiringMode"
  `;

  let result: Awaited<ReturnType<typeof pool.query<ClientProfileRow>>>;

  try {
    result = normalizedId
      ? await pool.query<ClientProfileRow>(`
          UPDATE client_profiles
          SET
            agency_name = $2,
            telegram_chat_id = $3,
            target_city = $4,
            specialization = $5,
            include_keywords = $6::jsonb,
            exclude_keywords = $7::jsonb,
            industries = $8::jsonb,
            company_sizes = $9::jsonb,
            daily_digest_limit = $10,
            is_active = $11,
            contact_policy = $12,
            roles = $13,
            excluded_industries = $14,
            excluded_locations = $15,
            remote_friendly = $16,
            hiring_intent_min = $17,
            signal_freshness_days = $18,
            min_open_roles = $19,
            hiring_mode = $20
          WHERE id = $1
          RETURNING ${returningClause}
        `, [
          normalizedId,
          agencyName,
          telegramChatId,
          targetCity,
          specialization,
          includeKeywords.length > 0 ? JSON.stringify(includeKeywords) : null,
          excludeKeywords.length > 0 ? JSON.stringify(excludeKeywords) : null,
          industries.length > 0 ? JSON.stringify(industries) : null,
          companySizes.length > 0 ? JSON.stringify(companySizes) : null,
          dailyDigestLimit,
          isActive,
          contactPolicy,
          roles,
          excludedIndustries,
          excludedLocations,
          remoteFriendly,
          hiringIntentMin,
          signalFreshnessDays,
          minOpenRoles,
          hiringMode
        ])
      : await pool.query<ClientProfileRow>(`
          INSERT INTO client_profiles (
            agency_name,
            telegram_chat_id,
            target_city,
            specialization,
            include_keywords,
            exclude_keywords,
            industries,
            company_sizes,
            daily_digest_limit,
            is_active,
            contact_policy,
            roles,
            excluded_industries,
            excluded_locations,
            remote_friendly,
            hiring_intent_min,
            signal_freshness_days,
            min_open_roles,
            hiring_mode
          )
          VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
          RETURNING ${returningClause}
        `, [
          agencyName,
          telegramChatId,
          targetCity,
          specialization,
          includeKeywords.length > 0 ? JSON.stringify(includeKeywords) : null,
          excludeKeywords.length > 0 ? JSON.stringify(excludeKeywords) : null,
          industries.length > 0 ? JSON.stringify(industries) : null,
          companySizes.length > 0 ? JSON.stringify(companySizes) : null,
          dailyDigestLimit,
          isActive,
          contactPolicy,
          roles,
          excludedIndustries,
          excludedLocations,
          remoteFriendly,
          hiringIntentMin,
          signalFreshnessDays,
          minOpenRoles,
          hiringMode
        ]);
  } catch (err) {
    if (isUniqueViolation(err, "client_profiles_telegram_chat_id_unique")) {
      throw new Error(
        "Этот Telegram-аккаунт уже привязан к другому профилю. Отвяжите его там или обратитесь в поддержку."
      );
    }
    throw err;
  }

  if (result.rowCount !== 1) {
    throw new Error("Failed to save client profile.");
  }

  return mapClientProfileRow(result.rows[0]);
}

function isUniqueViolation(error: unknown, constraintName?: string): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as Record<string, unknown>;
  if (e["code"] !== "23505") return false;
  if (constraintName && e["constraint"] !== constraintName) return false;
  return true;
}

export async function createPilotApplication(input: {
  name: string;
  telegram: string;
  specialization?: string | null;
  city?: string | null;
  comment?: string | null;
}, db?: ClientProfilesDbClient): Promise<PilotApplication> {
  const pool = db ?? getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const name = normalizeRequiredText(input.name, "Name is required.");
  const telegram = normalizeRequiredText(input.telegram, "Telegram is required.");
  const specialization = normalizeOptionalText(input.specialization);
  const city = normalizeOptionalText(input.city);
  const comment = normalizeOptionalText(input.comment);

  const result = await pool.query<PilotApplicationRow>(`
    INSERT INTO pilot_applications (
      name,
      telegram,
      specialization,
      city,
      comment
    )
    VALUES ($1, $2, $3, $4, $5)
    RETURNING
      id::TEXT AS id,
      name,
      telegram,
      specialization,
      city,
      comment,
      created_at::TEXT AS "createdAt"
  `, [name, telegram, specialization, city, comment]);

  if (result.rowCount !== 1) {
    throw new Error("Failed to create pilot application.");
  }

  return {
    id: result.rows[0].id,
    name: result.rows[0].name,
    telegram: result.rows[0].telegram,
    specialization: normalizeOptionalText(result.rows[0].specialization),
    city: normalizeOptionalText(result.rows[0].city),
    comment: normalizeOptionalText(result.rows[0].comment),
    createdAt: result.rows[0].createdAt
  };
}

export async function listPilotApplications(limit = 20): Promise<PilotApplication[]> {
  const pool = getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 20;
  const result = await pool.query<PilotApplicationRow>(`
    SELECT
      id::TEXT AS id,
      name,
      telegram,
      specialization,
      city,
      comment,
      created_at::TEXT AS "createdAt"
    FROM pilot_applications
    ORDER BY created_at DESC, id DESC
    LIMIT $1
  `, [normalizedLimit]);

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    telegram: row.telegram,
    specialization: normalizeOptionalText(row.specialization),
    city: normalizeOptionalText(row.city),
    comment: normalizeOptionalText(row.comment),
    createdAt: row.createdAt
  }));
}

export function parseKeywordText(value: string | null | undefined): string[] {
  if (typeof value !== "string") {
    return [];
  }

  const uniqueKeywords = new Set<string>();

  for (const rawPart of value.split(/[\n,;]+/)) {
    const normalizedPart = rawPart.trim();

    if (normalizedPart === "") {
      continue;
    }

    const normalizedKey = normalizedPart.toLocaleLowerCase("ru-RU");

    if (uniqueKeywords.has(normalizedKey)) {
      continue;
    }

    uniqueKeywords.add(normalizedKey);
  }

  return Array.from(uniqueKeywords.values());
}

export function formatKeywordText(value: readonly string[] | null | undefined): string {
  if (!value || value.length === 0) {
    return "";
  }

  return value.join("\n");
}

function mapClientProfileRow(row: ClientProfileRow): ClientProfile {
  return {
    id: row.id,
    agencyName: row.agencyName,
    telegramChatId: normalizeTelegramChatId(row.telegramChatId),
    targetCity: normalizeOptionalText(row.targetCity),
    specialization: normalizeOptionalText(row.specialization),
    includeKeywords: normalizeKeywordList(row.includeKeywords),
    excludeKeywords: normalizeKeywordList(row.excludeKeywords),
    industries: normalizeIndustryList(row.industries),
    companySizes: normalizeCompanySizeList(row.companySizes),
    dailyDigestLimit: normalizeDailyDigestLimit(row.dailyDigestLimit),
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    contactPolicy: (row.contactPolicy as ClientProfile['contactPolicy']) || 'corporate_only',
    roles: normalizeRoleList(row.roles),
    excludedIndustries: normalizeIndustryList(row.excludedIndustries),
    excludedLocations: normalizeKeywordList(row.excludedLocations),
    remoteFriendly: row.remoteFriendly ?? false,
    hiringIntentMin: normalizeHiringIntentMin(row.hiringIntentMin),
    signalFreshnessDays: normalizePositiveInt(row.signalFreshnessDays),
    minOpenRoles: normalizeNonNegativeInt(row.minOpenRoles),
    hiringMode: normalizeHiringMode(row.hiringMode),
  };
}

/**
 * Convert a ClientProfile (DB row) to an AgencyProfile (scoring pipeline input).
 *
 * Maps ICP fields from the DB to the shape expected by runScoringPipeline:
 *   industries      → industries      (for computeFit / industryAlignment)
 *   companySizes    → companySizes    (for computeFit / size matching)
 *   targetCity      → locations       (for geographicFit)
 *   excludeKeywords → exclusions      (for computeFit / exclusion check)
 *   specialization  → specialization  (for computeFit ICP term matching)
 *   includeKeywords → includeKeywords (for computeFit ICP term matching)
 *   contactPolicy   → contactPolicy   (for computeFit reachability gate)
 *
 * This is the bridge between persisted client preferences and the pure
 * scoring helpers. When a digest or cron pipeline needs to score a lead
 * for a specific client, this mapping ensures the real ICP data flows in.
 */
export function clientProfileToAgencyProfile(profile: ClientProfile): AgencyProfile {
  const locations: string[] = []
  if (profile.targetCity) {
    locations.push(profile.targetCity)
  }

  return {
    industries: profile.industries?.filter((s): s is string => VALID_INDUSTRIES.has(s)) ?? [],
    locations,
    roles: profile.roles?.filter((s): s is string => VALID_ROLES.has(s)) ?? [],
    companySizes: profile.companySizes?.filter(
      (s): s is 'startup' | 'small' | 'medium' | 'large' | 'enterprise' =>
        VALID_COMPANY_SIZES.has(s)
    ) ?? [],
    excludedIndustries: profile.excludedIndustries?.filter((s): s is string => VALID_INDUSTRIES.has(s)) ?? [],
    excludedLocations: profile.excludedLocations ?? [],
    exclusions: profile.excludeKeywords ?? [],
    contactPolicy: profile.contactPolicy,
    remoteFriendly: profile.remoteFriendly ?? false,
    specialization: profile.specialization ?? undefined,
    includeKeywords: profile.includeKeywords ?? [],
    // Resolve 'auto' → concrete mode at the boundary so downstream scoring
    // (FIUR, fit-explanation) never has to handle 'auto'.
    hiringMode: resolveHiringMode(profile),
  }
}

function normalizeClientProfileId(value: string | number): number {
  const normalizedValue = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(normalizedValue) || normalizedValue <= 0) {
    throw new Error("Invalid client profile id.");
  }

  return normalizedValue;
}

function normalizeCheckoutOrderId(value: string | number): number {
  const normalizedValue = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(normalizedValue) || normalizedValue <= 0) {
    throw new Error("Invalid checkout order id.");
  }

  return normalizedValue;
}

function normalizeRequiredText(value: string | null | undefined, message: string): string {
  const normalizedValue = normalizeOptionalText(value);

  if (!normalizedValue) {
    throw new Error(message);
  }

  return normalizedValue;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue === "" ? null : normalizedValue;
}

function normalizeTelegramChatId(value: string | null | undefined): string | null {
  const normalizedValue = normalizeOptionalText(value);

  if (!normalizedValue) {
    return null;
  }

  if (!/^-?\d+$/.test(normalizedValue)) {
    throw new Error("Telegram chat id must be numeric.");
  }

  return normalizedValue;
}

function matchesExactClientProfile(
  profile: ClientProfile,
  target: {
    targetCity: string | null;
    specialization: string | null;
    includeKeywords: readonly string[];
    excludeKeywords: readonly string[];
    dailyDigestLimit: number;
  }
): boolean {
  return (
    normalizeOptionalText(profile.targetCity) === target.targetCity &&
    normalizeOptionalText(profile.specialization) === target.specialization &&
    profile.dailyDigestLimit === target.dailyDigestLimit &&
    areKeywordListsEqual(profile.includeKeywords, target.includeKeywords) &&
    areKeywordListsEqual(profile.excludeKeywords, target.excludeKeywords)
  );
}

function matchesScopedClientProfile(
  profile: ClientProfile,
  target: {
    targetCity: string | null;
    specialization: string | null;
  }
): boolean {
  return (
    normalizeOptionalText(profile.targetCity) === target.targetCity &&
    normalizeOptionalText(profile.specialization) === target.specialization
  );
}

function isPlaceholderClientProfile(profile: ClientProfile): boolean {
  return (
    profile.telegramChatId === null &&
    profile.targetCity === null &&
    profile.specialization === null &&
    profile.includeKeywords.length === 0 &&
    profile.excludeKeywords.length === 0 &&
    profile.industries.length === 0 &&
    profile.companySizes.length === 0 &&
    profile.dailyDigestLimit === 5 &&
    profile.roles.length === 0 &&
    profile.excludedIndustries.length === 0 &&
    profile.excludedLocations.length === 0 &&
    profile.remoteFriendly === false
  );
}

function areKeywordListsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((item, index) => item === right[index]);
}

function normalizeDailyDigestLimit(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 5;
  }

  const normalizedValue = Math.trunc(value);
  return normalizedValue > 0 ? normalizedValue : 5;
}

/**
 * Minimum FIUR total a candidate must reach. Clamped to the scorer's [0, 4]
 * range. Anything outside a finite number, or ≤ 0, becomes null (no threshold) —
 * a 0 floor would be a no-op anyway, so we store null to mean "unset".
 */
function normalizeHiringIntentMin(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.min(value, 4);
}

/** A strictly-positive integer threshold (e.g. freshness days), else null. */
function normalizePositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  return n > 0 ? n : null;
}

/**
 * A non-negative integer threshold (e.g. min open roles). 0 is a no-op floor, so
 * it normalizes to null ("unset") to keep the "null = no filter" invariant.
 */
function normalizeNonNegativeInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  return n > 0 ? n : null;
}

function normalizeKeywordList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const uniqueKeywords = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const normalizedItem = item.trim();

    if (normalizedItem === "") {
      continue;
    }

    const normalizedKey = normalizedItem.toLocaleLowerCase("ru-RU");

    if (uniqueKeywords.has(normalizedKey)) {
      continue;
    }

    uniqueKeywords.add(normalizedKey);
  }

  return Array.from(uniqueKeywords.values());
}

const VALID_COMPANY_SIZES = new Set(['startup', 'small', 'medium', 'large', 'enterprise'])

/**
 * Canonical industry keys — the single source of truth for:
 *   - normalizeIndustryList whitelist
 *   - onboarding form checkbox values
 *   - digest filtering/scoring keyword lookups
 */
const VALID_INDUSTRIES = new Set([
  'it', 'finance', 'manufacturing', 'retail', 'healthcare',
  'construction', 'logistics', 'consulting', 'education', 'media',
  'agro', 'hospitality', 'energy', 'government', 'real-estate',
  'telecom', 'auto',
])

/**
 * Industry keyword map — maps canonical industry keys to Russian search
 * terms used for digest haystack matching. Each industry has one or more
 * keywords that commonly appear in employer names, vacancy titles, and
 * evidence_titles.
 */
const INDUSTRY_KEYWORDS: ReadonlyMap<string, readonly string[]> = new Map([
  ['it',            ['it', 'айти', 'информационные технологии', 'разработ', 'программ', 'digital', 'софт', 'tech', 'цифров']],
  ['finance',       ['финанс', 'банк', 'инвестицион', 'страхован', 'finance', 'credit', 'кредит']],
  ['manufacturing', ['производств', 'завод', 'фабрик', 'manufacturing', 'промышленн']],
  ['retail',        ['ритейл', 'retail', 'торговл', 'магазин', 'commerc', 'маркет', 'market']],
  ['healthcare',    ['здравоохранен', 'медицин', 'клиник', 'больниц', 'фарм', 'healthcare', 'pharma']],
  ['construction',  ['строительств', 'строит', 'construction', 'застройщик']],
  ['logistics',     ['логистик', 'транспорт', 'доставк', 'logistics', 'cargo', 'склад', 'перевозк']],
  ['consulting',    ['консалтинг', 'consulting', 'консультаци']],
  ['education',     ['образован', 'учеб', 'школ', 'вуз', 'университет', 'education']],
  ['media',         ['медиа', 'телеканал', 'издани', 'media', 'журнал', 'новост']],
  ['agro',          ['агропромышленн', 'агро', 'сельск', 'фермер', 'agro', 'agriculture', 'агрохолдинг', 'семен', 'урожай', 'птиц', 'молочн']],
  ['hospitality',   ['ресторан', 'отель', 'гостиниц', 'туризм', 'hotel', 'hospitality', 'hoReCa', 'общепит', 'питан', 'кафе', 'ресторан']],
  ['energy',        ['энерг', 'нефт', 'газ', 'нефтегаз', 'сырь', 'energy', 'oil', 'gas', 'уголь', 'электростанц', 'ресурс']],
  ['government',    ['госу', 'гос.', 'министерств', 'ведомств', 'казён', 'бюджетн', 'нко', 'фонд', 'government', 'municipal', 'муниципал', 'администрац']],
  ['real-estate',   ['недвижим', 'застройщик', 'девелопмент', 'real estate', 'property', 'жильё', 'помещен', 'риелтор']],
  ['telecom',       ['телеком', 'связь', 'оператор связ', 'telecom', 'мобайл', 'билайн', 'мтс', 'мегафон', 'telecom']],
  ['auto',          ['автомобил', 'авто ', 'автосервис', 'автосалон', 'автопарк', 'auto', 'automotive', 'транспортн', 'шиномонтаж', 'сто ']],
])

/**
 * Normalize company size list — only known values survive.
 * Accepts arrays of strings like ['startup', 'medium', 'large'].
 */
function normalizeCompanySizeList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const uniqueSizes = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const normalizedItem = item.trim().toLowerCase();

    if (!VALID_COMPANY_SIZES.has(normalizedItem)) {
      continue;
    }

    uniqueSizes.add(normalizedItem);
  }

  return Array.from(uniqueSizes.values());
}

/**
 * Normalize industry list — only known keys survive.
 * Accepts arrays of strings like ['it', 'finance', 'manufacturing'].
 */
function normalizeIndustryList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const uniqueIndustries = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const normalizedItem = item.trim().toLowerCase();

    if (!VALID_INDUSTRIES.has(normalizedItem)) {
      continue;
    }

    uniqueIndustries.add(normalizedItem);
  }

  return Array.from(uniqueIndustries.values());
}

/**
 * Canonical role keys — the single source of truth for:
 *   - normalizeRoleList whitelist
 *   - onboarding form checkbox values
 *   - computeFit role-match scoring
 */
const VALID_ROLES = new Set([
  'it-engineering', 'data', 'product', 'sales', 'marketing',
  'hr', 'finance', 'operations', 'legal', 'executive', 'other',
])

/**
 * Canonical contact-policy values — the single source of truth for:
 *   - normalizeContactPolicy whitelist
 *   - onboarding form <select> option values
 *   - computeFit reachability gate
 *
 * 'corporate_only' is the default and the safest route (career page, HR email,
 * feedback form only). Order is irrelevant; membership is what matters.
 */
export const VALID_CONTACT_POLICIES = new Set<ClientProfile['contactPolicy']>([
  'corporate_only', 'no_personal', 'unrestricted',
])

export const DEFAULT_CONTACT_POLICY: ClientProfile['contactPolicy'] = 'corporate_only'

/**
 * Normalize a contact-policy value — only known values survive.
 * Anything unknown (including null/non-string) falls back to the safest
 * default, so a forged POST can never persist an arbitrary string into
 * the contact_policy column.
 */
export function normalizeContactPolicy(value: unknown): ClientProfile['contactPolicy'] {
  if (typeof value !== 'string') {
    return DEFAULT_CONTACT_POLICY
  }

  const normalizedItem = value.trim().toLowerCase() as ClientProfile['contactPolicy']

  return VALID_CONTACT_POLICIES.has(normalizedItem) ? normalizedItem : DEFAULT_CONTACT_POLICY
}

/**
 * Normalize a hiring-mode value — only known values survive.
 * Anything unknown (including null/non-string) falls back to the default
 * ('auto'), so a forged POST can never persist an arbitrary string into the
 * hiring_mode column.
 */
export function normalizeHiringMode(value: unknown): HiringMode {
  if (typeof value !== 'string') {
    return DEFAULT_HIRING_MODE
  }

  const normalizedItem = value.trim().toLowerCase() as HiringMode

  return VALID_HIRING_MODES.has(normalizedItem) ? normalizedItem : DEFAULT_HIRING_MODE
}

/**
 * Resolve the effective hiring mode for a profile.
 *
 * If the agency set an explicit mode other than 'auto', that wins — it is a
 * deliberate product choice. 'auto' (the default) infers the mode from the
 * agency's declared canonical `roles`:
 *
 *   - 'executive' role present (alone or with others) → 'executive'. An
 *     agency that declares it closes C-level mandates is an executive agency
 *     even if it also fills some line roles.
 *   - otherwise, if industrial/logistics roles dominate (≥ 1 of them and no
 *     executive/specialist-only signal) → 'volume'. Industrial & logistics
 *     hiring is overwhelmingly volume hiring in Russia.
 *   - otherwise → 'specialist' (the pre-existing default behavior).
 *
 * Inference is a heuristic; the agency can always override by picking an
 * explicit mode in /settings/profile. Pure + deterministic.
 */
export function resolveHiringMode(profile: Pick<ClientProfile, 'hiringMode' | 'roles'>): Exclude<HiringMode, 'auto'> {
  if (profile.hiringMode && profile.hiringMode !== 'auto') {
    return profile.hiringMode
  }

  const roles = profile.roles ?? []
  if (roles.includes('executive')) {
    return 'executive'
  }
  // Industrial + logistics roles are the canonical volume-hiring markets.
  // A single such role, in the absence of an executive declaration, is enough
  // to infer volume mode — these agencies win mandates on throughput, not
  // on per-role seniority.
  const volumeRoles = roles.filter((r) => r === 'industrial' || r === 'logistics')
  if (volumeRoles.length > 0) {
    return 'volume'
  }
  return 'specialist'
}

/**
 * Normalize role list — only known keys survive.
 * Accepts arrays of strings like ['it-engineering', 'data', 'product'].
 */
function normalizeRoleList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const uniqueRoles = new Set<string>()

  for (const item of value) {
    if (typeof item !== 'string') {
      continue
    }

    const normalizedItem = item.trim().toLowerCase()

    if (!VALID_ROLES.has(normalizedItem)) {
      continue
    }

    uniqueRoles.add(normalizedItem)
  }

  return Array.from(uniqueRoles.values())
}

export { VALID_COMPANY_SIZES, VALID_INDUSTRIES, VALID_ROLES, INDUSTRY_KEYWORDS }
