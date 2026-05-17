import { Pool, type PoolClient } from "pg";

type ClientProfilesDbClient = Pick<Pool, "query"> | Pick<PoolClient, "query">;

type ClientProfileRow = {
  id: string;
  agencyName: string;
  telegramChatId: string | null;
  targetCity: string | null;
  specialization: string | null;
  includeKeywords: unknown;
  excludeKeywords: unknown;
  dailyDigestLimit: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ClientProfile = {
  id: string;
  agencyName: string;
  telegramChatId: string | null;
  targetCity: string | null;
  specialization: string | null;
  includeKeywords: string[];
  excludeKeywords: string[];
  dailyDigestLimit: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
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
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    return null;
  }

  if (!globalForPg.recruiterRadarClientProfilesPool) {
    globalForPg.recruiterRadarClientProfilesPool = new Pool({
      connectionString
    });
  }

  return globalForPg.recruiterRadarClientProfilesPool;
}

export async function listClientProfiles(): Promise<ClientProfile[]> {
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
      daily_digest_limit AS "dailyDigestLimit",
      is_active AS "isActive",
      created_at::TEXT AS "createdAt",
      updated_at::TEXT AS "updatedAt"
    FROM client_profiles
    ORDER BY is_active DESC, updated_at DESC, id DESC
  `);

  return result.rows.map(mapClientProfileRow);
}

export async function getClientProfileById(
  clientProfileId: string | number,
  db?: ClientProfilesDbClient
): Promise<ClientProfile | null> {
  const normalizedClientProfileId = normalizeClientProfileId(clientProfileId);
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
      daily_digest_limit AS "dailyDigestLimit",
      is_active AS "isActive",
      created_at::TEXT AS "createdAt",
      updated_at::TEXT AS "updatedAt"
    FROM client_profiles
    WHERE id = $1
  `, [normalizedClientProfileId]);

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
        daily_digest_limit AS "dailyDigestLimit",
        is_active AS "isActive",
        created_at::TEXT AS "createdAt",
        updated_at::TEXT AS "updatedAt"
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
      daily_digest_limit AS "dailyDigestLimit",
      is_active AS "isActive",
      created_at::TEXT AS "createdAt",
      updated_at::TEXT AS "updatedAt"
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
  dailyDigestLimit?: number | null;
  isActive?: boolean;
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
  const dailyDigestLimit = normalizeDailyDigestLimit(input.dailyDigestLimit);
  const isActive = input.isActive ?? true;

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
            daily_digest_limit = $8,
            is_active = $9
          WHERE id = $1
          RETURNING
            id::TEXT AS id,
            agency_name AS "agencyName",
            telegram_chat_id::TEXT AS "telegramChatId",
            target_city AS "targetCity",
            specialization,
            include_keywords AS "includeKeywords",
            exclude_keywords AS "excludeKeywords",
            daily_digest_limit AS "dailyDigestLimit",
            is_active AS "isActive",
            created_at::TEXT AS "createdAt",
            updated_at::TEXT AS "updatedAt"
        `, [
          normalizedId,
          agencyName,
          telegramChatId,
          targetCity,
          specialization,
          includeKeywords.length > 0 ? JSON.stringify(includeKeywords) : null,
          excludeKeywords.length > 0 ? JSON.stringify(excludeKeywords) : null,
          dailyDigestLimit,
          isActive
        ])
      : await pool.query<ClientProfileRow>(`
          INSERT INTO client_profiles (
            agency_name,
            telegram_chat_id,
            target_city,
            specialization,
            include_keywords,
            exclude_keywords,
            daily_digest_limit,
            is_active
          )
          VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)
          RETURNING
            id::TEXT AS id,
            agency_name AS "agencyName",
            telegram_chat_id::TEXT AS "telegramChatId",
            target_city AS "targetCity",
            specialization,
            include_keywords AS "includeKeywords",
            exclude_keywords AS "excludeKeywords",
            daily_digest_limit AS "dailyDigestLimit",
            is_active AS "isActive",
            created_at::TEXT AS "createdAt",
            updated_at::TEXT AS "updatedAt"
        `, [
          agencyName,
          telegramChatId,
          targetCity,
          specialization,
          includeKeywords.length > 0 ? JSON.stringify(includeKeywords) : null,
          excludeKeywords.length > 0 ? JSON.stringify(excludeKeywords) : null,
          dailyDigestLimit,
          isActive
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
    dailyDigestLimit: normalizeDailyDigestLimit(row.dailyDigestLimit),
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
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
    profile.dailyDigestLimit === 5
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
