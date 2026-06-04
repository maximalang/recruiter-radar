import { Pool, type PoolClient } from "pg";
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
};

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
      industries AS "industries",
      company_sizes AS "companySizes",
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
      industries AS "industries",
      company_sizes AS "companySizes",
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
      industries AS "industries",
      company_sizes AS "companySizes",
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
  industries?: readonly string[] | null;
  companySizes?: readonly string[] | null;
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
  const industries = normalizeIndustryList(input.industries);
  const companySizes = normalizeCompanySizeList(input.companySizes);
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
            industries = $8::jsonb,
            company_sizes = $9::jsonb,
            daily_digest_limit = $10,
            is_active = $11
          WHERE id = $1
          RETURNING
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
            updated_at::TEXT AS "updatedAt"
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
            industries,
            company_sizes,
            daily_digest_limit,
            is_active
          )
          VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10)
          RETURNING
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
            updated_at::TEXT AS "updatedAt"
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
    industries: normalizeIndustryList(row.industries),
    companySizes: normalizeCompanySizeList(row.companySizes),
    dailyDigestLimit: normalizeDailyDigestLimit(row.dailyDigestLimit),
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

/**
 * Convert a ClientProfile (DB row) to an AgencyProfile (scoring pipeline input).
 *
 * Maps ICP fields from the DB to the shape expected by runScoringPipeline:
 *   industries    → industries   (for computeFit / industryAlignment)
 *   companySizes  → companySizes (for computeFit / size matching)
 *   targetCity    → locations    (for geographicFit)
 *   excludeKeywords → exclusions (for computeFit / exclusion check)
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
    industries: profile.industries.filter((s): s is string => VALID_INDUSTRIES.has(s)),
    locations,
    companySizes: profile.companySizes.filter(
      (s): s is 'startup' | 'small' | 'medium' | 'large' | 'enterprise' =>
        VALID_COMPANY_SIZES.has(s)
    ),
    excludedIndustries: [],
    excludedLocations: [],
    exclusions: profile.excludeKeywords,
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

export { VALID_COMPANY_SIZES, VALID_INDUSTRIES, INDUSTRY_KEYWORDS }
